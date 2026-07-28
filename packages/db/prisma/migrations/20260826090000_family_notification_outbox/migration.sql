-- FAMILY NOTIFICATIONS PHASE 3A — durable delivery outbox. Additive, forward-only, replay-safe (IF NOT EXISTS
-- everywhere; no resets, no destructive recreation, no DELETE grant). A canonical domain transition enqueues one
-- bounded event in its OWN transaction; a trusted processor later writes the per-recipient notifications with
-- current-authorization re-evaluation. Tenant-scoped under RLS with the standard tamanor_app grant contract —
-- EXCEPT the app role gets NO DELETE/TRUNCATE (events are never physically deleted by normal processing).
--
-- This migration does NOT touch the child-safety owner-only tables (incidents / protection plans keep their
-- REVOKE-ALL boundary) and does NOT alter any existing grant, RLS policy, or CHECK constraint.

-- 1) Bounded status lifecycle enum.
DO $enum$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FamilyNotificationOutboxStatus') THEN
    CREATE TYPE "FamilyNotificationOutboxStatus" AS ENUM ('pending', 'processing', 'completed', 'dead_letter');
  END IF;
END $enum$;

-- 2) Outbox table — strict explicit columns only (NO json payload, NO recipient ids, NO child-safety content).
CREATE TABLE IF NOT EXISTS "family_notification_outbox_events" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "notificationType" "NotificationType" NOT NULL,
  "sourceType"       TEXT NOT NULL,
  "sourceId"         TEXT NOT NULL,
  "eventVersion"     TEXT NOT NULL,
  "dedupeKey"        TEXT NOT NULL,
  "occurredAt"       TIMESTAMP(3) NOT NULL,
  "status"           "FamilyNotificationOutboxStatus" NOT NULL DEFAULT 'pending',
  "attemptCount"     INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt"    TIMESTAMP(3) NOT NULL,
  "lockedAt"         TIMESTAMP(3),
  "lockExpiresAt"    TIMESTAMP(3),
  "completedAt"      TIMESTAMP(3),
  "lastErrorCode"    TEXT,
  "safeReasonCode"   TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "family_notification_outbox_events_pkey" PRIMARY KEY ("id")
);

-- 3) Deterministic dedupe authority + claim/lookup indexes.
CREATE UNIQUE INDEX IF NOT EXISTS "family_notification_outbox_events_tenantId_dedupeKey_key"
  ON "family_notification_outbox_events" ("tenantId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "family_notification_outbox_events_status_nextAttemptAt_createdAt_id_idx"
  ON "family_notification_outbox_events" ("status", "nextAttemptAt", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "family_notification_outbox_events_tenantId_notificationType_sourceId_idx"
  ON "family_notification_outbox_events" ("tenantId", "notificationType", "sourceId");

-- 4) Tenant cascade (defence-in-depth; explicit purge still runs before tenant deletion). No Prisma-level
--    relation is declared (matches sync_leases) so the Tenant model is untouched.
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_notification_outbox_events_tenantId_fkey') THEN
    ALTER TABLE "family_notification_outbox_events" ADD CONSTRAINT "family_notification_outbox_events_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- 5) Grants + RLS. The app role can INSERT (enqueue in the delivery transaction) and UPDATE, but NEVER DELETE or
--    TRUNCATE (an event is retained for audit even after completion / dead-letter). The trusted processor runs as
--    the owner (systemDb, BYPASSRLS) with explicit tenant constraints on every statement.
GRANT SELECT, INSERT, UPDATE ON "family_notification_outbox_events" TO tamanor_app;
REVOKE DELETE, TRUNCATE ON "family_notification_outbox_events" FROM tamanor_app;

ALTER TABLE "family_notification_outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "family_notification_outbox_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "family_notification_outbox_events";
CREATE POLICY tenant_isolation ON "family_notification_outbox_events"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());
