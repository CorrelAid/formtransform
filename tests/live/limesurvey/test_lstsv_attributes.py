"""Question attributes and codes the converter writes survive a real
LimeSurvey import: `array_filter` on a list question (convention:choiceFilter,
formtransform#187), `min_answers` / `max_answers` (selectionCount, #186), a
dropdown with derived vocabulary codes (externalCodeList, #188) and a form
converted with --sanitize (lstsvMapping, #189).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from citric import Client
from test_helpers import cleanup_survey, import_survey_from_tsv

REPO_ROOT = Path(__file__).resolve().parents[3]

CONVERT = """
import { xlsformToLstsvWithMapping } from './dist/index.js';
const { survey, choices, fileChoices, sanitize } = JSON.parse(process.argv[1]);
const { tsv, mapping } = await xlsformToLstsvWithMapping(
  { surveyData: survey, choicesData: choices, settingsData: [{ form_title: 'Live', default_language: 'de' }] },
  { fileChoices, sanitize, onWarning: () => {} },
);
process.stdout.write(JSON.stringify({ tsv, mapping }));
"""


def _convert(tmp_path: Path, form: dict) -> tuple[Path, dict]:
    out = subprocess.run(
        ["node", "--input-type=module", "-e", CONVERT, json.dumps(form)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    result = json.loads(out.stdout)
    path = tmp_path / "live.tsv"
    path.write_text(result["tsv"])
    return path, result["mapping"]


def _questions(client: Client, survey_id: int) -> dict[str, dict]:
    return {q["title"]: q for q in client.list_questions(survey_id)}


def _attributes(client: Client, qid: int) -> dict:
    return client.get_question_properties(qid, settings=["attributes"]).get("attributes", {})


THEMEN = [
    {"list_name": "themen", "name": "umw", "label": "Umwelt"},
    {"list_name": "themen", "name": "bil", "label": "Bildung"},
    {"list_name": "themen", "name": "arb", "label": "Arbeit"},
]


def test_array_filter_on_a_list_question(limesurvey_client: Client, tmp_path: Path) -> None:
    form = {
        "survey": [
            {"type": "select_multiple themen", "name": "k04", "label": "Welche?"},
            {
                "type": "select_one nr",
                "name": "k04haupt",
                "label": "Welches am meisten?",
                "choice_filter": "selected(${k04}, kurz)",
            },
        ],
        "choices": [
            *THEMEN,
            {"list_name": "nr", "name": "1", "label": "Umwelt", "kurz": "umw"},
            {"list_name": "nr", "name": "2", "label": "Bildung", "kurz": "bil"},
            {"list_name": "nr", "name": "3", "label": "Arbeit", "kurz": "arb"},
        ],
    }
    tsv, _ = _convert(tmp_path, form)
    survey_id = import_survey_from_tsv(limesurvey_client, tsv, "Array filter")
    try:
        q = _questions(limesurvey_client, survey_id)["k04haupt"]
        assert q["type"] == "L"
        attrs = _attributes(limesurvey_client, q["qid"])
        assert attrs.get("array_filter") == "k04", f"array_filter lost on import: {attrs}"
        answers = limesurvey_client.get_question_properties(q["qid"], settings=["answeroptions"])
        codes = sorted(answers["answeroptions"].keys())
        assert codes == ["arb", "bil", "umw"], codes
    finally:
        cleanup_survey(limesurvey_client, survey_id)


def test_min_and_max_answers(limesurvey_client: Client, tmp_path: Path) -> None:
    form = {
        "survey": [
            {
                "type": "select_multiple themen",
                "name": "k04",
                "label": "Welche?",
                "constraint": "count-selected(.) >= 1 and count-selected(.) <= 2",
            },
        ],
        "choices": THEMEN,
    }
    tsv, _ = _convert(tmp_path, form)
    survey_id = import_survey_from_tsv(limesurvey_client, tsv, "Min max answers")
    try:
        q = _questions(limesurvey_client, survey_id)["k04"]
        attrs = _attributes(limesurvey_client, q["qid"])
        assert attrs.get("min_answers") == "1", attrs
        assert attrs.get("max_answers") == "2", attrs
    finally:
        cleanup_survey(limesurvey_client, survey_id)


def test_long_file_list_dropdown_with_derived_codes(limesurvey_client: Client, tmp_path: Path) -> None:
    codes = [str(10_000_000_000 + i * 7919).zfill(12) for i in range(300)]
    form = {
        "survey": [
            {
                "type": "select_one_from_file kommunen.csv",
                "name": "kommune",
                "label": "Gemeinde?",
                "appearance": "autocomplete",
            }
        ],
        "choices": [],
        "fileChoices": {
            "kommunen.csv": [
                {"list_name": "kommunen.csv", "name": c, "label": f"Gemeinde {i}"} for i, c in enumerate(codes)
            ]
        },
    }
    tsv, mapping = _convert(tmp_path, form)
    survey_id = import_survey_from_tsv(limesurvey_client, tsv, "Long file list")
    try:
        q = _questions(limesurvey_client, survey_id)["kommune"]
        assert q["type"] == "!"
        options = limesurvey_client.get_question_properties(q["qid"], settings=["answeroptions"])["answeroptions"]
        # Every derived code arrived unchanged (LimeSurvey stores varchar(5)),
        # and the mapping gives each one its file code back.
        assert sorted(options) == sorted(mapping["codes"]["kommune"])
        assert sorted(mapping["codes"]["kommune"].values()) == sorted(codes)
    finally:
        cleanup_survey(limesurvey_client, survey_id)


def test_a_sanitized_form_imports(limesurvey_client: Client, tmp_path: Path) -> None:
    form = {
        "survey": [
            {"type": "select_one anw", "name": "k10_reisezeit", "label": "Reisezeit?"},
            {"type": "text", "name": "k23_ars", "label": "ARS", "relevant": "${k10_reisezeit} = '-98'"},
            {"type": "select_one anw", "name": "v_", "label": "a"},
            {"type": "select_one anw", "name": "v", "label": "b"},
        ],
        "choices": [
            {"list_name": "anw", "name": "abwesend", "label": "Abwesend"},
            {"list_name": "anw", "name": "-98", "label": "Weiß nicht"},
        ],
        "sanitize": True,
    }
    tsv, mapping = _convert(tmp_path, form)
    survey_id = import_survey_from_tsv(limesurvey_client, tsv, "Sanitized")
    try:
        qs = _questions(limesurvey_client, survey_id)
        assert set(mapping["names"]) <= set(qs), (mapping["names"], list(qs))
        assert len(qs) == 4
        assert qs["k23ars"]["relevance"].replace(" ", "") == "k10reisezeit=='n98'"
        options = limesurvey_client.get_question_properties(qs["k10reisezeit"]["qid"], settings=["answeroptions"])
        assert sorted(options["answeroptions"]) == ["abwes", "n98"]
    finally:
        cleanup_survey(limesurvey_client, survey_id)
