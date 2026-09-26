"""codegen's registry validators reject what they claim to (#93).

Each test copies the real registry to a temp dir, breaks exactly one thing,
and asserts that `load_registry` raises a ValueError naming it. The drift
check only proves the output is stable; these prove the validators have teeth.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from codegen.emit_ts import generate_typescript_ddi
from codegen.loader import load_registry
from codegen.schematron import generate_schematron

REGISTRY = Path(__file__).resolve().parents[2] / "registry"


@pytest.fixture
def registry_copy(tmp_path: Path) -> Path:
    dest = tmp_path / "registry"
    shutil.copytree(REGISTRY, dest)
    return dest


def edit_json(path: Path, change: Callable[[dict[str, Any]], None]) -> None:
    data = json.loads(path.read_text())
    change(data)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def node(doc: dict[str, Any], at_id: str) -> dict[str, Any]:
    return next(n for n in doc["@graph"] if n["@id"] == at_id)


def test_the_real_registry_loads(registry_copy: Path) -> None:
    assert "type:select_one" in load_registry(registry_copy / "root.jsonld")


def test_duplicate_id_is_a_hard_error(registry_copy: Path) -> None:
    src = registry_copy / "entities" / "text" / "definition.jsonld"
    dup = registry_copy / "entities" / "text_copy"
    dup.mkdir()
    shutil.copy(src, dup / "definition.jsonld")
    with pytest.raises(ValueError, match=r"Duplicate @id 'type:text'"):
        load_registry(registry_copy / "root.jsonld")


def _drop_consumed_by(doc: dict[str, Any]) -> None:
    fields = doc["@graph"][0]["classes"]["QuestionType"]["fields"]
    fields["useWhen"].pop("consumedBy")


def _bad_consumed_by_token(doc: dict[str, Any]) -> None:
    fields = doc["@graph"][0]["classes"]["QuestionType"]["fields"]
    fields["useWhen"]["consumedBy"] = ["nobody"]


def _convention_unknown_type(doc: dict[str, Any]) -> None:
    doc["@graph"][0]["rule"]["appliesTo"] = ["select_one", "nope_type"]


def _variant_bad_slug(doc: dict[str, Any]) -> None:
    doc["@graph"][0]["@id"] = "variant:select_one_sonstiges"


def _variant_dangling_broader(doc: dict[str, Any]) -> None:
    # Keep the slug consistent with the base, so only the dangling ref fails.
    doc["@graph"][0]["@id"] = "variant:nope_other"
    doc["@graph"][0]["skos:broader"] = {"@id": "type:nope"}


def _question_type_without_typestring(doc: dict[str, Any]) -> None:
    doc["@graph"][0]["xlsform"].pop("typeString")


@pytest.mark.parametrize(
    ("relpath", "change", "message"),
    [
        ("schema.jsonld", _drop_consumed_by, r"QuestionType > useWhen: missing consumedBy"),
        ("schema.jsonld", _bad_consumed_by_token, r"unknown consumedBy token\(s\) \['nobody'\]"),
        ("conventions/other.jsonld", _convention_unknown_type, r"appliesTo references unknown type 'nope_type'"),
        ("entities/select_one_other/definition.jsonld", _variant_bad_slug, r"slug does not match flags"),
        ("entities/select_one_other/definition.jsonld", _variant_dangling_broader, r"'type:nope' does not exist"),
        ("entities/text/definition.jsonld", _question_type_without_typestring, r"typeString"),
    ],
    ids=[
        "unclassified field",
        "unknown consumedBy token",
        "convention names an unknown type",
        "variant slug vs flags",
        "variant points nowhere",
        "question type without typeString",
    ],
)
def test_validator_rejects(registry_copy: Path, relpath: str, change: Callable, message: str) -> None:
    edit_json(registry_copy / relpath, change)
    with pytest.raises(ValueError, match=message):
        load_registry(registry_copy / "root.jsonld")


def test_appearance_for_an_unknown_type(registry_copy: Path) -> None:
    def change(doc: dict[str, Any]) -> None:
        appearance = next(n for n in doc["@graph"] if n.get("@type") == "Appearance")
        appearance["validForTypes"] = ["nope_type"]

    edit_json(registry_copy / "root.jsonld", change)
    with pytest.raises(ValueError, match=r"validForTypes references 'nope_type'"):
        load_registry(registry_copy / "root.jsonld")


def test_vocabulary_without_its_csv(registry_copy: Path) -> None:
    (registry_copy / "vocab" / "iso_3166_1.csv").unlink()
    with pytest.raises(ValueError, match=r"xlsformFilename 'iso_3166_1.csv' not found"):
        load_registry(registry_copy / "root.jsonld")


def test_vocabulary_missing_a_required_field(registry_copy: Path) -> None:
    def change(doc: dict[str, Any]) -> None:
        vocab = next(n for n in doc["@graph"] if n.get("@type") == "Vocabulary")
        vocab.pop("vocabURI")

    edit_json(registry_copy / "root.jsonld", change)
    with pytest.raises(ValueError, match=r"vocabURI"):
        load_registry(registry_copy / "root.jsonld")


# -- emitters: the output follows the registry, not hardcoded values ---------


def test_schematron_follows_the_registry(registry_copy: Path, tmp_path: Path) -> None:
    """Every varGrp type the registry mentions is allowed, and the `_other`
    companion's facts come from type:text's DDI block."""
    registry = load_registry(registry_copy / "root.jsonld")
    out = tmp_path / "rules.sch"
    generate_schematron(registry, out)
    sch = out.read_text()
    for vg in ("grid", "multipleResp", "other"):
        assert f"@type = '{vg}'" in sch

    edit_json(
        registry_copy / "entities" / "text" / "definition.jsonld",
        lambda d: d["@graph"][0]["ddi"].update(intrvl="contin"),
    )
    changed = load_registry(registry_copy / "root.jsonld")
    generate_schematron(changed, out)
    assert "@intrvl = 'contin'" in out.read_text()


def test_ddi_type_map_follows_the_registry(registry_copy: Path, tmp_path: Path) -> None:
    edit_json(
        registry_copy / "entities" / "date" / "definition.jsonld",
        lambda d: d["@graph"][0]["ddi"].update(intrvl="contin"),
    )
    out = tmp_path / "DdiMappings.ts"
    generate_typescript_ddi(load_registry(registry_copy / "root.jsonld"), out)
    assert 'date: ["contin", "character"]' in out.read_text()
