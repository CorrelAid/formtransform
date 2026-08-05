#!/usr/bin/env bash
# Run the live-engine test suite (tests/live/) against real survey engines.
#
# Brings the shared LimeSurvey stack up, regenerates the TSV fixtures the suite
# imports, runs every `docker`-marked test, then tears the stack down again.
#
# Args are forwarded to pytest, e.g.:
#   npm run test:live -- -k response_roundtrip
#   BLESS_RESPONSES=1 npm run test:live -- -k response_roundtrip
set -uo pipefail
cd "$(dirname "$0")/.."

COMPOSE_DIR=tests/live/limesurvey

docker compose -f "$COMPOSE_DIR/docker-compose.yml" up -d --wait
npm run fixtures:generate
uv run pytest tests/live -m docker "$@"
EXIT=$?
docker compose -f "$COMPOSE_DIR/docker-compose.yml" down -v
exit $EXIT
