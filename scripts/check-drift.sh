#!/usr/bin/env bash
# CI drift guard: re-runs codegen and fails if generated/ differs from committed.
set -euo pipefail
cd "$(dirname "$0")/.."

python -m codegen > /dev/null

# *.xlsx excluded — openpyxl writes timestamps into the zip container,
# making binary contents non-deterministic across runs. The .xlsform.json
# source IS drift-guarded; xlsx is just a rendering of it.
# registry/entities/<slug>/ holds each entity's definition + codegen-written
# docs.md + fixtures.
TARGETS=(src/generated registry)

if ! git diff --exit-code \
      ':(exclude)*.xlsx' \
      "${TARGETS[@]}" ; then
  echo ""
  echo "ERROR: registry artifacts out of sync with codegen / registry/root.jsonld"
  echo "Run: python -m codegen && git add ${TARGETS[*]}"
  exit 1
fi

echo "OK: generated artifacts in sync."
