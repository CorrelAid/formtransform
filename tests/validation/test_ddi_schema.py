"""Validate blessed example DDI snapshots via the registry-owned schematron-worker
(Java CLI mode). Single tool covers both:

1. DDI 2.5 XSD validation (via javax.xml.validation)
2. CDL custom schematron rules (via Saxon-HE + schxslt2)

Build the jar with `bash scripts/build-worker.sh` (requires JDK 21).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from .fixtures import (
    REPO_ROOT,
    example_dir,
    examples,
    load_example_ddi,
)

XSD_PATH = REPO_ROOT / "ddi-validation" / "xsd" / "codebook.xsd"
SCH_PATH = REPO_ROOT / "ddi-validation" / "schematron" / "ddi_custom_rules.sch"


def _find_worker_jar() -> Path | None:
    libs = REPO_ROOT / "workers" / "schematron-worker" / "build" / "libs"
    if not libs.exists():
        return None
    for jar in libs.glob("*-all.jar"):
        return jar
    return None


def _resolve_java() -> str | None:
    """Prefer $JAVA_HOME/bin/java (lets caller pin to JDK 21). Fall back to PATH.

    JDK 26+ has stricter XSD parsing that rejects the DDI-XHTML model imports;
    JDK 21 works. CI's actions/setup-java@v4 with java-version: "21" exports
    JAVA_HOME accordingly.
    """
    import os

    home = os.environ.get("JAVA_HOME")
    if home:
        candidate = Path(home) / "bin" / "java"
        if candidate.exists():
            return str(candidate)
    return shutil.which("java")


@pytest.fixture(scope="module")
def java_bin() -> str:
    java = _resolve_java()
    if java is None:
        pytest.skip("java not found ($JAVA_HOME unset and not on PATH)")
    return java


@pytest.fixture(scope="module")
def worker_jar() -> Path:
    jar = _find_worker_jar()
    if jar is None:
        pytest.skip("schematron-worker jar not built. Run `bash scripts/build-worker.sh` (requires JDK 21).")
    return jar


@pytest.mark.parametrize("variant", examples(), ids=lambda v: v["@id"])
def test_ddi_snapshot_valid(variant, worker_jar, java_bin):
    """Blessed ddi.xml passes XSD + CDL schematron via schematron-worker CLI."""
    snapshot = load_example_ddi(variant)
    if snapshot is None:
        pytest.skip(f"{variant['@id']}: no committed ddi.xml")

    result = subprocess.run(
        [
            java_bin,
            "-cp",
            str(worker_jar),
            "dev.correlaid.schematron.CliMain",
            "--xsd",
            str(XSD_PATH),
            "--sch",
            str(SCH_PATH),
            "--xml",
            str(example_dir(variant) / "ddi.xml"),
        ],
        capture_output=True,
        timeout=30,
    )
    if result.returncode == 0:
        return
    if result.returncode == 2:
        pytest.fail(f"worker CLI argument/IO error: {result.stderr.decode()[:500]}")

    # returncode == 1 → validation failures. Worker output is JSON.
    try:
        report = json.loads(result.stdout.decode())
        msgs = "\n  ".join(f"{e.get('rule', '?')}: {e.get('message', '?')}" for e in report.get("errors", []))
    except Exception:
        msgs = result.stdout.decode()[:500]
    pytest.fail(f"{variant['@id']}: validation failed.\n  {msgs}\nSnapshot: {example_dir(variant) / 'ddi.xml'}")
