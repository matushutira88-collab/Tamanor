-- V1.64 — PER-BRAND per-platform uniqueness (pricing "protected brand" model). A brand may hold at
-- most ONE ACTIVE (non-disconnected) account of each platform type (1 Facebook Page + 1 Instagram +
-- 1 Google Business + 1 YouTube). This is a DB BACKSTOP for the server-side, advisory-locked check in
-- resource-limits.assertBrandPlatformCapacity — a direct DB write (bypassing the app) cannot create a
-- second active account of the same type in one brand either.
--
-- SCOPE / SAFETY:
--   • ADDITIVE only — no table/column/data change, no DROP. The existing
--     UNIQUE (brandId, platform, externalId) is unchanged (still prevents duplicate EXTERNAL assets).
--   • PARTIAL index: DISCONNECTED accounts are excluded, so disconnecting frees the slot and a later
--     reconnect (even with a new externalId) is allowed. A reconnect of the SAME external asset reuses
--     its row (upsert) and never trips this.
--   • Prisma cannot express a partial unique index in schema.prisma, so it lives as raw SQL here (same
--     pattern as the RLS migrations). schema.prisma is intentionally NOT changed for this index.
--
-- PRE-DEPLOY CHECK (operator, before applying to an environment WITH data): confirm no brand already
-- holds two active accounts of the same platform, or index creation will fail:
--   SELECT "brandId", "platform", count(*)
--     FROM "connected_accounts" WHERE "status" <> 'disconnected'
--    GROUP BY "brandId", "platform" HAVING count(*) > 1;
-- Expected: 0 rows. (New product model — no such rows are expected in current data.)
--
-- ROLLBACK: DROP INDEX IF EXISTS "connected_accounts_brand_platform_active_uq";

CREATE UNIQUE INDEX IF NOT EXISTS "connected_accounts_brand_platform_active_uq"
  ON "connected_accounts" ("brandId", "platform")
  WHERE "status" <> 'disconnected';
