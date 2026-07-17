-- V1.59 — per-account monitoring + protection product model + tenant protection defaults.
-- ADDITIVE + BACKWARD COMPATIBLE — no forced disconnect, no rule reset, safe during rollout:
--   • Every new column has a DEFAULT, so existing rows are backfilled to today's behaviour:
--       monitoringEnabled = true  (existing accounts keep being watched)
--       autoHideEnabled   = false (no automatic Meta action is enabled by the migration)
--   • The old code never reads these columns, so it keeps working unchanged during the rollout window.
-- No DROP, no data reset. RLS/grants on connected_accounts + tenants are UNCHANGED (adding columns).

-- Tenant DEFAULT protection policy (inherited by non-overriding accounts).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "defaultAutoHideEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "defaultAutoHideMode" TEXT NOT NULL DEFAULT 'recommend';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "defaultAutoHideRiskThreshold" TEXT NOT NULL DEFAULT 'high';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "defaultAutoHideCategories" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "defaultRequireManualApproval" BOOLEAN NOT NULL DEFAULT false;

-- Per-account monitoring + protection override.
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "protectionOverridden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "autoHideEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "autoHideMode" TEXT NOT NULL DEFAULT 'recommend';
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "autoHideRiskThreshold" TEXT NOT NULL DEFAULT 'high';
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "autoHideCategories" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "requireManualApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "protectionConfiguredAt" TIMESTAMP(3);
