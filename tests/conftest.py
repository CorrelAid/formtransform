"""Suite-wide pytest hooks.

`FT_REQUIRE_ORACLES=1` (set in CI) turns a skip caused by a missing tool --
the schematron-worker jar, java, pyxform, the generated xlsx fixtures,
playwright -- into a failure. Locally those tests skip so the suite runs
without them; in CI a skip would hide that a check never ran (#90).
"""

from __future__ import annotations

import os

import pytest

# Substrings of the skip reasons that mean "a tool is missing".
_MISSING_TOOL = (
    "not installed",
    "not built",
    "java not found",
    "not available",
    "no generated/",
    "could not import",
)


def _require_oracles() -> bool:
    return os.environ.get("FT_REQUIRE_ORACLES", "") not in ("", "0")


def _missing_tool(report: pytest.CollectReport | pytest.TestReport) -> bool:
    if not report.skipped or hasattr(report, "wasxfail"):
        return False
    longrepr = report.longrepr
    reason = longrepr[-1] if isinstance(longrepr, tuple) else str(longrepr)
    return any(s in reason for s in _MISSING_TOOL)


def _fail(report: pytest.CollectReport | pytest.TestReport) -> None:
    report.outcome = "failed"
    report.longrepr = f"FT_REQUIRE_ORACLES is set, but this was skipped: {report.longrepr}"


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo[None]):
    outcome = yield
    report = outcome.get_result()
    if _require_oracles() and _missing_tool(report):
        _fail(report)


@pytest.hookimpl(hookwrapper=True)
def pytest_make_collect_report(collector: pytest.Collector):
    outcome = yield
    report = outcome.get_result()
    if _require_oracles() and _missing_tool(report):
        _fail(report)
