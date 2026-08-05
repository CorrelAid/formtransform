#!/usr/bin/env bash
# Build the schematron-worker shadow jar (CLI mode invoked by test_ddi_schema.py
# and by qwacback's docker image). Requires JDK 21 + internet (for gradle deps on first run).
set -euo pipefail
cd "$(dirname "$0")/../workers/schematron-worker"

if [ -x ./gradlew ]; then
    ./gradlew --no-daemon shadowJar
else
    gradle --no-daemon shadowJar
fi

JAR=$(ls -t build/libs/*-all.jar 2>/dev/null | head -1)
if [ -z "$JAR" ]; then
    echo "ERROR: shadow jar not produced" >&2
    exit 1
fi
echo ""
echo "Built: workers/schematron-worker/${JAR}"
