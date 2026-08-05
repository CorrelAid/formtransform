"""Drive a live LimeSurvey as a *respondent* and read the stored data back.

The rest of this suite proves LimeSurvey accepts our blessed TSVs (structure).
This module closes the loop on *data*: activate the survey, fill it in a real
browser, submit, then export the responses via the RemoteControl API and compare
the stored values against a blessed snapshot. That is what catches the class of
bug a structural import test cannot see — a `time` question that stores a date,
an answer code LimeSurvey truncates, an "other" free text that lands in an
unexpected column.

Browser work is delegated to `fill_limesurvey.mjs` (Playwright); everything
LimeSurvey-API is done here with citric.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from citric import Client

HERE = Path(__file__).parent
FILL_SCRIPT = HERE / "fill_limesurvey.mjs"
ANSWERS_DIR = HERE / "answers"
EXPECTED_DIR = HERE / "expected"

# Response columns LimeSurvey adds itself — not question data, and unstable
# across runs (ids, timestamps, seeds), so they never enter a snapshot.
_META_FIELDS = frozenset(
    {
        "id",
        "submitdate",
        "lastpage",
        "startlanguage",
        "seed",
        "token",
        "startdate",
        "datestamp",
        "ipaddr",
        "refurl",
        "interviewtime",
    }
)


def playwright_available() -> bool:
    """Playwright is resolved by the node script, locally or globally."""
    if shutil.which("node") is None:
        return False
    probe = "try{require('playwright')}catch(e){require('/usr/lib/node_modules/playwright')}"
    return subprocess.run(["node", "-e", probe], capture_output=True).returncode == 0


def question_index(client: Client, survey_id: int) -> dict[str, dict[str, Any]]:
    """Map question code → {qid, type}, parent questions only.

    Subquestions carry their own qid but are never addressed directly: the
    respondent interacts with inputs *inside* the parent's `#question<qid>`
    block, keyed by subquestion code.
    """
    index: dict[str, dict[str, Any]] = {}
    for q in client.list_questions(survey_id):
        parent = str(q.get("parent_qid") or "0")
        if parent not in ("0", "None"):
            continue
        index[str(q["title"])] = {"qid": int(q["qid"]), "type": q.get("type")}
    return index


def fill_and_submit(url: str, questions: dict[str, dict[str, Any]], answers: dict[str, Any]) -> dict[str, Any]:
    """Run the Playwright filler against `url`; return its JSON report."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        json.dump({"url": url, "questions": questions, "answers": answers}, fh)
        spec_path = fh.name
    proc = subprocess.run(
        ["node", str(FILL_SCRIPT), spec_path],
        capture_output=True,
        text=True,
        timeout=180,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"filler failed ({proc.returncode}): {proc.stderr.strip()[:2000]}")
    return json.loads(proc.stdout)


def export_stored_answers(client: Client, survey_id: int) -> list[dict[str, Any]]:
    """Export submitted responses as question-code-keyed dicts, metadata stripped.

    `heading_type="code"` keys columns by question code (`institutionen[SQ001]`
    style for subquestions) rather than by question text, and
    `response_type="short"` returns the *stored* codes rather than their labels —
    both are what a downstream DDI/statistical consumer actually reads.
    """
    raw = client.export_responses(
        survey_id,
        file_format="json",
        completion_status="all",
        heading_type="code",
        response_type="short",
    )
    payload = json.loads(raw.decode("utf-8"))
    rows = payload.get("responses", payload) if isinstance(payload, dict) else payload

    out: list[dict[str, Any]] = []
    for row in rows or []:
        # LimeSurvey has shipped both {"<id>": {...}} and flat {...} rows.
        record = next(iter(row.values())) if len(row) == 1 and isinstance(next(iter(row.values())), dict) else row
        answers = {k: v for k, v in record.items() if k not in _META_FIELDS and v not in ("", None)}
        out.append(answers)
    return out


def load_answers(slug: str) -> dict[str, Any] | None:
    path = ANSWERS_DIR / f"{slug}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_expected(slug: str) -> dict[str, Any] | None:
    path = EXPECTED_DIR / f"{slug}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def bless_expected(slug: str, stored: dict[str, Any]) -> Path:
    EXPECTED_DIR.mkdir(parents=True, exist_ok=True)
    path = EXPECTED_DIR / f"{slug}.json"
    path.write_text(json.dumps(stored, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    return path
