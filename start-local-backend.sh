#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

exec docker compose \
  -f "$PROJECT_DIR/deploy/docker-compose.local.yml" \
  --env-file "$PROJECT_DIR/local.env" \
  up -d backend
