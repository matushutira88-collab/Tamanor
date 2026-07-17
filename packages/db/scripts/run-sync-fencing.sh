#!/usr/bin/env bash
# V1.58.7 — throwaway local Postgres, apply ALL migrations (incl. the v1_58_7 fencing generation), then
# run the sync lease heartbeat/fencing/interrupted integration suite with the REAL tamanor_app role.
# Proves the fencing invariants against real DB constraints + RLS. Never touches production.
set -euo pipefail

CONTAINER="tamanor-sync-fencing-pg"
PORT="55445"
PW="fencing_test_pw"
OWNER_URL="postgresql://postgres:${PW}@127.0.0.1:${PORT}/postgres?schema=public"
# tamanor_app is created by the v1_37_2 migration with password 'tamanor_app' (dev default).
APP_URL="postgresql://tamanor_app:tamanor_app@127.0.0.1:${PORT}/postgres?schema=public"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "→ starting throwaway Postgres ($CONTAINER) on :$PORT"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PW" -p "${PORT}:5432" postgres:16 >/dev/null
echo "→ waiting for Postgres"
for i in $(seq 1 60); do docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; [ "$i" = "60" ] && { echo "✗ not ready"; exit 1; }; done

cd "$(dirname "$0")/.."
echo "→ applying all migrations (prisma migrate deploy)"
DATABASE_URL="$OWNER_URL" pnpm exec prisma migrate deploy
echo "→ running sync fencing suite (real tamanor_app role)"
DATABASE_URL="$OWNER_URL" APP_DATABASE_URL="$APP_URL" pnpm exec tsx scripts/sync-fencing.test.ts
