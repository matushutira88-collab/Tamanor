# Deferred migrations (NOT applied by `prisma migrate deploy`)

Prisma only reads `prisma/migrations/`, so anything here is intentionally held back.

## 20260725090000_v1_64_brand_platform_active_unique — DEFERRED (V1.61, 2026-07-18)
Creates a partial-unique index enforcing ≤1 active account per (brand, platform). It **cannot be
applied to current prod data**: one brand holds 11 active Facebook Pages + 5 active Instagram accounts
(smoke-test connections), which the index forbids — creation would error and block every later migration.

V1.64's *application-level* check (`resource-limits.assertBrandPlatformCapacity`) stays live; this is only
the DB backstop index, deferred until the data is reconciled.

### To restore (after resolving the data)
1. Ensure `SELECT "brandId","platform",count(*) FROM "connected_accounts" WHERE "status" <> 'disconnected'
   GROUP BY 1,2 HAVING count(*) > 1;` returns 0 rows.
2. `git mv` this folder back into `packages/db/prisma/migrations/`.
3. `pnpm --filter @guardora/db migrate:deploy`.
