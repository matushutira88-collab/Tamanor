#!/usr/bin/env bash
# V1.59 — throwaway local Postgres, apply ALL migrations (incl. v1_59 account protection), then run the
# dashboard-metrics + monitored-account-limit suite with the REAL tamanor_app role (so the cross-tenant
# RLS denial is genuinely exercised). Never touches production.
set -euo pipefail

CONTAINER="tamanor-dashboard-metrics-pg"
PORT="55455"
PW="acctprot_test_pw"
OWNER_URL="postgresql://postgres:${PW}@127.0.0.1:${PORT}/postgres?schema=public"
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
echo "→ running dashboard-metrics suite (real tamanor_app role)"
DATABASE_URL="$OWNER_URL" APP_DATABASE_URL="$APP_URL" pnpm exec tsx scripts/dashboard-metrics.test.ts
