"""Answer each registry entity in a live LimeSurvey and assert what gets stored.

`test_registry_entities.py` proves LimeSurvey *imports* every blessed `tsv.tsv`.
This module goes one step further: import → activate → fill in a real browser →
submit → export responses, then compare the stored values against a blessed
snapshot in `expected/<slug>.json`.

Why it matters: structure tests can't see data semantics. A `time` question that
actually stores a date, an answer code silently truncated to LimeSurvey's
`varchar(5)`, an "other" free text landing in an unexpected column — all of them
import cleanly and only show up in the exported response.

    # bless (first run, or after an intentional change)
    BLESS_RESPONSES=1 uv run pytest test_response_roundtrip.py
    git diff expected/

Requires the docker-compose LimeSurvey plus node + Playwright/Chromium; skips
when Playwright is unavailable.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import respondent
from citric import Client
from test_helpers import cleanup_survey

from codegen import limesurvey_stack as ls_stack

REGISTRY_ENTITIES = Path(__file__).parents[3] / "registry" / "entities"
_ENTITY_TSVS = sorted(REGISTRY_ENTITIES.glob("*/tsv.tsv"))
_SLUGS = [p.parent.name for p in _ENTITY_TSVS if respondent.load_answers(p.parent.name) is not None]

BLESS = os.environ.get("BLESS_RESPONSES") == "1"


@pytest.fixture(scope="module", autouse=True)
def _require_playwright() -> None:
    if not respondent.playwright_available():
        pytest.skip("node + playwright not available (npm i -g playwright && playwright install chromium)")


def test_every_entity_has_answers() -> None:
    """Each entity shipping a tsv.tsv needs an answers fixture, or it goes untested."""
    have = {p.parent.name for p in _ENTITY_TSVS}
    missing = sorted(have - set(_SLUGS))
    assert not missing, f"No answers/<slug>.json for: {missing}"


@pytest.mark.parametrize("slug", _SLUGS)
def test_response_roundtrip(limesurvey_client: Client, slug: str) -> None:
    answers = respondent.load_answers(slug)
    survey_id = ls_stack.import_and_activate(
        limesurvey_client, REGISTRY_ENTITIES / slug / "tsv.tsv", f"Respondent: {slug}"
    )

    try:
        questions = respondent.question_index(limesurvey_client, survey_id)
        for qcode in answers:
            assert qcode in questions, (
                f"{slug}: answers reference unknown question '{qcode}' (have {sorted(questions)})"
            )

        report = respondent.fill_and_submit(ls_stack.public_url(survey_id), questions, answers)
        assert not report["missed"], f"{slug}: could not locate inputs: {report['missed']}"
        assert report["submitted"], f"{slug}: survey did not reach its end page (errors: {report['errors']})"

        rows = respondent.export_stored_answers(limesurvey_client, survey_id)
        assert len(rows) == 1, f"{slug}: expected exactly 1 stored response, got {len(rows)}"
        stored = rows[0]

        if BLESS:
            path = respondent.bless_expected(slug, stored)
            print(f"\n✎ blessed {path.relative_to(Path(__file__).parent)}: {stored}")
            return

        expected = respondent.load_expected(slug)
        assert expected is not None, f"{slug}: no expected/{slug}.json — run with BLESS_RESPONSES=1"
        assert stored == expected, f"{slug}: stored response drifted from snapshot"
    finally:
        cleanup_survey(limesurvey_client, survey_id)
