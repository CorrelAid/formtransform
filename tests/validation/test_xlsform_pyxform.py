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

import pytest

from .fixtures import example_dir, examples

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
