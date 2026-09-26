"""Every whole-survey fixture's blessed TSV imports into a live LimeSurvey
with exactly its questions (#94).

The scenario tests (test_basic_functionality.py, test_all_types.py, …) name
particular surveys; a new fixture was imported nowhere until one was written.
This one discovers them all, like test_registry_entities.py does for entities.
"""

import csv
from pathlib import Path

import pytest
from citric import Client
from test_helpers import cleanup_survey, import_survey_from_tsv

REPO_ROOT = Path(__file__).parents[3]
_SURVEY_TSVS = sorted((REPO_ROOT / "tests" / "fixtures" / "surveys").glob("*/tsv.tsv"))


def _question_codes(tsv_path: Path) -> set[str]:
    """Question codes (Q rows) in the survey's base language."""
    rows = list(csv.DictReader(tsv_path.open(encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE))
    base = next(r["text"] for r in rows if r["class"] == "S" and r["name"] == "language")
    return {r["name"] for r in rows if r["class"] == "Q" and r["language"] == base}


def test_survey_fixtures_discovered() -> None:
    assert _SURVEY_TSVS, "no tests/fixtures/surveys/*/tsv.tsv found"


@pytest.mark.parametrize("tsv_path", _SURVEY_TSVS, ids=[p.parent.name for p in _SURVEY_TSVS])
def test_survey_fixture_imports(limesurvey_client: Client, tsv_path: Path) -> None:
    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, f"Survey fixture: {tsv_path.parent.name}")
    try:
        questions = limesurvey_client.list_questions(survey_id)
        imported = {str(q["title"]) for q in questions if str(q.get("parent_qid") or "0") in ("0", "None")}
        assert imported == _question_codes(tsv_path)
    finally:
        cleanup_survey(limesurvey_client, survey_id)
