"""Import each blessed per-entity TSV snapshot into a live LimeSurvey.

The vitest suite asserts `registry/entities/<slug>/tsv.tsv` matches the current
converter output byte-for-byte, but nothing confirms LimeSurvey itself *accepts*
those blessed snapshots. This closes that gap: it imports every committed
per-entity TSV into the dockerized LimeSurvey and asserts the survey lands with
at least one question.

Complements the existing docker suite, which imports the ad-hoc
`tests/fixtures/surveys/` surveys — those are hand-authored scenarios, separate
from the registry's canonical per-type snapshots.

The select_*_long_list entities use select_*_from_file: their options are
inlined from the referenced controlled vocabulary (registry/vocab/*.csv) with a
`cdl_vocab` question attribute recording the source. They now ship a tsv.tsv and
get an extra import→export round-trip check (test_long_list_vocab_roundtrip).
"""

import json
from pathlib import Path

import pytest
from citric import Client
from test_helpers import (
    cleanup_survey,
    get_survey_structure_stats,
    import_survey_from_tsv,
    verify_survey_import,
)

REPO_ROOT = Path(__file__).parents[3]
REGISTRY_ENTITIES = REPO_ROOT / "registry" / "entities"
VOCAB_DIR = REPO_ROOT / "registry" / "vocab"
_ENTITY_TSVS = sorted(REGISTRY_ENTITIES.glob("*/tsv.tsv"))
_LONG_LIST_TSVS = [p for p in _ENTITY_TSVS if p.parent.name.endswith("_long_list")]


def _expected_vocab(entity_dir: Path) -> tuple[str, int]:
    """Which vocabulary an entity references, and how many options it should inline.

    Derived from the entity's own `fixtures/xlsform.json` type string plus the referenced
    CSV's row count — never a hardcoded vocabulary. Vocabularies are open-ended
    (convention:externalCodeList's `vocabularyDeclaration`), so adding one must
    not require editing this test.
    """
    xlsform = json.loads((entity_dir / "fixtures" / "xlsform.json").read_text())
    filenames = [
        row["type"].split(maxsplit=1)[1]
        for row in xlsform.get("survey", [])
        if str(row.get("type", "")).startswith(("select_one_from_file ", "select_multiple_from_file "))
    ]
    assert len(filenames) == 1, f"{entity_dir.name}: expected exactly one from_file question, got {filenames}"
    filename = filenames[0]

    csv_path = VOCAB_DIR / filename
    assert csv_path.exists(), f"{entity_dir.name}: referenced vocabulary {filename!r} missing from {VOCAB_DIR}/"
    # Minus the header row.
    option_count = len([ln for ln in csv_path.read_text().splitlines() if ln.strip()]) - 1

    return filename.removesuffix(".csv"), option_count


def test_registry_entities_discovered() -> None:
    """Guard against the glob silently finding nothing (moved/renamed registry)."""
    assert _ENTITY_TSVS, f"No per-entity tsv.tsv snapshots under {REGISTRY_ENTITIES}"


@pytest.mark.parametrize("tsv_path", _ENTITY_TSVS, ids=[p.parent.name for p in _ENTITY_TSVS])
def test_registry_entity_tsv_imports(limesurvey_client: Client, tsv_path: Path) -> None:
    """Each blessed per-entity TSV must import into LimeSurvey with >=1 question."""
    slug = tsv_path.parent.name
    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, f"Registry entity: {slug}")

    try:
        result = verify_survey_import(limesurvey_client, survey_id)
        stats = get_survey_structure_stats(limesurvey_client, survey_id)
        assert stats["questions"] >= 1, f"Entity '{slug}' imported but LimeSurvey shows no questions: {stats}"
        print(f"\n✓ {slug}: survey {survey_id} — {stats['questions']} question(s), {result['choice_count']} choice(s)")
    finally:
        cleanup_survey(limesurvey_client, survey_id)


def test_long_list_discovered() -> None:
    """The from_file long_list entities should now ship a tsv.tsv."""
    assert _LONG_LIST_TSVS, "No *_long_list tsv.tsv found — from_file inlining regressed?"


@pytest.mark.parametrize("tsv_path", _LONG_LIST_TSVS, ids=[p.parent.name for p in _LONG_LIST_TSVS])
def test_long_list_vocab_roundtrip(limesurvey_client: Client, tsv_path: Path) -> None:
    """A select_*_from_file entity must import with the vocabulary options inlined,
    AND the `cdl_vocab` provenance attribute must survive into LimeSurvey — read
    back from the stored question after import (the real export round-trip)."""
    slug = tsv_path.parent.name
    expected_vocab, expected_options = _expected_vocab(tsv_path.parent)
    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, f"Vocab round-trip: {slug}")

    try:
        # Options were inlined: select_one → answeroptions, select_multiple → subquestions.
        # The bound is derived from the referenced CSV rather than a hardcoded ISO
        # count, but stays a lower bound with the same slack the original check
        # used — LimeSurvey's exact stored-option count isn't contractually
        # guaranteed, so this asserts "the vocabulary was inlined", not an exact
        # equality that a harmless LimeSurvey-side change could break.
        stats = get_survey_structure_stats(limesurvey_client, survey_id)
        inlined = stats["answers"] + stats["subquestions"]
        min_expected = int(expected_options * 0.96)
        assert inlined >= min_expected, (
            f"{slug}: expected ~{expected_options} inlined options from {expected_vocab!r} "
            f"(at least {min_expected}), LimeSurvey shows {inlined} ({stats})"
        )

        # Read the stored question back and assert the cdl_vocab attribute
        # persisted through import (proves LimeSurvey kept the provenance, not
        # just that our TSV carried it).
        def _parent_qid(q: object) -> object:
            return q.get("parent_qid") if isinstance(q, dict) else getattr(q, "parent_qid", 0)

        questions = limesurvey_client.list_questions(survey_id)
        top = next(q for q in questions if _parent_qid(q) in (0, "0", None))
        qid = top.get("qid") if isinstance(top, dict) else top.qid
        props = limesurvey_client.get_question_properties(qid, settings=["attributes"])
        attrs = props.get("attributes", {}) if isinstance(props, dict) else {}
        cssclass = str(attrs.get("cssclass", ""))
        expected_cssclass = f"cdlvocab-{expected_vocab}"
        assert cssclass == expected_cssclass, (
            f"{slug}: vocab provenance did not persist into LimeSurvey; "
            f"expected cssclass {expected_cssclass!r}, got {cssclass!r} (attrs={json.dumps(attrs)[:400]})"
        )
        print(
            f"\n✓ {slug}: survey {survey_id} — {inlined} inlined {expected_vocab} options; "
            f"cssclass={cssclass} survived import"
        )
    finally:
        cleanup_survey(limesurvey_client, survey_id)
