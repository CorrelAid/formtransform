"""convention:other folds into LimeSurvey's native "other" (formtransform#79).

The XLSForm `<question>_other` companion is not imported as a question of its
own: LimeSurvey's "other" text box replaces it, labelled with the companion's
label through the `other_replace_text` question attribute.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from citric import Client
from test_helpers import cleanup_survey, import_survey_from_tsv

REPO_ROOT = Path(__file__).resolve().parents[3]

CONVERT = """
import { xlsformToLstsv } from './dist/index.js';
process.stdout.write(await xlsformToLstsv(JSON.parse(process.argv[1])));
"""


def _tsv(tmp_path: Path, slug: str) -> Path:
    fixture = json.loads((REPO_ROOT / "registry" / "entities" / slug / "fixtures" / "xlsform.json").read_text())
    form = {
        "surveyData": fixture["survey"],
        "choicesData": fixture["choices"],
        "settingsData": fixture.get("settings", []),
    }
    out = subprocess.run(
        ["node", "--input-type=module", "-e", CONVERT, json.dumps(form)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    path = tmp_path / f"{slug}.tsv"
    path.write_text(out.stdout)
    return path


@pytest.mark.parametrize(
    ("slug", "base"),
    [("select_one_other", "aufmerksam"), ("select_multiple_other", "geraetebesitz")],
)
def test_companion_folds_into_native_other(limesurvey_client: Client, tmp_path: Path, slug: str, base: str) -> None:
    survey_id = import_survey_from_tsv(limesurvey_client, _tsv(tmp_path, slug), slug)
    try:
        questions = limesurvey_client.list_questions(survey_id)
        titles = {q["title"] for q in questions}
        assert f"{base}other" not in titles, f"companion imported as its own question: {titles}"
        q = next(q for q in questions if q["title"] == base)
        props = limesurvey_client.get_question_properties(q["qid"], settings=["other", "attributes_lang"])
        assert props.get("other") == "Y"
        lang_attrs = props.get("attributes_lang") or {}
        assert lang_attrs.get("other_replace_text") == "Sonstiges (bitte angeben)", (
            f"companion label lost on import: {lang_attrs}"
        )
    finally:
        cleanup_survey(limesurvey_client, survey_id)
