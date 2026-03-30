#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(pwd)}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.prod.yml}"
DEFAULT_COMPOSE_ENV_FILE=".env"

cd "$ROOT_DIR"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

if [[ "$ENV_FILE" != "$DEFAULT_COMPOSE_ENV_FILE" ]]; then
  echo "Linking $DEFAULT_COMPOSE_ENV_FILE -> $ENV_FILE for direct docker compose commands"
  ln -sfn "$ENV_FILE" "$DEFAULT_COMPOSE_ENV_FILE"
fi

echo "Starting core infrastructure"
compose up -d postgres temporal

echo "Running database migrations"
compose run --rm api sh -lc 'export DATABASE_URL="$(cat /run/secrets/database_url)" && pnpm prisma:migrate'

if [[ "${RUN_SEED_ON_DEPLOY:-false}" == "true" ]]; then
  echo "Running seed data"
  compose run --rm api sh -lc 'export DATABASE_URL="$(cat /run/secrets/database_url)" && pnpm prisma:seed'
fi

echo "Starting application services"
compose up -d --build api worker backup temporal-ui caddy

echo "Deployment complete"
compose ps
