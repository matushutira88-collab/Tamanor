#!/usr/bin/env bash
# V1.60 — throwaway local Postgres, apply ALL migrations, then run the autonomous Facebook auto-hide
# suite (attemptFacebookHide execution primitive) with the REAL tamanor_app role. Never touches
# production. Live config is injected per-call by the test (opts.config); tokens use aes-gcm.
set -euo pipefail

CONTAINER="tamanor-auto-hide-pg"
PORT="55471"
PW="autohide_test_pw"
OWNER_URL="postgresql://postgres:${PW}@127.0.0.1:${PORT}/postgres?schema=public"
APP_URL="postgresql://tamanor_app:tamanor_app@127.0.0.1:${PORT}/postgres?schema=public"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "→ starting throwaway Postgres ($CONTAINER) on :$PORT"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PW" -p "${PORT}:5432" postgres:16 >/dev/null
echo "→ waiting for Postgres"
for i in $(seq 1 60); do docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; [ "$i" = "60" ] && { echo "✗ not ready"; exit 1; }; done

KEY="$(openssl rand -base64 32)"

cd "$(dirname "$0")/../../db"
echo "→ applying all migrations (prisma migrate deploy)"
DATABASE_URL="$OWNER_URL" pnpm exec prisma migrate deploy

cd ../..
echo "→ seeding (against the throwaway DB, NOT .env)"
DATABASE_URL="$OWNER_URL" TOKEN_ENCRYPTION_KEY="$KEY" TOKEN_STORAGE_MODE="aes-gcm" \
  pnpm --filter @guardora/worker exec tsx ../../packages/db/prisma/seed.ts

echo "→ running autonomous auto-hide suite (real tamanor_app role)"
DATABASE_URL="$OWNER_URL" APP_DATABASE_URL="$APP_URL" \
  TOKEN_ENCRYPTION_KEY="$KEY" TOKEN_STORAGE_MODE="aes-gcm" \
  pnpm --filter @guardora/worker exec tsx ../../packages/sync/scripts/auto-hide.test.ts
