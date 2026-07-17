#!/usr/bin/env bash
# V1.57.3A — provision a THROWAWAY local Postgres, apply all migrations, run the executable
# checkout-concurrency suite against it, then tear the container down. Never touches production.
set -euo pipefail

CONTAINER="tamanor-checkout-concurrency-pg"
PORT="55439"
PW="concurrency_test_pw"
LOCAL_URL="postgresql://postgres:${PW}@127.0.0.1:${PORT}/postgres?schema=public"
# Restricted runtime role (created by the v1_37_2 migration: NOSUPERUSER NOBYPASSRLS) — RLS is only
# enforced through this role; the superuser bypasses it. Used by the cross-tenant isolation test.
APP_URL="postgresql://tamanor_app:tamanor_app@127.0.0.1:${PORT}/postgres?schema=public"

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

# Run everything from the db package so relative migration paths resolve.
cd "$(dirname "$0")/.."

echo "→ applying all migrations (prisma migrate deploy)"
DATABASE_URL="$LOCAL_URL" pnpm exec prisma migrate deploy

echo "→ running executable concurrency suite"
DATABASE_URL="$LOCAL_URL" APP_DATABASE_URL="$APP_URL" pnpm exec tsx scripts/checkout-concurrency.test.ts
