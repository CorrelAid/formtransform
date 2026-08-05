"""Everything under `tests/live/` talks to a *running* survey engine.

Marking each test by hand would rot, so the marker is applied here at
collection time: `uv run pytest` skips this whole tree via the default
`-m "not docker"`, and `npm run test:integration` (which brings the stack up)
runs it with `-m docker`.
"""

from __future__ import annotations

from pathlib import Path

import pytest

LIVE_DIR = Path(__file__).parent


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    # The hook is session-wide, not directory-scoped: filter, or the whole
    # test suite ends up marked `docker`.
    for item in items:
        if LIVE_DIR in Path(str(item.fspath)).parents:
            item.add_marker(pytest.mark.docker)
