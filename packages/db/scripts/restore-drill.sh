#!/usr/bin/env bash
# V1.51 — logical backup/restore DRILL against a DISPOSABLE database.
#
# Proves the migrate → seed → dump → simulate-loss → restore → verify → destroy loop end to end,
# WITHOUT touching the real database. Uses the local Docker Postgres for the pg client tools and the
# host `prisma migrate deploy` to build the schema. This is the strongest drill runnable locally; the
# provider-level PITR drill (managed snapshot restore) is documented in docs/DISASTER_RECOVERY.md and
# must be run once against the managed instance before onboarding real tenant data.
#
# Usage:  bash packages/db/scripts/restore-drill.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
CONTAINER="${DRILL_PG_CONTAINER:-guardora_postgres}"
DRILL_DB="tamanor_restore_drill"
DUMP="/tmp/${DRILL_DB}.dump"

# Parse the owner DATABASE_URL (user/password/host/port) from .env; swap in the disposable DB name.
URL="$(grep -E '^DATABASE_URL=' "$REPO/.env" | head -1 | cut -d= -f2- | tr -d '"')"
proto_removed="${URL#*://}"
creds="${proto_removed%%@*}"
PGUSER="${creds%%:*}"
PGPASSWORD="${creds#*:}"
hostportdb="${proto_removed#*@}"
HOSTPORT="${hostportdb%%/*}"
PGPORT="${HOSTPORT##*:}"
export PGPASSWORD
DRILL_URL="postgresql://${PGUSER}:${PGPASSWORD}@localhost:${PGPORT}/${DRILL_DB}?schema=public"

dex() { docker exec -e PGPASSWORD="$PGPASSWORD" -i "$CONTAINER" "$@"; }
psql_db() { dex psql -U "$PGUSER" -d "$1" -v ON_ERROR_STOP=1 -qtA; }

echo "==> [1/8] create disposable database ${DRILL_DB}"
dex dropdb -U "$PGUSER" --if-exists "$DRILL_DB" >/dev/null 2>&1 || true
dex createdb -U "$PGUSER" "$DRILL_DB"

echo "==> [2/8] apply ALL migrations (prisma migrate deploy)"
( cd "$REPO/packages/db" && DATABASE_URL="$DRILL_URL" pnpm exec prisma migrate deploy >/dev/null )
MIG_BEFORE="$(psql_db "$DRILL_DB" <<<'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;')"
echo "    migrations applied: ${MIG_BEFORE}"

echo "==> [3/8] seed representative tenant / user / membership / subscription / provider"
psql_db "$DRILL_DB" <<SQL
INSERT INTO "tenants"(id,name,slug,plan,"createdAt","updatedAt","accessState","billingStatus")
  VALUES ('t_drill','Drill Workspace','drill-workspace','growth',now(),now(),'full_access','active');
INSERT INTO "users"(id,email,"createdAt","updatedAt")
  VALUES ('u_drill','drill@example.com',now(),now());
INSERT INTO "memberships"(id,"userId","tenantId",role)
  VALUES ('m_drill','u_drill','t_drill','owner');
INSERT INTO "subscriptions"(id,"tenantId","stripeCustomerId","stripeSubscriptionId","stripePriceId",plan,"billingInterval",status,"createdAt","updatedAt")
  VALUES ('s_drill','t_drill','cus_drill','sub_drill','price_drill','growth','monthly','active',now(),now());
INSERT INTO "brands"(id,"tenantId",name,"createdAt","updatedAt")
  VALUES ('b_drill','t_drill','Drill Brand',now(),now());
INSERT INTO "connected_accounts"(id,"tenantId","brandId",platform,status,mode,"externalId","createdAt","updatedAt")
  VALUES ('c_drill','t_drill','b_drill','facebook_page','active','read_only','pg_drill',now(),now());
SQL
echo "    seeded 1 tenant / 1 user / 1 membership / 1 subscription / 1 brand / 1 connected account"

echo "==> [4/8] backup (pg_dump, custom format)"
dex pg_dump -U "$PGUSER" -Fc -d "$DRILL_DB" -f "$DUMP"
echo "    dump written: ${DUMP} ($(dex du -h "$DUMP" | cut -f1))"

echo "==> [5/8] simulate catastrophic loss (drop + recreate empty)"
dex dropdb -U "$PGUSER" "$DRILL_DB"
dex createdb -U "$PGUSER" "$DRILL_DB"
EMPTY="$(psql_db "$DRILL_DB" <<<"SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
echo "    post-loss public tables: ${EMPTY}"

echo "==> [6/8] restore from backup (pg_restore)"
dex pg_restore -U "$PGUSER" -d "$DRILL_DB" --no-owner "$DUMP" >/dev/null 2>&1 || dex pg_restore -U "$PGUSER" -d "$DRILL_DB" --no-owner "$DUMP" || true

echo "==> [7/8] verify restored data + schema + RLS"
FAIL=0
verify() { local label="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then echo "    ✓ ${label}: ${got}"; else echo "    ✗ ${label}: got ${got} want ${want}"; FAIL=1; fi; }
verify "tenants"        "$(psql_db "$DRILL_DB" <<<'SELECT count(*) FROM "tenants";')" "1"
verify "users"         "$(psql_db "$DRILL_DB" <<<'SELECT count(*) FROM "users";')" "1"
verify "memberships"   "$(psql_db "$DRILL_DB" <<<'SELECT count(*) FROM "memberships";')" "1"
verify "subscriptions" "$(psql_db "$DRILL_DB" <<<'SELECT count(*) FROM "subscriptions";')" "1"
verify "brands"        "$(psql_db "$DRILL_DB" <<<'SELECT count(*) FROM "brands";')" "1"
verify "connected_accounts" "$(psql_db "$DRILL_DB" <<<'SELECT count(*) FROM "connected_accounts";')" "1"
verify "migrations"    "$(psql_db "$DRILL_DB" <<<'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;')" "$MIG_BEFORE"
verify "RLS on content_items"  "$(psql_db "$DRILL_DB" <<<"SELECT relrowsecurity::text FROM pg_class WHERE relname='content_items';")" "true"
verify "RLS on subscriptions"  "$(psql_db "$DRILL_DB" <<<"SELECT relrowsecurity::text FROM pg_class WHERE relname='subscriptions';")" "true"
verify "membership→tenant FK intact" "$(psql_db "$DRILL_DB" <<<"SELECT count(*) FROM memberships m JOIN tenants t ON t.id=m.\"tenantId\";")" "1"

echo "==> [8/8] destroy disposable environment"
dex dropdb -U "$PGUSER" "$DRILL_DB"
dex rm -f "$DUMP" >/dev/null 2>&1 || true

if [ "$FAIL" = "0" ]; then echo "PASS — backup/restore drill (V1.51)"; else echo "FAIL — backup/restore drill (V1.51)"; exit 1; fi
