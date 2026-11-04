"""convention:randomOrder survives a real LimeSurvey import (formtransform#213).

`parameters: randomize=true` must import as LimeSurvey 6's ordering attribute:
`answer_order=random` on a list, `subquestion_order=random` on a multiple
choice. A randomized multiple choice's exclusive answers stay in place through
`keep_codes_order`, an attribute LimeSurvey has from 6.17 on.
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
process.stdout.write(await new XLSFormToTSVConverter({ onWarning: () => {} }).convert(survey, choices, [{ form_title: 'Random order', default_language: 'de' }]));
"""


def _tsv(tmp_path: Path) -> Path:
    form = {
        "survey": [
            {"type": "select_multiple l", "name": "themen", "label": "Welche Themen?", "parameters": "randomize=true"},
            {
                "type": "select_one l",
                "name": "haupt",
                "label": "Welches am meisten?",
                "choice_filter": "selected(${themen}, name)",
                "parameters": "randomize=true",
            },
        ],
        "choices": [
            {"list_name": "l", "name": "umw", "label": "Umwelt"},
            {"list_name": "l", "name": "bil", "label": "Bildung"},
            {"list_name": "l", "name": "arb", "label": "Arbeit"},
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
    path = tmp_path / "random_order.tsv"
    path.write_text(out.stdout)
    return path


def _version(client: Client) -> tuple[int, ...]:
    raw = str(client.get_server_version())
    return tuple(int(p) for p in raw.split(".")[:2] if p.isdigit())


def test_random_order_survives_import(limesurvey_client: Client, tmp_path: Path) -> None:
    survey_id = import_survey_from_tsv(limesurvey_client, _tsv(tmp_path), "Random order")
    try:
        questions = {q["title"]: q for q in limesurvey_client.list_questions(survey_id)}

        def attrs(name: str) -> dict:
            props = limesurvey_client.get_question_properties(questions[name]["qid"], settings=["attributes"])
            return props.get("attributes", {})

        themen, haupt = attrs("themen"), attrs("haupt")
        assert themen.get("subquestion_order") == "random", themen
        assert haupt.get("answer_order") == "random", haupt
        assert haupt.get("array_filter") == "themen", haupt
        if _version(limesurvey_client) >= (6, 17):
            assert themen.get("keep_codes_order") == "keine", themen
    finally:
        cleanup_survey(limesurvey_client, survey_id)
