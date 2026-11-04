"""An optional question with a constraint can be left empty, as in ODK (#214).

ODK evaluates a constraint only on an answered question; LimeSurvey evaluates
`em_validation_q` on an empty answer too. The converter guards the equation
(convention:logicMapping `emptyAnswer`); this drives a real respondent through
the converted survey to check that an empty answer passes and a wrong one is
still rejected. `coalesce()` (#213) is checked on the same page.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest
import respondent
from citric import Client
from test_helpers import cleanup_survey

from codegen import limesurvey_stack as ls_stack

REPO_ROOT = Path(__file__).resolve().parents[3]

CONVERT = """
import { xlsformToLstsv } from './dist/index.js';
process.stdout.write(await xlsformToLstsv(JSON.parse(process.argv[1]), { skipValidation: true }));
"""

FORM = {
    "surveyData": [
        {"type": "integer", "name": "zahl", "label": "Number?", "constraint": ". >= 0 and . <= 100"},
        {
            "type": "select_multiple m",
            "name": "welche",
            "label": "Which?",
            "constraint": "not(count-selected(.) < 2)",
        },
        {
            "type": "integer",
            "name": "rest",
            "label": "Rest?",
            "constraint": "coalesce(${zahl}, 0) + . <= 100",
        },
    ],
    "choicesData": [
        {"list_name": "m", "name": "a", "label": "A"},
        {"list_name": "m", "name": "b", "label": "B"},
        {"list_name": "m", "name": "c", "label": "C"},
    ],
}


@pytest.fixture(scope="module", autouse=True)
def _require_playwright() -> None:
    if not respondent.playwright_available():
        pytest.skip("node + playwright not available (npm i -g playwright && playwright install chromium)")


@pytest.fixture(scope="module")
def tsv(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = subprocess.run(
        ["node", "--input-type=module", "-e", CONVERT, json.dumps(FORM)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    path = tmp_path_factory.mktemp("empty") / "empty_constraint.tsv"
    path.write_text(out.stdout)
    return path


@pytest.mark.parametrize(
    ("answers", "submitted"),
    [
        ({}, True),
        ({"zahl": "50", "welche": ["a", "b"], "rest": "50"}, True),
        ({"zahl": "500"}, False),
        ({"welche": ["a"]}, False),
        ({"rest": "101"}, False),
        ({"zahl": "60", "rest": "50"}, False),
    ],
    ids=[
        "all-empty",
        "all-valid",
        "out-of-range",
        "too-few",
        "coalesce-empty-is-0",
        "coalesce-sum",
    ],
)
def test_empty_optional_answer_passes(
    limesurvey_client: Client, tsv: Path, answers: dict[str, Any], submitted: bool
) -> None:
    survey_id = ls_stack.import_and_activate(limesurvey_client, tsv, "empty optional + constraint")
    try:
        questions = respondent.question_index(limesurvey_client, survey_id)
        report = respondent.fill_and_submit(ls_stack.public_url(survey_id), questions, answers)
        assert not report["missed"], report["missed"]
        assert report["submitted"] is submitted, report
    finally:
        cleanup_survey(limesurvey_client, survey_id)
