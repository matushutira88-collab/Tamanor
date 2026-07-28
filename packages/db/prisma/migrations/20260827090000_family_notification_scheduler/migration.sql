-- FAMILY NOTIFICATIONS PHASE 3C — deterministic expiry scheduler. Additive, forward-only, replay-safe
-- (IF NOT EXISTS everywhere; no resets, no destructive recreation, no DELETE grant). Adds:
--   1) a global owner-only scheduler lease table (overlap protection for the cron runner);
--   2) two composite indexes backing the OWNER cross-tenant expiry scans (invitation + consent), so the
--      status/expiry range + id tie-break scan is index-ordered rather than a full table sort.
-- Touches NO existing grant, RLS policy, CHECK constraint, or lifecycle semantics.

-- 1) Scheduler lease — global, named, owner-only. The scheduler runs as the owner (systemDb); the app role
--    (tamanor_app) gets NO privileges at all (REVOKE ALL). No RLS is required: the table is never reached by a
--    tenant/RLS transaction, and the owner (BYPASSRLS) is the only writer. Stores no tenant/user/source id.
CREATE TABLE IF NOT EXISTS "scheduler_leases" (
  "leaseKey"    TEXT NOT NULL,
  "holder"      TEXT NOT NULL,
  "acquiredAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "scheduler_leases_pkey" PRIMARY KEY ("leaseKey")
);
REVOKE ALL PRIVILEGES ON TABLE "scheduler_leases" FROM tamanor_app;

-- 2) Owner cross-tenant expiry-scan indexes (additive; the old indexes are preserved).
CREATE INDEX IF NOT EXISTS "family_guardian_invitations_status_expiresAt_id_idx"
  ON "family_guardian_invitations" ("status", "expiresAt", "id");
CREATE INDEX IF NOT EXISTS "consent_records_consentStatus_validUntil_id_idx"
  ON "consent_records" ("consentStatus", "validUntil", "id");
