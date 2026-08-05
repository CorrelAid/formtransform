"""Pytest fixtures for the LimeSurvey integration suite.

The fixture *implementations* live in test_helpers.py alongside the plain
helper functions. Re-exporting them here (in a conftest.py, which pytest
auto-discovers) is what actually registers them for every test module in this
directory. Without this file the fixtures are invisible and every test that
requests `limesurvey_client` / `generated_files_dir` errors at setup with
"fixture not found".
"""

from test_helpers import (  # noqa: F401  (re-exported so pytest registers them)
    generated_files_dir,
    limesurvey_client,
    limesurvey_url,
)
