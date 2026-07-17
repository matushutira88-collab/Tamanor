#!/usr/bin/env bash
# V1.58.9 — throwaway local Postgres, apply ALL migrations (incl. v1_58_9 + v1_58_9b), then run the
# active-sessions / revoke / password change+reset suite. Owner client only. Never touches production.
set -euo pipefail

CONTAINER="tamanor-auth-sessmgmt-pg"
PORT="55451"
PW="authmgmt_test_pw"
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
echo "→ running active-sessions + password change/reset suite"
DATABASE_URL="$OWNER_URL" pnpm exec tsx scripts/auth-session-mgmt.test.ts
