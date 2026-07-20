-- V1.66 — PER-USER ONBOARDING STATE ON `memberships`.
--
-- WHY membership and not users: a user may belong to several tenants, and every onboarding step
-- (connect an account, protect a brand, enable monitoring, first sync, first review) is tenant-scoped.
-- The `memberships` RLS policy is also a direct `tenantId = current_app_tenant_id()` match, while the
-- `users` policy is an EXISTS over memberships (a user row is writable from ANY tenant they belong to).
--
-- SAFETY: purely ADDITIVE. No DROP, no RENAME, no NOT NULL without a default, and deliberately NO new
-- UNIQUE or INDEX on existing data (v1_64 was deferred for exactly that reason). Safe to re-run.
--
-- EXISTING MEMBERS ARE NEVER BLOCKED. New rows default to `not_started`; rows that exist at migration
-- time are backfilled from the legacy tenant-level flag so today's behaviour is preserved exactly:
--   tenant.onboardingCompletedAt IS NOT NULL -> 'completed'  (that workspace did finish onboarding)
--   otherwise                                -> 'dismissed'  (never shown; resumable, not a lock)
--
-- The legacy `tenants.onboardingCompletedAt` column is intentionally LEFT IN PLACE and untouched — the
-- app stops reading it, but keeping it makes this migration reversible with zero data loss.
--
-- ROLLBACK:
--   ALTER TABLE "memberships"
--     DROP COLUMN IF EXISTS "onboardingStatus",      DROP COLUMN IF EXISTS "onboardingStartedAt",
--     DROP COLUMN IF EXISTS "onboardingCompletedAt", DROP COLUMN IF EXISTS "onboardingDismissedAt",
--     DROP COLUMN IF EXISTS "onboardingVersion",     DROP COLUMN IF EXISTS "onboardingStep",
--     DROP COLUMN IF EXISTS "onboardingChecklist";
--   DROP TYPE IF EXISTS "OnboardingStatus";
--   (Nothing outside these columns is affected; the legacy tenant flag still drives the old behaviour.)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnboardingStatus') THEN
    CREATE TYPE "OnboardingStatus" AS ENUM ('not_started', 'in_progress', 'completed', 'dismissed');
  END IF;
END $$;

ALTER TABLE "memberships"
  ADD COLUMN IF NOT EXISTS "onboardingStatus"      "OnboardingStatus" NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS "onboardingStartedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "onboardingDismissedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "onboardingVersion"     INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "onboardingStep"        TEXT,
  ADD COLUMN IF NOT EXISTS "onboardingChecklist"   JSONB;

-- Backfill ONLY rows that exist right now (still at the `not_started` default). Rows created after this
-- migration keep the default and enter the real onboarding flow.
UPDATE "memberships" m
SET
  "onboardingStatus"      = CASE WHEN t."onboardingCompletedAt" IS NOT NULL
                                 THEN 'completed'::"OnboardingStatus"
                                 ELSE 'dismissed'::"OnboardingStatus" END,
  "onboardingCompletedAt" = t."onboardingCompletedAt",
  "onboardingDismissedAt" = CASE WHEN t."onboardingCompletedAt" IS NULL THEN NOW() ELSE NULL END
FROM "tenants" t
WHERE m."tenantId" = t.id
  AND m."onboardingStatus" = 'not_started';
