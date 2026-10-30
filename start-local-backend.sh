#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

docker compose \
  -f "$PROJECT_DIR/deploy/docker-compose.local.yml" \
  --env-file "$PROJECT_DIR/local.env" \
  run --build --rm --no-deps backend python -m alembic upgrade head

exec docker compose \
  -f "$PROJECT_DIR/deploy/docker-compose.local.yml" \
  --env-file "$PROJECT_DIR/local.env" \
  up -d backend
