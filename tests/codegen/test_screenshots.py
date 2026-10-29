"""The question-type screenshots match the registry one to one (#171).

Needs no Docker or browser: it only looks at the committed files, so a type
added without screenshots (as `range` once was) fails CI instead of going
unnoticed. Regenerate with `uv run codegen --screenshots`.
"""

from __future__ import annotations

import json
import shutil
import struct
import tarfile
import zlib
from pathlib import Path

import pytest

from codegen import screenshot_manifest as sm

REPO = Path(__file__).resolve().parents[2]


def test_every_registry_entity_has_both_screenshots() -> None:
    assert sm.problems(REPO) == []


def _png(path: Path, width: int, height: int) -> None:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IEND", b""))


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A repo with one entity, `a`, fully screenshotted."""
    entity = tmp_path / "registry" / "entities" / "a"
    (entity / "fixtures").mkdir(parents=True)
    (entity / "definition.jsonld").write_text("{}")
    (entity / "tsv.tsv").write_text("tsv")
    (entity / "fixtures" / "xlsform.json").write_text("{}")
    (tmp_path / "screenshots").mkdir()
    _png(tmp_path / "screenshots" / "a" / "limesurvey.png", 30, 20)
    _png(tmp_path / "screenshots" / "a" / "xlsform.png", 10, 5)
    for engine in sm.ENGINES:
        sm.record_render(tmp_path, "a", engine, "1.0.0")
    return tmp_path


def test_complete(repo: Path) -> None:
    assert sm.problems(repo) == []


def test_missing_png_and_unregistered_slug(repo: Path) -> None:
    (repo / "screenshots" / "a" / "xlsform.png").unlink()
    shutil.copytree(repo / "screenshots" / "a", repo / "screenshots" / "gone")
    assert sm.problems(repo) == [
        "a: no xlsform.png",
        "gone: screenshots for a slug that is not a registry entity",
    ]


def test_new_entity_without_screenshots(repo: Path) -> None:
    shutil.copytree(repo / "registry" / "entities" / "a", repo / "registry" / "entities" / "b")
    assert sm.problems(repo) == ["b: no limesurvey.png", "b: no xlsform.png"]


def test_png_without_render_record(repo: Path) -> None:
    (repo / "screenshots" / sm.RENDERED).unlink()
    assert sm.problems(repo) == [f"a: {e}.png is not in {sm.RENDERED}" for e in sm.ENGINES]


def test_manifest_sizes_engines_and_staleness(repo: Path) -> None:
    (repo / "registry" / "entities" / "a" / "tsv.tsv").write_text("changed")
    manifest = sm.build_manifest(repo, "1.1.0")
    assert manifest == {
        "version": "1.1.0",
        "types": {
            "a": {
                "limesurvey": {
                    "file": "a/limesurvey.png",
                    "width": 30,
                    "height": 20,
                    "engine": "LimeSurvey",
                    "theme": "fruity_twentythree",
                    "renderedFrom": "1.0.0",
                    "current": False,
                },
                "xlsform": {
                    "file": "a/xlsform.png",
                    "width": 10,
                    "height": 5,
                    "engine": "Enketo",
                    "renderedFrom": "1.0.0",
                    "current": True,
                },
            }
        },
    }


def test_pack_unpacks_to_screenshots(repo: Path, tmp_path: Path) -> None:
    out = tmp_path / "assets" / "shots.tar.gz"
    sm.pack(repo, "1.0.0", out)
    with tarfile.open(out) as tar:
        names = sorted(tar.getnames())
        manifest = json.load(tar.extractfile("screenshots/manifest.json"))
    assert names == ["screenshots/a/limesurvey.png", "screenshots/a/xlsform.png", "screenshots/manifest.json"]
    assert manifest["types"]["a"]["xlsform"]["file"] == "a/xlsform.png"


def test_pack_refuses_incomplete(repo: Path, tmp_path: Path) -> None:
    (repo / "screenshots" / "a" / "xlsform.png").unlink()
    with pytest.raises(ValueError, match=r"a: no xlsform\.png"):
        sm.pack(repo, "1.0.0", tmp_path / "x.tar.gz")
