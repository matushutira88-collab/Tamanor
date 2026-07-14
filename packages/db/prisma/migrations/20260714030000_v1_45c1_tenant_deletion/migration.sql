-- V1.45C1 — Tenant Deletion Foundation (ADDITIVE ONLY; no reset, no data loss, no history edit).
--
-- Adds: (1) the tenant deletion lifecycle state, (2) a GLOBAL privacy-safe deletion receipt,
-- (3) the missing tenant→child cascade FKs so the DB cascade graph is COMPLETE (previously these
-- tables were tenantId-only + RLS-isolated but NOT FK-linked, so a tenant delete would orphan them),
-- and (4) a durable tenant/account link on raw webhook events for the explicit purge.
--
-- This migration marks NO tenant as `deleting` and deletes NO row. Every existing tenant defaults to
-- `active`. Safe to re-run in dev (all statements are guarded / IF NOT EXISTS).

-- 1) Lifecycle enums -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "TenantDeletionState" AS ENUM ('active', 'deleting');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TenantDeletionStatus" AS ENUM ('requested', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) Tenant lifecycle columns. NOT NULL DEFAULT 'active' backfills every existing tenant to active.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "deletionState" "TenantDeletionState" NOT NULL DEFAULT 'active';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "deletionOperationId" TEXT;
-- Unique so a server-generated operation id can never collide across tenants/lifecycles.
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_deletionOperationId_key" ON "tenants"("deletionOperationId");

-- 3) Raw webhook-event durable linkage (nullable; populated at PROCESSING time from the matched,
--    active connected account — never inferred from the untrusted payload at deletion time).
ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "connectedAccountId" TEXT;
CREATE INDEX IF NOT EXISTS "webhook_events_tenantId_idx" ON "webhook_events"("tenantId");
CREATE INDEX IF NOT EXISTS "webhook_events_connectedAccountId_idx" ON "webhook_events"("connectedAccountId");
DO $wh$ BEGIN
  -- ON DELETE Cascade: the tenant link is DELETED (never nulled) with the tenant, so the durable
  -- association is never lost before the explicit purge; also a defence-in-depth backstop.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_events_tenantId_fkey') THEN
    ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- ON DELETE SetNull: an account removal (e.g. during the tenant cascade) never blocks or fails;
  -- the informational account link is simply cleared. The tenant link (above) drives the purge.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_events_connectedAccountId_fkey') THEN
    ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_connectedAccountId_fkey"
      FOREIGN KEY ("connectedAccountId") REFERENCES "connected_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $wh$;

-- 4) COMPLETE the tenant cascade graph. These tables carried only a `tenantId` string (RLS-isolated
--    but no FK), so a `DELETE FROM tenants` would leave them ORPHANED. Add the real cascade FK.
--
--    Added NOT VALID then VALIDATE (best-effort): NOT VALID is additive-safe — it never scans/rejects
--    pre-existing rows and NEVER deletes data, yet the ON DELETE CASCADE action still fires for every
--    valid reference and all NEW writes are FK-checked. A table with pre-existing dev-data orphans
--    (a tenantId pointing at a since-absent tenant — unreachable garbage owned by NO live tenant)
--    keeps the constraint enforced-going-forward; a real tenant's rows still cascade correctly.
DO $fk$
DECLARE t text;
DECLARE cname text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brand_risk_feedback','brand_risk_memory_rules','control_policies','action_queue_items',
    'incidents','brand_auto_protect_policies','auto_protect_decisions',
    'platform_action_executions','provider_calls'
  ] LOOP
    cname := t || '_tenantId_fkey';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID',
        t, cname);
    END IF;
    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', t, cname);
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'V1.45C1: % left NOT VALID (pre-existing orphan tenantId rows); still enforced for new writes + cascade', cname;
    END;
  END LOOP;
END $fk$;

-- 5) GLOBAL privacy-safe deletion receipt. NO tenant FK (must SURVIVE the tenant cascade as durable
--    proof). System-scope only (like `leads` / `global_ai_usage_periods`): no RLS. Stores aggregate,
--    NON-PII facts only.
CREATE TABLE IF NOT EXISTS "tenant_deletion_receipts" (
  "id"                    TEXT NOT NULL,
  "operationId"           TEXT NOT NULL,
  "deletedTenantId"       TEXT NOT NULL,
  "requestedByUserId"     TEXT,
  "initiatedAuthority"    TEXT NOT NULL,
  "status"                "TenantDeletionStatus" NOT NULL DEFAULT 'requested',
  "requestedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"           TIMESTAMP(3),
  "providerAccountCount"  INTEGER NOT NULL DEFAULT 0,
  "providerResultSummary" JSONB,
  "webhookEventsPurged"   INTEGER NOT NULL DEFAULT 0,
  "tenantRowDeleted"      BOOLEAN NOT NULL DEFAULT false,
  "failureClass"          TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_deletion_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_deletion_receipts_operationId_key" ON "tenant_deletion_receipts"("operationId");
CREATE INDEX IF NOT EXISTS "tenant_deletion_receipts_deletedTenantId_idx" ON "tenant_deletion_receipts"("deletedTenantId");
CREATE INDEX IF NOT EXISTS "tenant_deletion_receipts_status_idx" ON "tenant_deletion_receipts"("status");
