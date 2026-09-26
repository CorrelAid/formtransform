"""Cross-validate that schematron rules cover every registry concept and
that they actively reject violations of registry contracts.

Two tests:

1. Coverage audit (cheap, always runs):
   Each named concept in the type registry (multipleResp, grid, other,
   concept/@vocab, intrvl, responseDomainType, catValu) must be referenced
   somewhere in `ddi-validation/schematron/ddi_custom_rules.sch`. Catches silent
   gaps where registry declares a contract but schematron has no rule.

2. Mutation tests (requires Java worker jar):
   Take blessed `examples/<id>/ddi.xml`, mutate to break a registry
   contract, assert schematron rejects. Proves schematron isn't toothless.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from .fixtures import (
    REPO_ROOT,
    load_example_ddi,
)

SCH_PATH = REPO_ROOT / "ddi-validation" / "schematron" / "ddi_custom_rules.sch"
XSD_PATH = REPO_ROOT / "ddi-validation" / "xsd" / "codebook.xsd"


# =============================================================================
# (1) Coverage audit
# =============================================================================

REGISTRY_CONCEPTS = {
    # Each value names a registry contract that schematron MUST reference.
    "multipleResp": "select_multiple → varGrp[@type='multipleResp']",
    "grid": "begin_group + appearance=table-list → varGrp[@type='grid']",
    "other": "QuestionTypeVariant.withOther → varGrp[@type='other']",
    "concept/@vocab": "convention:externalCodeList → concept[@vocab] in lieu of catgry",
    "intrvl": "QuestionType.ddi.intrvl",
    "responseDomainType": "QuestionType.ddi.responseDomainType",
    "catValu": "category code element",
}


def test_each_registry_concept_referenced_in_schematron():
    sch_text = SCH_PATH.read_text()
    missing = [f"{name!r} ({why})" for name, why in REGISTRY_CONCEPTS.items() if name not in sch_text]
    assert not missing, "Schematron lacks rules referencing these registry concepts:\n  " + "\n  ".join(missing)


def test_composite_schematron_pattern_ids_exist():
    """Each Composite's `schematronPatterns` must list IDs present in the .sch file."""
    from .fixtures import load_registry

    sch_text = SCH_PATH.read_text()
    available = set(re.findall(r'pattern id="([^"]+)"', sch_text))

    composites = [e for e in load_registry() if e.get("@type") == "Composite"]
    assert composites, "no Composite entries in registry — expected at least one"

    errors = []
    for c in composites:
        for pid in c.get("schematronPatterns", []):
            if pid not in available:
                errors.append(f"{c['@id']}: references pattern {pid!r} which is NOT in {SCH_PATH.name}")
    assert not errors, "Composite ↔ schematron pattern ID mismatch:\n  " + "\n  ".join(errors)


# =============================================================================
# (2) Mutation tests — assert schematron actually rejects contract violations
# =============================================================================


def _find_worker_jar() -> Path | None:
    libs = REPO_ROOT / "workers" / "schematron-worker" / "build" / "libs"
    if not libs.exists():
        return None
    for jar in libs.glob("*-all.jar"):
        return jar
    return None


def _resolve_java() -> str | None:
    import os

    home = os.environ.get("JAVA_HOME")
    if home:
        candidate = Path(home) / "bin" / "java"
        if candidate.exists():
            return str(candidate)
    return shutil.which("java")


@pytest.fixture(scope="module")
def worker_jar() -> Path:
    jar = _find_worker_jar()
    if jar is None:
        pytest.skip("schematron-worker jar not built. Run `bash scripts/build-worker.sh` (requires JDK 21).")
    return jar


@pytest.fixture(scope="module")
def java_bin() -> str:
    java = _resolve_java()
    if java is None:
        pytest.skip("java not found")
    return java


def _validate(java_bin: str, worker_jar: Path, xml_bytes: bytes, tmp_path: Path) -> tuple[int, str]:
    """Run worker CLI on given XML; return (returncode, stdout)."""
    xml_file = tmp_path / "mutated.xml"
    xml_file.write_bytes(xml_bytes)
    result = subprocess.run(
        [
            java_bin,
            "-cp",
            str(worker_jar),
            "dev.correlaid.schematron.CliMain",
            "--sch",
            str(SCH_PATH),
            "--xml",
            str(xml_file),
        ],
        capture_output=True,
        timeout=30,
    )
    return result.returncode, result.stdout.decode()


# Mutators: take XML string → return mutated XML string OR None if mutation N/A.


def mut_swap_vargrp_type_to_unknown(xml: str) -> str | None:
    """Replace varGrp/@type='multipleResp' with bogus type."""
    if 'type="multipleResp"' not in xml:
        return None
    return xml.replace('type="multipleResp"', 'type="bogus"', 1)


def mut_drop_concept_vocab(xml: str) -> str | None:
    """Remove vocab attribute from <concept vocab="...">. Used on _from_file variants."""
    new = re.sub(r'(<concept)\s+vocab="[^"]+"', r"\1", xml, count=1)
    return new if new != xml else None


def mut_drop_var_name(xml: str) -> str | None:
    """Remove name attribute from first <var>."""
    new = re.sub(r'(<var\s[^>]*?)\s+name="[^"]+"', r"\1", xml, count=1)
    return new if new != xml else None


def mut_duplicate_var_id(xml: str) -> str | None:
    """Inject a duplicate <var> with same ID — uniqueness pattern should reject."""
    m = re.search(r'<var\s+ID="(V_[^"]+)"[^/]*/>|<var\s+ID="(V_[^"]+)"[^>]*>.*?</var>', xml, re.DOTALL)
    if not m:
        return None
    snippet = m.group(0)
    # Insert duplicate right after the first occurrence
    return xml.replace(snippet, snippet + "\n" + snippet, 1)


MUTATIONS = [
    pytest.param("type:select_multiple", mut_swap_vargrp_type_to_unknown, id="multipleResp→bogus_type_rejected"),
    pytest.param("variant:select_one_long_list", mut_drop_concept_vocab, id="categorical_no_vocab_no_catgry_rejected"),
    pytest.param("type:select_one", mut_drop_var_name, id="var_missing_name_rejected"),
    pytest.param("type:select_one", mut_duplicate_var_id, id="duplicate_var_ID_rejected"),
]


@pytest.mark.parametrize("variant_id,mutator", MUTATIONS)
def test_schematron_rejects_mutation(variant_id, mutator, worker_jar, java_bin, tmp_path):
    """For each (variant, mutation) pair: blessed ddi.xml fails schematron after mutation."""
    # Resolve variant from registry
    from .fixtures import load_registry

    variant = next((e for e in load_registry() if e.get("@id") == variant_id), None)
    if variant is None:
        pytest.skip(f"variant {variant_id} not in registry")

    blessed = load_example_ddi(variant)
    if blessed is None:
        pytest.skip(f"{variant_id}: no blessed ddi.xml")

    mutated = mutator(blessed)
    if mutated is None:
        pytest.skip(f"{variant_id}: mutator inapplicable to this snapshot")

    rc, out = _validate(java_bin, worker_jar, mutated.encode(), tmp_path)
    assert rc == 1, (
        f"{variant_id} + {mutator.__name__}: schematron accepted mutated input.\n"
        f"Returncode: {rc}\n"
        f"Worker output: {out[:600]}\n"
        "Either the mutation didn't break a registry contract, or the rule isn't enforcing."
    )


# -----------------------------------------------------------------------------
# One mutation per Schematron assert (#107), each checked by the message it
# must produce, not only by the exit code. Every mutator changes the first
# match only and returns None when the snapshot lacks the construct.
# -----------------------------------------------------------------------------


def _sub1(pattern: str, repl: str, flags: int = re.DOTALL):
    def mutate(xml: str) -> str | None:
        new = re.sub(pattern, repl, xml, count=1, flags=flags)
        return new if new != xml else None

    return mutate


def _dup_first(tag: str):
    """Duplicate the first <tag ...>...</tag> element (same ID)."""

    def mutate(xml: str) -> str | None:
        m = re.search(rf"<{tag}\s[^>]*>.*?</{tag}>", xml, re.DOTALL)
        return xml.replace(m.group(0), m.group(0) + m.group(0), 1) if m else None

    return mutate


def _insert_after_first(anchor: str, snippet: str):
    def mutate(xml: str) -> str | None:
        return xml.replace(anchor, anchor + snippet, 1) if anchor in xml else None

    return mutate


# (variant, mutator, a substring of the expected Schematron message)
ASSERT_MUTATIONS = [
    ("composite:grid", _dup_first("varGrp"), "Duplicate Variable Group ID"),
    ("type:select_one", _sub1(r'(<var\s[^>]*?)\s+intrvl="[^"]+"', r"\1"), "missing an intrvl attribute"),
    ("type:select_one", _sub1(r'<qstn responseDomainType="[^"]+">', "<qstn>"), "missing responseDomainType"),
    ("type:select_one", _sub1(r"<qstnLit>.*?</qstnLit>", ""), "missing a question literal"),
    ("type:select_one", _sub1(r"<varFormat[^>]*/>", ""), "missing technical format"),
    (
        "type:select_one",
        _sub1(r"(<var\s[^>]*>.*?)<concept>[^<]*</concept>", r"\1<concept> </concept>"),
        "missing a concept element",
    ),
    ("type:select_one", _insert_after_first("</qstn>", "<labl>x</labl>"), "uses labl"),
    ("type:select_one", _insert_after_first("</qstn>", "<notes>a</notes><notes>b</notes>"), "multiple notes elements"),
    (
        "composite:grid",
        _sub1(r'(<varGrp\s[^>]*?)\s+name="[^"]+"', r"\1"),
        "Variable Group VG_institutionen is missing a name",
    ),
    ("composite:grid", _sub1(r"(<varGrp\s[^>]*>.*?)<concept>[^<]*</concept>", r"\1"), "is missing a concept element"),
    ("composite:grid", _sub1(r"(<varGrp\s[^>]*>)", r"\1<labl>x</labl>"), "Variable Group VG_institutionen uses labl"),
    ("type:select_one", _sub1(r"<catValu>[^<]*</catValu>", ""), "A catgry element is missing catValu"),
    (
        "type:select_one",
        _sub1(r"(<catgry>\s*<catValu>[^<]*</catValu>\s*)<labl>[^<]*</labl>", r"\1"),
        "is missing a labl",
    ),
    (
        "composite:grid",
        _sub1(r"<preQTxt>[^<]*</preQTxt>", "<preQTxt>Something else</preQTxt>"),
        "text does not match the preQTxt",
    ),
    (
        "type:select_multiple",
        _sub1(r'<qstn responseDomainType="multiple">', '<qstn responseDomainType="category">'),
        'should have responseDomainType="multiple"',
    ),
    (
        "composite:grid",
        _sub1(r'<qstn responseDomainType="category">', '<qstn responseDomainType="text">'),
        'should have responseDomainType="category"',
    ),
    (
        "variant:select_one_other",
        _sub1(r'(<varGrp\s[^>]*?)\s+var="[^"]+"', r"\1"),
        "must reference variables (@var) or child groups",
    ),
    (
        "variant:select_one_other",
        _sub1(r'(<varGrp\s[^>]*?var=")[^"]+"', r'\1V_aufmerksam V_nope"'),
        "references a variable that does not exist",
    ),
    (
        "variant:select_one_other",
        _sub1(r'(<varGrp\s[^>]*?)\s+var="[^"]+"', r'\1 varGrp="VG_nope"'),
        "references a child varGrp that does not exist",
    ),
    (
        "variant:select_one_other",
        _sub1(r'(name="aufmerksam_other"[^>]*>\s*<qstn responseDomainType=)"text"', r'\1"category"'),
        'Expected "text"',
    ),
    (
        "variant:select_one_other",
        _sub1(r'(name="aufmerksam_other") intrvl="discrete"', r'\1 intrvl="contin"'),
        'Expected "discrete"',
    ),
    (
        "variant:select_one_other",
        _sub1(r'(name="aufmerksam_other".*?<varFormat type=)"character"', r'\1"numeric"'),
        'Expected "character"',
    ),
    (
        "variant:select_one_other",
        _sub1(r'name="aufmerksam_other"', 'name="nobase_other"'),
        "no matching base variable or group",
    ),
    (
        "variant:select_one_other",
        _sub1(r"<catValu>other</catValu>", "<catValu>anders</catValu>"),
        'must have a catgry with catValu="other"',
    ),
]


def _run_assert_mutation(variant_id, mutator, message, worker_jar, java_bin, tmp_path, *, strip_ns=False):
    from .fixtures import load_registry

    variant = next((e for e in load_registry() if e.get("@id") == variant_id), None)
    assert variant is not None, f"{variant_id} not in registry"
    blessed = load_example_ddi(variant)
    assert blessed is not None, f"{variant_id}: no blessed ddi.xml"
    mutated = mutator(blessed)
    assert mutated is not None, f"{variant_id}: mutator found nothing to change"
    if strip_ns:
        mutated = mutated.replace(' xmlns="ddi:codebook:2_5"', "", 1)
    rc, out = _validate(java_bin, worker_jar, mutated.encode(), tmp_path)
    assert rc == 1, f"accepted: {out[:600]}"
    # Log lines precede the JSON report on stdout.
    messages = [e["message"] for e in json.loads(out[out.index("{") :])["errors"]]
    assert any(message in m for m in messages), f"expected {message!r} in {messages}"


@pytest.mark.parametrize(
    "variant_id,mutator,message",
    ASSERT_MUTATIONS,
    ids=[m for _, _, m in ASSERT_MUTATIONS],
)
def test_each_assert_rejects_its_violation(variant_id, mutator, message, worker_jar, java_bin, tmp_path):
    _run_assert_mutation(variant_id, mutator, message, worker_jar, java_bin, tmp_path)


@pytest.mark.parametrize(
    "variant_id,mutator,message",
    ASSERT_MUTATIONS,
    ids=[m for _, _, m in ASSERT_MUTATIONS],
)
def test_unnamespaced_rules_reject_the_same(variant_id, mutator, message, worker_jar, java_bin, tmp_path):
    """The rules repeat without the ddi: prefix for documents that omit the
    namespace; the same mutations must fail there too."""
    _run_assert_mutation(variant_id, mutator, message, worker_jar, java_bin, tmp_path, strip_ns=True)


def test_several_concepts_are_allowed(worker_jar, java_bin, tmp_path):
    """DDI 2.5 allows any number of <concept> (e.g. one per language, #124);
    the concept assert must not crash on two, and still rejects all-empty."""
    from .fixtures import load_registry

    variant = next(e for e in load_registry() if e.get("@id") == "type:select_one")
    xml = load_example_ddi(variant)
    two = re.sub(
        r"(<concept>[^<]*</concept>)",
        r'\1<concept xml:lang="en">Search tag</concept>',
        xml,
        count=2,
    )
    rc, out = _validate(java_bin, worker_jar, two.encode(), tmp_path)
    assert rc == 0, out[out.index("{") :][:800]

    empty = re.sub(r"<concept>[^<]*</concept>", "<concept> </concept>", two)
    empty = re.sub(r'<concept xml:lang="en">[^<]*</concept>', '<concept xml:lang="en"></concept>', empty)
    rc, out = _validate(java_bin, worker_jar, empty.encode(), tmp_path)
    messages = [e["message"] for e in json.loads(out[out.index("{") :])["errors"]]
    assert rc == 1 and any("missing a concept element" in m for m in messages), messages


def test_companion_of_a_name_that_ends_in_other(worker_jar, java_bin, tmp_path):
    """The base of `<x>_other_other` is `<x>_other` (the trailing suffix), not
    `<x>` (the first one); the rule used to cut at the first (#86)."""
    from .fixtures import load_registry

    variant = next(e for e in load_registry() if e.get("@id") == "variant:select_one_other")
    xml = load_example_ddi(variant).replace("aufmerksam", "quelle_other")
    _rc, out = _validate(java_bin, worker_jar, xml.encode(), tmp_path)
    messages = [e["message"] for e in json.loads(out[out.index("{") :])["errors"]]
    assert not any("quelle_other_other" in m for m in messages), messages
