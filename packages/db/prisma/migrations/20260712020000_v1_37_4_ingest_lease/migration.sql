-- V1.37.4 — Ingestion integrity, idempotency & token lifecycle. Additive; no data loss.
-- Idempotent (safe to re-run in dev). New table is tenant-scoped under RLS with the
-- same tamanor_app grant contract as every other tenant table.

-- 1) Truthful SyncRun outcomes (additive enum values; existing rows unaffected).
ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'partial_success';
ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'skipped_locked';
ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'disconnected';
ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'permission_missing';
ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'rate_limited';
ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'api_unavailable';

-- 2) SyncRun.updated — resynced-existing count.
ALTER TABLE "sync_runs" ADD COLUMN IF NOT EXISTS "updated" INTEGER NOT NULL DEFAULT 0;

-- 3) SyncLease — at most one active lease per connected account (TTL-based).
CREATE TABLE IF NOT EXISTS "sync_leases" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "connectedAccountId" TEXT NOT NULL,
  "holderId" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sync_leases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "sync_leases_connectedAccountId_key" ON "sync_leases"("connectedAccountId");
CREATE INDEX IF NOT EXISTS "sync_leases_tenantId_idx" ON "sync_leases"("tenantId");
CREATE INDEX IF NOT EXISTS "sync_leases_expiresAt_idx" ON "sync_leases"("expiresAt");

DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_leases_connectedAccountId_fkey') THEN
    ALTER TABLE "sync_leases" ADD CONSTRAINT "sync_leases_connectedAccountId_fkey"
      FOREIGN KEY ("connectedAccountId") REFERENCES "connected_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- 4) Grant + RLS for sync_leases (tenant isolation; tamanor_app is NON-bypassrls).
GRANT SELECT, INSERT, UPDATE, DELETE ON "sync_leases" TO tamanor_app;
ALTER TABLE "sync_leases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_leases" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "sync_leases";
CREATE POLICY tenant_isolation ON "sync_leases"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());
