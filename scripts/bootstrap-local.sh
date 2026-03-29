#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

echo "Bringing up Docker services..."
docker compose -f infra/docker/docker-compose.yml up -d --build

echo "Waiting for API health endpoint..."
for _ in {1..60}; do
  if curl -sf http://localhost:4000/health >/dev/null; then
    break
  fi
  sleep 2
done

curl -sf http://localhost:4000/health >/dev/null

echo "Generating Prisma client..."
pnpm prisma:generate

echo "Applying Prisma migrations..."
pnpm prisma:migrate

echo "Seeding demo data..."
pnpm prisma:seed

echo
echo "Bootstrap complete."
echo "API:         http://localhost:4000/health"
echo "Temporal UI: http://localhost:8080"
