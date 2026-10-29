"""The question-type screenshots as a release asset (formtransform#171).

``screenshots/<slug>/{limesurvey,xlsform}.png`` are rendered by
``codegen --screenshots`` (Docker + a browser + network, see
``emit_screenshots.py``), which also records in ``screenshots/rendered.json``
which version rendered each one and from which source file.

This module needs none of that, only the files on disk:

* ``check`` — every registry entity has both PNGs and a ``rendered.json``
  entry, and no screenshot exists for a slug that isn't registered. Cheap, run
  by ``tests/codegen/test_screenshots.py`` in CI, so a type can't silently miss
  its screenshots again (``range`` did).
* ``pack <version> <out.tar.gz>`` — the release asset: the PNGs plus a
  ``manifest.json`` with each image's size and engine, unpacking to
  ``screenshots/``. Fails on what ``check`` finds.

    python -m codegen.screenshot_manifest check
    python -m codegen.screenshot_manifest pack 0.8.1 assets/formtransform-screenshots-0.8.1.tar.gz
"""

from __future__ import annotations

import hashlib
import io
import json
import struct
import sys
import tarfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Per engine: what the shot shows, and the entity file it is rendered from (its
# hash tells whether the shot still matches the entity).
ENGINES: dict[str, dict[str, str]] = {
    "limesurvey": {"engine": "LimeSurvey", "theme": "fruity_twentythree", "source": "tsv.tsv"},
    # Enketo is the web-form engine behind KoboToolbox, not the Kobo UI itself.
    "xlsform": {"engine": "Enketo", "source": "fixtures/xlsform.json"},
}

RENDERED = "rendered.json"


def entity_slugs(repo: Path = REPO_ROOT) -> list[str]:
    """Every registry entity (types, variants, composites), by slug."""
    entities = repo / "registry" / "entities"
    return sorted(d.name for d in entities.iterdir() if (d / "definition.jsonld").is_file())


def shot_dir(repo: Path = REPO_ROOT) -> Path:
    return repo / "screenshots"


def source_sha256(repo: Path, slug: str, engine: str) -> str:
    path = repo / "registry" / "entities" / slug / ENGINES[engine]["source"]
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_rendered(repo: Path = REPO_ROOT) -> dict[str, dict[str, dict[str, str]]]:
    path = shot_dir(repo) / RENDERED
    return json.loads(path.read_text()) if path.exists() else {}


def record_render(repo: Path, slug: str, engine: str, version: str) -> None:
    """Note that ``version`` just rendered ``<slug>/<engine>.png`` (called by emit_screenshots)."""
    rendered = read_rendered(repo)
    rendered.setdefault(slug, {})[engine] = {
        "renderedFrom": version,
        "sourceSha256": source_sha256(repo, slug, engine),
    }
    ordered = {s: dict(sorted(e.items())) for s, e in sorted(rendered.items())}
    (shot_dir(repo) / RENDERED).write_text(json.dumps(ordered, indent=2) + "\n")


def png_size(path: Path) -> tuple[int, int]:
    """Width and height from a PNG's IHDR chunk."""
    head = path.read_bytes()[:24]
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        raise ValueError(f"{path} is not a PNG")
    width, height = struct.unpack(">II", head[16:24])
    return width, height


def problems(repo: Path = REPO_ROOT) -> list[str]:
    """What keeps the screenshots from matching the registry one to one."""
    slugs = set(entity_slugs(repo))
    shots = shot_dir(repo)
    rendered = read_rendered(repo)
    found: list[str] = []
    for slug in sorted(slugs):
        for engine in ENGINES:
            png = shots / slug / f"{engine}.png"
            if not png.is_file():
                found.append(f"{slug}: no {engine}.png")
            elif engine not in rendered.get(slug, {}):
                found.append(f"{slug}: {engine}.png is not in {RENDERED}")
    on_disk = {d.name for d in shots.iterdir() if d.is_dir()} if shots.is_dir() else set()
    for slug in sorted((on_disk | set(rendered)) - slugs):
        found.append(f"{slug}: screenshots for a slug that is not a registry entity")
    return found


def build_manifest(repo: Path, version: str) -> dict:
    """``manifest.json``: per slug and engine, the file, its size and engine.

    ``renderedFrom`` is the formtransform version that rendered it; ``current``
    is false when the entity's source file changed since, i.e. the shot may
    show an older rendering of the type.
    """
    rendered = read_rendered(repo)
    types: dict[str, dict] = {}
    for slug in entity_slugs(repo):
        types[slug] = {}
        for engine, info in ENGINES.items():
            width, height = png_size(shot_dir(repo) / slug / f"{engine}.png")
            record = rendered[slug][engine]
            entry = {"file": f"{slug}/{engine}.png", "width": width, "height": height, "engine": info["engine"]}
            if "theme" in info:
                entry["theme"] = info["theme"]
            entry["renderedFrom"] = record["renderedFrom"]
            entry["current"] = record["sourceSha256"] == source_sha256(repo, slug, engine)
            types[slug][engine] = entry
    return {"version": version, "types": types}


def pack(repo: Path, version: str, out: Path) -> dict:
    """Write the release tarball (``screenshots/manifest.json`` + the PNGs)."""
    found = problems(repo)
    if found:
        raise ValueError("screenshots incomplete:\n  " + "\n  ".join(found))
    manifest = build_manifest(repo, version)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(out, "w:gz") as tar:
        data = (json.dumps(manifest, indent=2) + "\n").encode()
        info = tarfile.TarInfo("screenshots/manifest.json")
        info.size = len(data)
        info.mode = 0o644
        tar.addfile(info, io.BytesIO(data))
        for engines in manifest["types"].values():
            for entry in engines.values():
                tar.add(shot_dir(repo) / entry["file"], arcname=f"screenshots/{entry['file']}")
    return manifest


def main(argv: list[str]) -> int:
    if argv[:1] == ["check"]:
        found = problems()
        for p in found:
            print(f"::error::{p}" if "--github" in argv else p, file=sys.stderr)
        if not found:
            print(f"OK: {len(entity_slugs())} entities, each with {' + '.join(ENGINES)} screenshots.")
        return 1 if found else 0
    if argv[:1] == ["pack"] and len(argv) == 3:
        try:
            manifest = pack(REPO_ROOT, argv[1], Path(argv[2]))
        except ValueError as e:
            print(e, file=sys.stderr)
            return 1
        stale = [f"{s}/{e}" for s, es in manifest["types"].items() for e, v in es.items() if not v["current"]]
        if stale:
            print(f"warning: rendered from an older source: {', '.join(stale)}", file=sys.stderr)
        print(f"wrote {argv[2]}")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
