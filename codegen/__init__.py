"""codegen — generate TS/Python/docs/schematron artifacts from the JSON-LD registry.

Entry points:
    python -m codegen [--bless-snapshots]
    uv run codegen [--bless-snapshots]
"""

from .cli import main
from .loader import load_registry

__all__ = ["load_registry", "main"]
