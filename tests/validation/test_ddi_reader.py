"""The documented Python codebook reader (examples/python/ddi_reader.py) against
blessed DDI snapshots, so the snippet in RESPONSE_DATA.md cannot rot."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("ddi_reader", ROOT / "examples" / "python" / "ddi_reader.py")
ddi_reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ddi_reader)

CODEBOOK = ROOT / "tests" / "fixtures" / "surveys" / "complex_survey" / "ddi.xml"


def test_variable_labels_cover_every_var():
    labels = ddi_reader.variable_labels(CODEBOOK)
    assert labels["age"] == "Age"
    assert labels["favorite_colors_red"].endswith("Red")
    assert all(labels.values())


def test_value_labels_skip_unlabelled_binaries():
    maps = ddi_reader.value_labels(CODEBOOK)
    assert maps["gender"]["male"] == "Male"
    assert not any(name.startswith("favorite_colors_") for name in maps)


def test_apply_value_labels_keeps_codes_without_labels():
    pd = pytest.importorskip("pandas")
    df = pd.DataFrame({"gender": ["male", "feml", "zz"], "favorite_colors_red": ["1", "0", "1"]})
    out = ddi_reader.apply_value_labels(df, CODEBOOK)
    assert out["gender"].tolist() == ["Male", "Woman", "zz"]
    assert out["favorite_colors_red"].tolist() == ["1", "0", "1"]
