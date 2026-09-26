"""Validate blessed XLSForm fixtures with an external oracle: pyxform.

Every entity's `xlsform.xlsx` is the canonical source input for the TS
converters (XLSForm -> LimeSurvey TSV and XLSForm -> DDI). Those converters
parse the xlsx with an in-repo SheetJS loader, so nothing independently
confirms the fixtures are *valid XLSForm* — i.e. that a standards-compliant
XLSForm engine (ODK Collect / Enketo, via pyxform) would accept them.

pyxform validates the input, not our outputs: it emits ODK XForm XML, not
LimeSurvey TSV or DDI, so it cannot serve as a converter oracle. It catches
malformed fixtures (bad type strings, dangling list_names, missing columns)
before they silently poison the snapshot suite.

Install: pyxform is in the dev dependency group (`uv run pytest`). If absent,
the whole module skips (mirrors the java-worker skip in test_ddi_schema.py).
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from .fixtures import REPO_ROOT, example_dir, examples

pyxform = pytest.importorskip("pyxform", reason="pyxform not installed (dev dependency group)")
from pyxform.xls2xform import convert  # noqa: E402  (after importorskip)

# codegen renders each entity's xlsx into <exampleDir>/generated/ (gitignored).
_XLSX = "generated/xlsform.xlsx"
_ENTITIES = [(e["@id"], e) for e in examples() if (example_dir(e) / _XLSX).exists()]


@pytest.mark.parametrize("entity_id,entity", _ENTITIES, ids=[eid for eid, _ in _ENTITIES])
def test_xlsform_fixture_is_valid_xlsform(entity_id: str, entity: dict) -> None:
    """pyxform must accept the fixture and emit a non-empty XForm."""
    xlsx = example_dir(entity) / _XLSX
    result = convert(str(xlsx))
    assert result.xform and result.xform.strip(), f"pyxform produced empty XForm for {entity_id} ({xlsx})"


def test_at_least_one_fixture_checked() -> None:
    """Guard against the parametrization silently collapsing to zero cases."""
    if not any((example_dir(e) / "generated").is_dir() for e in examples()):
        pytest.skip("no generated/ artifacts present -- run `python -m codegen` first")
    assert _ENTITIES, f"No {_XLSX} fixtures discovered under registry/entities/"


# -- whole-survey fixtures (#94) ----------------------------------------------

_SURVEYS_DIR = REPO_ROOT / "tests" / "fixtures" / "surveys"
_SURVEYS = sorted(d for d in _SURVEYS_DIR.iterdir() if d.is_dir())

# Fixtures pyxform rejects on purpose, with the reason.
_PYXFORM_INVALID = {
    "hints_survey": (
        "carries a guidance hint as `guidance_hint=<text with spaces>` in `parameters`, "
        "the encoding qwacback's DDI → XLSForm export writes; pyxform requires "
        "space-free key=value tokens there"
    ),
}


def _survey_xlsx(survey_dir: Path, tmp_path: Path) -> Path:
    """The fixture's xlsx, or its xlsform.json rendered to one (openpyxl)."""
    xlsx = survey_dir / "xlsform.xlsx"
    if xlsx.exists():
        return xlsx
    from openpyxl import Workbook

    data = json.loads((survey_dir / "xlsform.json").read_text())
    wb = Workbook()
    wb.remove(wb.active)
    for sheet in ("survey", "choices", "settings"):
        rows = data.get(sheet) or []
        if not rows:
            continue
        ws = wb.create_sheet(sheet)
        if sheet == "settings":
            # Settings aren't translatable in XLSForm: keep the default language.
            rows = [
                {
                    k: (v.get(r.get("default_language"), next(iter(v.values()))) if isinstance(v, dict) else v)
                    for k, v in r.items()
                }
                for r in rows
            ]
        # A {lang: text} cell becomes one `<column>::<lang>` column per language.
        flat = [
            {
                **{k: v for k, v in r.items() if not isinstance(v, dict)},
                **{f"{k}::{lang}": t for k, v in r.items() if isinstance(v, dict) for lang, t in v.items()},
            }
            for r in rows
            if isinstance(r, dict)
        ]
        cols = [c for c in dict.fromkeys(k for r in flat for k in r) if not c.startswith("_")]
        ws.append(cols)
        for r in flat:
            ws.append([r.get(c, "") for c in cols])
    out = tmp_path / f"{survey_dir.name}.xlsx"
    wb.save(out)
    return out


@pytest.mark.parametrize(
    "survey_dir",
    [
        pytest.param(d, marks=pytest.mark.xfail(strict=True, reason=_PYXFORM_INVALID[d.name]))
        if d.name in _PYXFORM_INVALID
        else d
        for d in _SURVEYS
    ],
    ids=[d.name for d in _SURVEYS],
)
def test_survey_fixture_is_valid_xlsform(survey_dir: Path, tmp_path: Path) -> None:
    """Every whole-survey fixture is valid XLSForm (the per-entity check above
    never sees them)."""
    # select_*_from_file CSVs sit beside the form for pyxform.
    for csv in (REPO_ROOT / "registry" / "vocab").glob("*.csv"):
        shutil.copy(csv, tmp_path / csv.name)
    xlsx = _survey_xlsx(survey_dir, tmp_path)
    if xlsx.parent != tmp_path:
        xlsx = Path(shutil.copy(xlsx, tmp_path / xlsx.name))
    result = convert(str(xlsx))
    assert result.xform and result.xform.strip()
