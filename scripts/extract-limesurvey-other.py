"""Write LimeSurvey's own "Other:" wording per language into convention:other.

LimeSurvey labels its native "other" answer with the question's
`other_replace_text`, else `gT('Other:')` in the survey language
(application/core/QuestionTypes/ListRadio/RenderListRadio.php). This reads
that msgid from LimeSurvey's compiled translations at the release the
registry pins, for every code in convention:languageTagging, and stores the
result as `rule.limesurveyOtherText` in registry/conventions/other.jsonld.

Usage: uv run python scripts/extract-limesurvey-other.py
Then: uv run python -m codegen
"""

import gettext
import io
import json
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAG = "6.16.4+260113"
BASE = f"https://raw.githubusercontent.com/LimeSurvey/LimeSurvey/{TAG.replace('+', '%2B')}/locale"
MSGID = "Other:"


def codes() -> list[str]:
    graph = json.loads((ROOT / "registry/conventions/languageTagging.jsonld").read_text())["@graph"]
    return graph[0]["rule"]["lsTsvHandling"]["limesurveyLanguages"]["codes"]


def wording(code: str) -> str | None:
    """The code's translation of "Other:", or None if LimeSurvey ships none."""
    try:
        with urllib.request.urlopen(f"{BASE}/{code}/{code}.mo", timeout=30) as r:
            data = r.read()
    except urllib.error.HTTPError:
        return None
    text = gettext.GNUTranslations(io.BytesIO(data)).gettext(MSGID)
    # English is the source language: its catalog returns the msgid itself.
    return text if text != MSGID or code == "en" else None


def main() -> None:
    texts = {}
    for code in codes():
        text = wording(code)
        if text:
            texts[code] = text
    path = ROOT / "registry/conventions/other.jsonld"
    doc = json.loads(path.read_text())
    rule = doc["@graph"][0]["rule"]
    rule["limesurveyOtherText"] = {
        "use": rule.get("limesurveyOtherText", {}).get("use", ""),
        "source": f"LimeSurvey {TAG} locale/<code>/<code>.mo, msgid {MSGID!r}",
        # A language without a translation shows the msgid, as gettext does.
        "fallback": MSGID,
        "texts": texts,
    }
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(texts)} of {len(codes())} languages")


if __name__ == "__main__":
    main()
