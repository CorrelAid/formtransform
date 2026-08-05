"""Test inputs for the DDI validation + schematron conformance tests.

Loads the registry graph and the committed per-example `ddi.xml` snapshots.
(XLSForm → DDI generation is the in-repo TS emitter's job; its own tests live
in the vitest suite `src/test/ddi/`.)
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
REGISTRY_PATH = REPO_ROOT / "registry" / "root.jsonld"


def load_registry() -> list[dict]:
    """Full registry graph, aggregated from every split source (same walk as
    codegen.load_registry): root registry/root.jsonld + schema.jsonld +
    registry/conventions/*.jsonld + registry/entities/<slug>/definition.jsonld."""
    graph = list(json.loads(REGISTRY_PATH.read_text())["@graph"])
    sources = [
        *sorted((REPO_ROOT / "registry").glob("schema.jsonld")),
        *sorted((REPO_ROOT / "registry" / "conventions").glob("*.jsonld")),
        *sorted((REPO_ROOT / "registry" / "entities").glob("*/definition.jsonld")),
    ]
    for definition in sources:
        graph.extend(json.loads(definition.read_text())["@graph"])
    return graph


def examples() -> list[dict]:
    """Every entity carrying a worked example (type default, variant, composite)."""
    return [e for e in load_registry() if e.get("exampleDir")]


def example_dir(entity: dict) -> Path:
    """registry/<slug>/ folder holding the entity's fixtures."""
    return REPO_ROOT / entity["exampleDir"]


def load_example_ddi(entity: dict) -> str | None:
    """Return committed ddi.xml string or None if not present for this example."""
    p = example_dir(entity) / "ddi.xml"
    return p.read_text() if p.exists() else None
