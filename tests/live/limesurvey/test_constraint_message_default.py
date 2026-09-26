"""constraint_message and select defaults survive a LimeSurvey import (#103)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from citric import Client
from test_helpers import cleanup_survey, import_survey_from_tsv

REPO_ROOT = Path(__file__).resolve().parents[3]
COMPOSE_DIR = REPO_ROOT / "tests" / "live" / "limesurvey"

CONVERT = """
import { xlsformToLstsv } from './dist/index.js';
process.stdout.write(await xlsformToLstsv(JSON.parse(process.argv[1]), { skipValidation: true }));
"""

FORM = {
    "surveyData": [
        {
            "type": "integer",
            "name": "age",
            "label": "Age?",
            "constraint": ". > 0",
            "constraint_message": "Must be positive",
        },
        {"type": "select_one l", "name": "rating", "label": "Rating?", "default": "very_good"},
        {"type": "select_multiple l", "name": "picks", "label": "Picks?", "default": "very_good okay"},
    ],
    "choicesData": [
        {"list_name": "l", "name": "very_good", "label": "Very good"},
        {"list_name": "l", "name": "bad", "label": "Bad"},
        {"list_name": "l", "name": "okay", "label": "Okay"},
    ],
}


def _tsv(tmp_path: Path) -> Path:
    out = subprocess.run(
        ["node", "--input-type=module", "-e", CONVERT, json.dumps(FORM)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    path = tmp_path / "defaults.tsv"
    path.write_text(out.stdout)
    return path


def _sql(sql: str) -> str:
    out = subprocess.run(
        [
            "docker",
            "compose",
            "exec",
            "-T",
            "mysql",
            "mysql",
            "-N",
            "-ulimesurvey",
            "-plimesurvey",
            "limesurvey",
            "-e",
            sql,
        ],
        cwd=COMPOSE_DIR,
        capture_output=True,
        text=True,
    )
    assert out.returncode == 0, out.stderr
    return out.stdout


def _defaults(survey_id: int) -> dict[str, str]:
    """Question/subquestion code → stored default value, straight from the DB
    (RemoteControl exposes no defaults). The table prefix is the image's."""
    table = _sql("SHOW TABLES LIKE '%defaultvalues'").split()[0]
    prefix = table[: -len("defaultvalues")]
    out = _sql(
        f"SELECT q.title, l.defaultvalue FROM {prefix}defaultvalues d "
        f"JOIN {prefix}defaultvalue_l10ns l ON l.dvid = d.dvid "
        f"JOIN {prefix}questions q ON q.qid = COALESCE(NULLIF(d.sqid, 0), d.qid) "
        f"WHERE q.sid = {int(survey_id)}"
    )
    return dict(line.split("\t", 1) for line in out.splitlines() if "\t" in line)


def test_tip_and_defaults_survive_import(limesurvey_client: Client, tmp_path: Path) -> None:
    survey_id = import_survey_from_tsv(limesurvey_client, _tsv(tmp_path), "constraint_message + defaults")
    try:
        questions = {str(q["title"]): q for q in limesurvey_client.list_questions(survey_id)}
        age = limesurvey_client.get_question_properties(questions["age"]["qid"], settings=["attributes_lang"])
        assert (age.get("attributes_lang") or {}).get("em_validation_q_tip") == "Must be positive", age
        defaults = _defaults(survey_id)
        assert defaults.get("rating") == "veryg", defaults
        assert {k for k, v in defaults.items() if v == "Y"} == {"veryg", "okay"}, defaults
    finally:
        cleanup_survey(limesurvey_client, survey_id)
