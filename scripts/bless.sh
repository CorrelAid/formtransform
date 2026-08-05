#!/usr/bin/env bash
# Single entry point for regenerating blessed fixtures.
#
#   npm run bless             # everything reproducible without docker
#   npm run bless -- tsv      # registry/entities/<slug>/tsv.tsv
#   npm run bless -- ddi      # registry/entities/<slug>/ddi.xml
#   npm run bless -- examples # meta.json + xlsform.xlsx (codegen)
#   npm run bless -- surveys  # tests/fixtures/surveys/<name>/{tsv.tsv,ddi.xml}
#   npm run bless -- responses# tests/live/limesurvey/expected/ (needs docker)
#
# Snapshots are a manual gate: default codegen never touches ddi.xml/tsv.tsv, so
# the snapshot tests stay non-tautological. Always inspect the diff:
#   git diff registry/entities/ tests/fixtures/surveys/ tests/live/limesurvey/expected/
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-all}"

bless_examples() {
  echo "→ examples (meta.json + xlsform.xlsx)"
  uv run codegen --bless-snapshots
}

bless_tsv() {
  echo "→ tsv.tsv"
  npm run --silent build
  node scripts/bless-tsv-snapshots.mjs
}

bless_ddi() {
  echo "→ ddi.xml"
  npm run --silent build
  node scripts/bless-ddi-snapshots.mjs
}

bless_surveys() {
  echo "→ whole-survey snapshots (tests/fixtures/surveys/)"
  npm run --silent build
  node scripts/bless-survey-snapshots.mjs
}

bless_responses() {
  echo "→ live response snapshots (docker + playwright)"
  BLESS_RESPONSES=1 bash scripts/test-live.sh -k response_roundtrip
}

case "$TARGET" in
  all)       bless_examples; bless_tsv; bless_ddi; bless_surveys ;;
  examples)  bless_examples ;;
  tsv)       bless_tsv ;;
  ddi)       bless_ddi ;;
  surveys)   bless_surveys ;;
  responses) bless_responses ;;
  *) echo "unknown bless target: $TARGET (all|examples|tsv|ddi|surveys|responses)" >&2; exit 2 ;;
esac

echo ""
echo "Blessed. Review with:"
echo "  git diff registry/entities/ tests/fixtures/surveys/ tests/live/limesurvey/expected/"
