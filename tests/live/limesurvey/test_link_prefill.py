"""A `hidden` question takes its value from the survey link in a live
LimeSurvey (convention:linkPrefill, formtransform#207): `?partner=…` is
stored with the response, and a question the link doesn't name keeps its
default.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import respondent
from citric import Client
from test_helpers import cleanup_survey

from codegen import limesurvey_stack as ls_stack

TSV = Path(__file__).parents[3] / "registry" / "entities" / "hidden" / "tsv.tsv"


@pytest.fixture(scope="module", autouse=True)
def _require_playwright() -> None:
    if not respondent.playwright_available():
        pytest.skip("node + playwright not available (npm i -g playwright && playwright install chromium)")


def test_link_prefills_a_hidden_question(limesurvey_client: Client) -> None:
    survey_id = ls_stack.import_and_activate(limesurvey_client, TSV, "Link prefill")
    try:
        questions = respondent.question_index(limesurvey_client, survey_id)
        url = ls_stack.public_url(survey_id)
        url += ("&" if "?" in url else "?") + "partner=TEST"
        report = respondent.fill_and_submit(url, questions, {"anmerkungen": "Alles gut, danke."})
        assert report["submitted"], f"survey did not reach its end page (errors: {report['errors']})"

        rows = respondent.export_stored_answers(limesurvey_client, survey_id)
        assert len(rows) == 1
        assert rows[0]["partner"] == "TEST"
        assert rows[0]["modul"] == "O"
    finally:
        cleanup_survey(limesurvey_client, survey_id)
