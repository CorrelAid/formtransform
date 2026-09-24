"""Fixtures for comparing formtransform's DDI with qwacback's.

`QWACBACK_URL` reuses a running qwacback. Otherwise the fixture starts the
container from docker-compose.yml and removes it afterwards. The tests are
skipped when the qwacback image can't be pulled (offline, or a
`QWACBACK_IMAGE` that doesn't exist; see docker-compose.yml).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest
import requests

HERE = Path(__file__).parent
REPO_ROOT = HERE.parents[2]
COMPOSE_FILE = HERE / "docker-compose.yml"
BUILD_DDI = HERE / "build_ddi.mjs"
READY_TIMEOUT_S = 120.0


def _wait_for_api(base: str) -> None:
    deadline = time.monotonic() + READY_TIMEOUT_S
    while time.monotonic() < deadline:
        try:
            if requests.get(f"{base}/api", timeout=2).status_code == 200:
                return
        except requests.RequestException:
            pass
        time.sleep(1)
    pytest.fail(f"qwacback /api not ready within {READY_TIMEOUT_S:.0f}s at {base}")


@pytest.fixture(scope="session")
def qwacback_url():
    if url := os.environ.get("QWACBACK_URL"):
        base = url.rstrip("/")
        _wait_for_api(base)
        yield base
        return

    if not shutil.which("docker"):
        pytest.skip("docker not available (set QWACBACK_URL to use a running qwacback)")

    compose = ["docker", "compose", "-p", f"ft-qwacback-{os.getpid()}", "-f", str(COMPOSE_FILE)]
    pull = subprocess.run([*compose, "pull", "qwacback"], capture_output=True, text=True)
    image_present = (
        subprocess.run(
            ["docker", "image", "inspect", os.environ.get("QWACBACK_IMAGE", "ghcr.io/correlaid/qwacback:latest")],
            capture_output=True,
        ).returncode
        == 0
    )
    if pull.returncode != 0 and not image_present:
        pytest.skip(f"qwacback image unavailable, see {COMPOSE_FILE.relative_to(REPO_ROOT)}: {pull.stderr.strip()}")

    subprocess.run([*compose, "up", "-d", "--wait", "--wait-timeout", str(int(READY_TIMEOUT_S))], check=True)
    base = f"http://127.0.0.1:{os.environ.get('QWACBACK_PORT', '8090')}"
    try:
        _wait_for_api(base)
        yield base
    finally:
        subprocess.run([*compose, "down", "-v", "--remove-orphans"], check=False)


def _post_json(url: str, payload: dict, max_wait_s: float = 90.0) -> requests.Response:
    """POST, backing off on 429: qwacback allows guests 10 conversions a minute."""
    waited = 0.0
    while True:
        r = requests.post(url, json=payload, timeout=30)
        if r.status_code != 429:
            return r
        pause = min(float(r.headers.get("Retry-After") or 5.0), 10.0)
        if waited + pause > max_wait_s:
            return r
        time.sleep(pause)
        waited += pause


@pytest.fixture
def qwacback_ddi(qwacback_url):
    """DDI XML from qwacback's POST /api/convert/xlsform-to-ddi."""

    def _convert(survey: list[dict], choices: dict[str, list[dict]]) -> str:
        payload = {
            "survey": survey,
            "choices": [{"list_name": ln, **c} for ln, cs in choices.items() for c in cs],
            "settings": {},
        }
        r = _post_json(f"{qwacback_url}/api/convert/xlsform-to-ddi", payload)
        assert r.status_code == 200, f"qwacback -> HTTP {r.status_code}: {r.text[:500]}"
        return r.text

    return _convert


@pytest.fixture(scope="session")
def formtransform_ddi():
    """DDI XML from formtransform's buildDdiXml (the built dist/)."""
    if not (REPO_ROOT / "dist" / "index.js").exists():
        pytest.fail("dist/index.js missing: run `npm run build` first")

    def _convert(survey: list[dict], choices: dict[str, list[dict]]) -> str:
        out = subprocess.run(
            ["node", str(BUILD_DDI)],
            input=json.dumps({"survey": survey, "choices": choices}),
            capture_output=True,
            text=True,
            check=False,
        )
        assert out.returncode == 0, out.stderr
        return out.stdout

    return _convert
