-- V1.44B — per-item AI processing state + global paid-AI daily hard cap (ADDITIVE ONLY; no reset).

-- 1) Processing-status enum.
DO $$ BEGIN
  CREATE TYPE "InboxProcessingStatus" AS ENUM ('pending','processed_rules','processed_local','processed_paid','cached','basic_limit_reached','premium_limit_reached','paid_ai_disabled','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) reputation_items — additive processing columns (written ONLY by the metering service).
ALTER TABLE "reputation_items" ADD COLUMN IF NOT EXISTS "processingTier" "ProcessingTier";
ALTER TABLE "reputation_items" ADD COLUMN IF NOT EXISTS "processingStatus" "InboxProcessingStatus" NOT NULL DEFAULT 'pending';
ALTER TABLE "reputation_items" ADD COLUMN IF NOT EXISTS "processingReason" TEXT;
ALTER TABLE "reputation_items" ADD COLUMN IF NOT EXISTS "lastProcessedAt" TIMESTAMP(3);
ALTER TABLE "reputation_items" ADD COLUMN IF NOT EXISTS "classifierVersion" TEXT;
ALTER TABLE "reputation_items" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_processingStatus_idx" ON "reputation_items" ("tenantId", "processingStatus");

-- 3) global_ai_usage_periods — GLOBAL system table (no tenantId, NO RLS; systemDb-only). Makes the
--    paid-AI daily call/cost hard cap multi-instance safe via an atomic guarded UPDATE.
CREATE TABLE IF NOT EXISTS "global_ai_usage_periods" (
  "id"          TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "provider"    TEXT NOT NULL,
  "callsUsed"   INTEGER NOT NULL DEFAULT 0,
  "costMicros"  BIGINT NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "global_ai_usage_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "global_ai_usage_periods_periodStart_provider_key" ON "global_ai_usage_periods" ("periodStart", "provider");

-- global_ai_usage_periods is a system-scope aggregate table: NO RLS, NO tenantId. Enforce
-- least-privilege at the DB level — REVOKE any (default-privilege) grant from the tenant runtime
-- role so it is reachable ONLY via the owner/system connection (systemDb) through the narrow
-- global-usage repo, never from tenant request code (also boundary-tested).
DO $$ BEGIN
  REVOKE ALL ON "global_ai_usage_periods" FROM tamanor_app;
EXCEPTION WHEN undefined_object THEN null; END $$;
