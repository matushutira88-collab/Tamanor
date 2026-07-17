#!/usr/bin/env bash
# V1.58.4 — provision a THROWAWAY local Postgres, apply all migrations, run the executable
# out-of-order webhook guard suite against it, then tear the container down. Never touches production.
set -euo pipefail

CONTAINER="tamanor-webhook-ordering-pg"
PORT="55441"
PW="ordering_test_pw"
LOCAL_URL="postgresql://postgres:${PW}@127.0.0.1:${PORT}/postgres?schema=public"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "→ starting throwaway Postgres ($CONTAINER) on :$PORT"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PW" -p "${PORT}:5432" postgres:16 >/dev/null

echo "→ waiting for Postgres to accept connections"
for i in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
  if [ "$i" = "60" ]; then echo "✗ Postgres did not become ready"; exit 1; fi
done

cd "$(dirname "$0")/.."

echo "→ applying all migrations (prisma migrate deploy)"
DATABASE_URL="$LOCAL_URL" pnpm exec prisma migrate deploy

echo "→ running executable webhook-ordering suite"
DATABASE_URL="$LOCAL_URL" pnpm exec tsx scripts/webhook-ordering.test.ts
