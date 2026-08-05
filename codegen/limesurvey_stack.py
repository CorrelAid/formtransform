"""The repo's single live-LimeSurvey stack.

One compose file (`tests/live/limesurvey/docker-compose.yml`) and one API client
serve every consumer that needs a real LimeSurvey:

* `tests/live/limesurvey/` — import, response round-trip (pytest)
* `codegen --screenshots`  — rendered question previews

They used to run *different* images on different ports with two hand-rolled
RemoteControl clients, so a rendering bug and a data bug could disagree about
which LimeSurvey they were looking at. Everything now points here.

The image enables JSON-RPC itself (`LIMESURVEY_API_MODE: json`), so no config
patching is needed. `citric` is a dev dependency, imported lazily so plain
`codegen` runs stay dependency-free.
"""

from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.error import URLError
from urllib.request import urlopen

if TYPE_CHECKING:
    from citric import Client

REPO_ROOT = Path(__file__).resolve().parent.parent
COMPOSE_DIR = REPO_ROOT / "tests" / "live" / "limesurvey"

BASE_URL = "http://localhost:8080"
RPC_URL = f"{BASE_URL}/index.php/admin/remotecontrol"
ADMIN_USER = "admin"
ADMIN_PASSWORD = "admin"


def is_ready(timeout: float = 5) -> bool:
    """True when the admin page answers — i.e. a stack is already up."""
    try:
        with urlopen(f"{BASE_URL}/index.php/admin", timeout=timeout) as r:
            return r.status in (200, 302)
    except (URLError, OSError):
        return False


def wait_until_ready(timeout: int = 300) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if is_ready():
            return
        time.sleep(3)
    raise RuntimeError(f"LimeSurvey at {BASE_URL} did not become ready within {timeout}s")


def compose_up() -> None:
    subprocess.run(
        ["docker", "compose", "up", "-d", "--wait"],
        cwd=COMPOSE_DIR,
        check=True,
        text=True,
    )


def compose_down(volumes: bool = True) -> None:
    cmd = ["docker", "compose", "down"]
    if volumes:
        cmd.append("-v")
    subprocess.run(cmd, cwd=COMPOSE_DIR, check=False, text=True)


def ensure_up() -> bool:
    """Reuse a running stack, else start one. Returns True if we started it.

    Callers that started the stack are responsible for `compose_down()`; a stack
    someone else brought up (`npm run test:integration`) is left alone.
    """
    if is_ready():
        return False
    compose_up()
    wait_until_ready()
    return True


def client() -> Client:
    from citric import Client

    return Client(RPC_URL, ADMIN_USER, ADMIN_PASSWORD)


def import_and_activate(ls: Client, tsv_path: Path, survey_name: str) -> int:
    """Import a LimeSurvey structure TSV and activate it for responses."""
    with open(tsv_path, "rb") as fh:
        survey_id = ls.import_survey(fh, file_type="txt", survey_name=survey_name)
    if survey_id <= 0:
        raise RuntimeError(f"import of {tsv_path} failed (survey id {survey_id})")
    ls.activate_survey(survey_id)
    return int(survey_id)


def public_url(survey_id: int) -> str:
    """Respondent-facing URL.

    No forced `?lang=` — several registry examples are German-based and a wrong
    `lang` yields an empty page rather than an error, so let LimeSurvey pick the
    survey's own base language.
    """
    return f"{BASE_URL}/index.php/{survey_id}?newtest=Y"
