"""Small shared helpers used across the code generators."""

import json
import re

_IDENT_RE = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def _ts_key(name: str) -> str:
    """Quote TS object keys when they contain non-identifier chars."""
    return name if _IDENT_RE.match(name) else json.dumps(name)


def _slug(at_id: str) -> str:
    """Strip namespace prefix from @id: 'type:integer' -> 'integer'."""
    return at_id.split(":", 1)[1] if ":" in at_id else at_id
