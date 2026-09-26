"""Derive per-example artifacts (meta.json, xlsform.xlsx) + the examples index.

An "example" is any registry entity that carries an ``exampleDir`` — a
QuestionType's own default example, a QuestionTypeVariant, or a Composite. Each
lives in a self-contained ``registry/<slug>/`` folder with its fixtures.
"""

import json
import sys
from pathlib import Path
from typing import Any


def build_example_artifacts(
    registry: dict[str, Any],
    base_dir: Path,
    bless_snapshots: bool = False,
) -> dict[str, dict]:
    """For each entity with an example, derive the registry-only `xlsform.xlsx`
    rendering alongside the source xlsform.json. (No meta.json — metadata lives
    in the entity's definition.jsonld.)

    Driver-derived snapshots (`ddi.xml`) are written ONLY when
    `bless_snapshots=True`. Pass `--bless-snapshots` to `uv run codegen`, or run
    `npm run bless`. Default codegen leaves them untouched so
    `test_snapshots.py` compares the current driver against a stable, human-
    blessed reference instead of regenerating against itself.

    TSV snapshots (`tsv.tsv`) are blessed by `npm run bless -- tsv`
    using this repo's own converter (dist/index.js), not by codegen.

    Returns availability report keyed by example id.
    """
    report: dict[str, dict] = {}

    try:
        import openpyxl  # noqa: F401

        have_xlsx = True
    except ImportError:
        have_xlsx = False
        print(
            "codegen: openpyxl not installed, so no generated/xlsform.xlsx is written "
            "(install the dev group: `uv sync`)",
            file=sys.stderr,
        )

    # ddi.xml is blessed by scripts/bless-ddi-snapshots.mjs using this repo's
    # own emitter (dist/index.js), not here — same pattern as tsv.tsv.

    for _type_id, data in registry.items():
        ex_dir_rel = data.get("exampleDir")
        if not ex_dir_rel:
            continue
        ex_dir = base_dir / ex_dir_rel
        src = ex_dir / "fixtures" / "xlsform.json"
        if not src.exists():
            continue

        eid = ex_dir.name
        rep = {"xlsx": False, "ddi": False}
        xlsform = json.loads(src.read_text())
        label = data.get("skos:prefLabel") or eid

        # No meta.json is written — all metadata lives in the entity's
        # definition.jsonld (its single source), which downstream reads directly.

        # xlsform.xlsx — write three sheets (survey, choices, settings)
        if have_xlsx:
            from openpyxl import Workbook

            wb = Workbook()
            ws_s = wb.active
            ws_s.title = "survey"
            survey_rows = xlsform.get("survey", [])
            s_cols = sorted({k for r in survey_rows for k in r})
            if not s_cols:
                s_cols = ["type", "name", "label"]
            ws_s.append(s_cols)
            for r in survey_rows:
                ws_s.append([r.get(c, "") for c in s_cols])

            ws_c = wb.create_sheet("choices")
            choices = xlsform.get("choices", [])
            c_cols = sorted({k for r in choices for k in r})
            if not c_cols:
                c_cols = ["list_name", "name", "label"]
            ws_c.append(c_cols)
            for r in choices:
                ws_c.append([r.get(c, "") for c in c_cols])

            ws_set = wb.create_sheet("settings")
            ws_set.append(["form_title", "form_id", "default_language"])
            ws_set.append([label, eid, "default"])

            (ex_dir / "generated").mkdir(exist_ok=True)
            wb.save(ex_dir / "generated" / "xlsform.xlsx")
            rep["xlsx"] = True

        # ddi.xml — blessed separately via scripts/bless-ddi-snapshots.mjs
        # tsv.tsv — blessed separately via scripts/bless-tsv-snapshots.mjs

        report[eid] = rep

    return report
