#!/usr/bin/env bash
# V1.58.9 — throwaway local Postgres, apply ALL migrations (incl. v1_58_9 session lifetime), then run the
# server-enforced session lifetime suite. Session ops use the owner client, so only DATABASE_URL is
# needed. Never touches production.
set -euo pipefail

CONTAINER="tamanor-auth-session-pg"
PORT="55449"
PW="auth_test_pw"
OWNER_URL="postgresql://postgres:${PW}@127.0.0.1:${PORT}/postgres?schema=public"

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
echo "→ running session lifetime suite"
DATABASE_URL="$OWNER_URL" pnpm exec tsx scripts/auth-session-timeout.test.ts
