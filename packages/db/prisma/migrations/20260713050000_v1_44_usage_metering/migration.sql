-- V1.44 — Usage metering & AI cost protection (ADDITIVE ONLY; no reset, no history edit).
-- Adds three tenant-scoped tables (usage_periods counters = source of truth; usage_events immutable
-- ledger; ai_result_cache) with RLS (ENABLE + FORCE + tenant_isolation USING + WITH CHECK) and a
-- composite (usagePeriodId, tenantId) → (id, tenantId) FK so a cross-tenant event is DB-impossible.
-- All money is BIGINT micros.

-- 1) Enums.
DO $$ BEGIN
  CREATE TYPE "ProcessingTier" AS ENUM ('rules', 'local', 'paid');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "UsageEventStatus" AS ENUM ('reserved', 'succeeded', 'failed', 'released', 'denied', 'cached');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) usage_periods — per-tenant per-UTC-month counters (authoritative quota state).
CREATE TABLE IF NOT EXISTS "usage_periods" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "periodStart"       TIMESTAMP(3) NOT NULL,
  "periodEnd"         TIMESTAMP(3) NOT NULL,
  "plan"              TEXT NOT NULL,
  "basicUnitsUsed"    INTEGER NOT NULL DEFAULT 0,
  "premiumCallsUsed"  INTEGER NOT NULL DEFAULT 0,
  "premiumCostMicros" BIGINT NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "usage_periods_tenantId_periodStart_key" ON "usage_periods" ("tenantId", "periodStart");
CREATE UNIQUE INDEX IF NOT EXISTS "usage_periods_id_tenantId_key" ON "usage_periods" ("id", "tenantId");
CREATE INDEX IF NOT EXISTS "usage_periods_tenantId_periodEnd_idx" ON "usage_periods" ("tenantId", "periodEnd");
DO $$ BEGIN
  ALTER TABLE "usage_periods" ADD CONSTRAINT "usage_periods_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3) usage_events — immutable append-only ledger. Composite tenant-safe FK to the period.
CREATE TABLE IF NOT EXISTS "usage_events" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "usagePeriodId"      TEXT NOT NULL,
  "reputationItemId"   TEXT,
  "contentItemId"      TEXT,
  "eventType"          TEXT NOT NULL,
  "processingTier"     "ProcessingTier" NOT NULL,
  "provider"           TEXT,
  "modelKey"           TEXT,
  "units"              INTEGER NOT NULL DEFAULT 0,
  "reservedCostMicros" BIGINT NOT NULL DEFAULT 0,
  "actualCostMicros"   BIGINT,
  "idempotencyKey"     TEXT NOT NULL,
  "status"             "UsageEventStatus" NOT NULL,
  "reason"             TEXT,
  "correlationId"      TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "usage_events_tenantId_idempotencyKey_key" ON "usage_events" ("tenantId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "usage_events_tenantId_usagePeriodId_idx" ON "usage_events" ("tenantId", "usagePeriodId");
CREATE INDEX IF NOT EXISTS "usage_events_tenantId_status_idx" ON "usage_events" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "usage_events_tenantId_createdAt_idx" ON "usage_events" ("tenantId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_usagePeriodId_tenantId_fkey"
    FOREIGN KEY ("usagePeriodId", "tenantId") REFERENCES "usage_periods"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4) ai_result_cache — cached normalized AI result keyed by content version.
CREATE TABLE IF NOT EXISTS "ai_result_cache" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "contentHash"      TEXT NOT NULL,
  "modelKey"         TEXT NOT NULL,
  "policyVersion"    TEXT NOT NULL,
  "normalizedResult" JSONB NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"        TIMESTAMP(3),
  CONSTRAINT "ai_result_cache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_result_cache_tenantId_contentHash_modelKey_policyVersion_key" ON "ai_result_cache" ("tenantId", "contentHash", "modelKey", "policyVersion");
CREATE INDEX IF NOT EXISTS "ai_result_cache_tenantId_contentHash_idx" ON "ai_result_cache" ("tenantId", "contentHash");
DO $$ BEGIN
  ALTER TABLE "ai_result_cache" ADD CONSTRAINT "ai_result_cache_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 5) RLS — ENABLE + FORCE + tenant_isolation (USING + WITH CHECK) on all three tables.
ALTER TABLE "usage_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_periods" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "usage_periods";
CREATE POLICY tenant_isolation ON "usage_periods"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());

ALTER TABLE "usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "usage_events";
CREATE POLICY tenant_isolation ON "usage_events"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());

ALTER TABLE "ai_result_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_result_cache" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ai_result_cache";
CREATE POLICY tenant_isolation ON "ai_result_cache"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());

-- 6) Grant the non-superuser runtime role the same contract as every other tenant table.
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "usage_periods" TO tamanor_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON "usage_events" TO tamanor_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_result_cache" TO tamanor_app;
EXCEPTION WHEN undefined_object THEN null; END $$;
