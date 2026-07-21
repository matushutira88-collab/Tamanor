#!/usr/bin/env bash
# LOCAL-ONLY migration validation. Recreates a disposable localhost shadow DB (tamanor_shadow)
# and replays EVERY migration into it with `prisma migrate deploy`.
#
# Why this instead of `prisma migrate dev`: `migrate dev` builds a shadow database by REPLAYING
# migration history WITHOUT first creating Prisma's internal `_prisma_migrations` table. The
# accepted migration `20260720090000_v1_58_5_rls_security_hardening` runs
# `REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM tamanor_app`, which then fails in the
# shadow (P3006 / P1014). `migrate deploy` creates `_prisma_migrations` BEFORE applying migrations,
# so the REVOKE succeeds — making a fresh deploy the reliable local replay/validation path. We must
# not modify that (or any) accepted migration.
#
# Hard local-only guarantees: reads ONLY ../../.env.local (never ../../.env, which is remote/Supabase),
# refuses any non-localhost host, and only ever drops/creates `tamanor_shadow` — never `tamanor`.
set -euo pipefail
cd "$(dirname "$0")/.."   # packages/db

ENV_LOCAL="../../.env.local"
[ -f "$ENV_LOCAL" ] || { echo "✗ $ENV_LOCAL not found"; exit 1; }

# DATABASE_URL from .env.local ONLY (first match; strip surrounding quotes).
DBURL=$(grep -E '^DATABASE_URL=' "$ENV_LOCAL" | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
[ -n "$DBURL" ] || { echo "✗ DATABASE_URL missing in .env.local"; exit 1; }

# Shadow URL: prefer SHADOW_DATABASE_URL from .env.local, else derive by swapping the db name.
SHADOWURL=$(grep -E '^SHADOW_DATABASE_URL=' "$ENV_LOCAL" | head -1 | sed -E 's/^SHADOW_DATABASE_URL=//; s/^"//; s/"$//' || true)
if [ -z "${SHADOWURL:-}" ]; then
  SHADOWURL=$(DBURL="$DBURL" node -e 'const u=new URL(process.env.DBURL);u.pathname="/tamanor_shadow";console.log(u.toString())')
fi

# Guard: both must be localhost/127.0.0.1; shadow db must NOT be the main `tamanor` db.
DBURL="$DBURL" SHADOWURL="$SHADOWURL" node -e '
  const local = (h) => ["localhost","127.0.0.1"].includes(h);
  const d = new URL(process.env.DBURL), s = new URL(process.env.SHADOWURL);
  const dn = d.pathname.slice(1), sn = s.pathname.slice(1);
  if (!local(d.hostname)) { console.error("✗ DATABASE_URL is not localhost:", d.hostname); process.exit(1); }
  if (!local(s.hostname)) { console.error("✗ SHADOW_DATABASE_URL is not localhost:", s.hostname); process.exit(1); }
  if (sn === dn) { console.error("✗ shadow db must differ from the main db ("+dn+")"); process.exit(1); }
  console.log("DATABASE_URL        ->", d.hostname+":"+d.port+"/"+dn);
  console.log("SHADOW_DATABASE_URL ->", s.hostname+":"+s.port+"/"+sn);
'

# Admin URL (default `postgres` maintenance db, no query string for libpq).
ADMINURL=$(DBURL="$DBURL" node -e 'const u=new URL(process.env.DBURL);u.pathname="/postgres";u.search="";console.log(u.toString())')
SHADOW_DB=$(SHADOWURL="$SHADOWURL" node -e 'console.log(new URL(process.env.SHADOWURL).pathname.slice(1))')

echo "→ recreating disposable shadow DB: $SHADOW_DB"
psql "$ADMINURL" -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS \"$SHADOW_DB\";" \
  -c "CREATE DATABASE \"$SHADOW_DB\";"

echo "→ replaying ALL migrations into $SHADOW_DB (prisma migrate deploy)"
DATABASE_URL="$SHADOWURL" pnpm exec prisma migrate deploy

echo "✓ all migrations replay cleanly on a fresh local shadow ($SHADOW_DB). No remote DB contacted."
