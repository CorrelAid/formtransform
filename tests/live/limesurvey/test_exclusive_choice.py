"""convention:exclusiveChoice survives a real LimeSurvey import (formtransform#53).

A select_multiple whose choices sheet marks answers `exclusive` must import with
the `exclude_all_others` question attribute holding those answer codes. That is
what makes LimeSurvey untick the other answers.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from citric import Client
from test_helpers import cleanup_survey, import_survey_from_tsv

REPO_ROOT = Path(__file__).resolve().parents[3]

CONVERT = """
import { XLSFormToTSVConverter } from './dist/index.js';
const { survey, choices } = JSON.parse(process.argv[1]);
process.stdout.write(await new XLSFormToTSVConverter().convert(survey, choices, [{ form_title: 'Exclusive', default_language: 'en' }]));
"""


def _tsv(tmp_path: Path) -> Path:
    form = {
        "survey": [{"type": "select_multiple l", "name": "geraete", "label": "Welche Geräte?"}],
        "choices": [
            {"list_name": "l", "name": "handy", "label": "Handy"},
            {"list_name": "l", "name": "laptop", "label": "Laptop"},
            {"list_name": "l", "name": "keine", "label": "Keine davon", "exclusive": "yes"},
        ],
    }
    out = subprocess.run(
        ["node", "--input-type=module", "-e", CONVERT, json.dumps(form)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    path = tmp_path / "exclusive.tsv"
    path.write_text(out.stdout)
    return path


def test_exclude_all_others_survives_import(limesurvey_client: Client, tmp_path: Path) -> None:
    survey_id = import_survey_from_tsv(limesurvey_client, _tsv(tmp_path), "Exclusive choice")
    try:
        questions = limesurvey_client.list_questions(survey_id)
        q = next(q for q in questions if q["title"] == "geraete")
        props = limesurvey_client.get_question_properties(q["qid"], settings=["attributes"])
        attrs = props.get("attributes", {})
        assert attrs.get("exclude_all_others") == "keine", f"exclusive answer lost on import: {attrs}"
    finally:
        cleanup_survey(limesurvey_client, survey_id)
