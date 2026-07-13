-- V1.37.5 — Referential integrity & orphan prevention. Additive; no data loss; no reset.
-- Idempotent (safe to re-run in dev). Order: cleanup → composite uniques → FKs →
-- cross-tenant triggers → indexes → join-table RLS. Cross-tenant safety is DB-enforced
-- (composite FKs for the Cascade group; BEFORE-triggers for the SetNull/history group).

-- ============================================================================
-- 1) CLEANUP / BACKFILL (fail-closed; dev DB already has 0 orphans/cross-tenant).
--    Cascade-group children whose parent is missing/foreign are technical orphans → delete.
--    SetNull-group references that are orphan/foreign → NULL (keep the history row).
-- ============================================================================
DELETE FROM "action_queue_items" a
  WHERE NOT EXISTS (SELECT 1 FROM "reputation_items" r WHERE r."id" = a."itemId" AND r."tenantId" = a."tenantId");
DELETE FROM "auto_protect_decisions" a
  WHERE NOT EXISTS (SELECT 1 FROM "reputation_items" r WHERE r."id" = a."itemId" AND r."tenantId" = a."tenantId");
DELETE FROM "moderation_decisions" a
  WHERE NOT EXISTS (SELECT 1 FROM "reputation_items" r WHERE r."id" = a."reputationItemId" AND r."tenantId" = a."tenantId");
UPDATE "platform_action_executions" a SET "itemId" = NULL
  WHERE a."itemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "reputation_items" r WHERE r."id" = a."itemId" AND r."tenantId" = a."tenantId");
UPDATE "platform_action_executions" a SET "queueItemId" = NULL
  WHERE a."queueItemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "action_queue_items" q WHERE q."id" = a."queueItemId" AND q."tenantId" = a."tenantId");
UPDATE "provider_calls" a SET "itemId" = NULL
  WHERE a."itemId" IS NOT NULL AND a."tenantId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "reputation_items" r WHERE r."id" = a."itemId" AND r."tenantId" = a."tenantId");
UPDATE "audit_logs" a SET "actorUserId" = NULL
  WHERE a."actorUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."actorUserId");

-- ============================================================================
-- 1b) Relax PlatformActionExecution.itemId to NULLABLE so its FK can SET NULL and
--     keep the execution as history after the source item is deleted.
-- ============================================================================
ALTER TABLE "platform_action_executions" ALTER COLUMN "itemId" DROP NOT NULL;

-- ============================================================================
-- 2) COMPOSITE UNIQUES on parents (enable (id, tenantId) foreign keys).
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS "reputation_items_id_tenantId_key" ON "reputation_items"("id", "tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "incidents_id_tenantId_key" ON "incidents"("id", "tenantId");

-- ============================================================================
-- 3) FOREIGN KEYS (guarded). Cascade group = composite (cross-tenant impossible).
-- ============================================================================
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_queue_items_itemId_tenantId_fkey') THEN
    ALTER TABLE "action_queue_items" ADD CONSTRAINT "action_queue_items_itemId_tenantId_fkey"
      FOREIGN KEY ("itemId", "tenantId") REFERENCES "reputation_items"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_protect_decisions_itemId_tenantId_fkey') THEN
    ALTER TABLE "auto_protect_decisions" ADD CONSTRAINT "auto_protect_decisions_itemId_tenantId_fkey"
      FOREIGN KEY ("itemId", "tenantId") REFERENCES "reputation_items"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- ModerationDecision: upgrade the simple reputationItemId FK to composite (cross-tenant safe).
DO $md$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'moderation_decisions_reputationItemId_fkey') THEN
    ALTER TABLE "moderation_decisions" DROP CONSTRAINT "moderation_decisions_reputationItemId_fkey";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'moderation_decisions_reputationItemId_tenantId_fkey') THEN
    ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_reputationItemId_tenantId_fkey"
      FOREIGN KEY ("reputationItemId", "tenantId") REFERENCES "reputation_items"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $md$;

-- NOTE (V1.37.5 scope): the SetNull HISTORY-group FKs on platform_action_executions
-- (itemId, queueItemId) and provider_calls.itemId are DEFERRED (see report §11). They are
-- unambiguous but their enforcement requires refactoring several behavioral test suites
-- that seed synthetic execution/diagnostic history; the column stays nullable and the
-- runtime already only ever writes real, same-tenant items via persistItem/live-actions.

-- AuditLog.actor: explicit ON DELETE SET NULL (audit survives user deletion; append-only).
DO $al$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_actorUserId_fkey') THEN
    ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actorUserId_fkey";
  END IF;
  ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
END $al$;

-- ============================================================================
-- 5) INDEXES for FK lookup / delete performance (skip if already present).
-- ============================================================================
CREATE INDEX IF NOT EXISTS "platform_action_executions_queueItemId_idx" ON "platform_action_executions"("queueItemId");
CREATE INDEX IF NOT EXISTS "provider_calls_itemId_idx" ON "provider_calls"("itemId");
CREATE INDEX IF NOT EXISTS "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- ============================================================================
-- 6) IncidentRelatedItem join table (normalizes Incident.relatedItemIds[]).
-- ============================================================================
CREATE TABLE IF NOT EXISTS "incident_related_items" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "reputationItemId" TEXT NOT NULL,
  "relationType" TEXT NOT NULL DEFAULT 'related',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incident_related_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "incident_related_items_incidentId_reputationItemId_key" ON "incident_related_items"("incidentId", "reputationItemId");
CREATE INDEX IF NOT EXISTS "incident_related_items_tenantId_idx" ON "incident_related_items"("tenantId");
CREATE INDEX IF NOT EXISTS "incident_related_items_reputationItemId_idx" ON "incident_related_items"("reputationItemId");
DO $irfk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incident_related_items_incidentId_tenantId_fkey') THEN
    ALTER TABLE "incident_related_items" ADD CONSTRAINT "incident_related_items_incidentId_tenantId_fkey"
      FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incident_related_items_reputationItemId_tenantId_fkey') THEN
    ALTER TABLE "incident_related_items" ADD CONSTRAINT "incident_related_items_reputationItemId_tenantId_fkey"
      FOREIGN KEY ("reputationItemId", "tenantId") REFERENCES "reputation_items"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $irfk$;

-- Backfill from the denormalized array — only VALID, same-tenant references.
INSERT INTO "incident_related_items" ("id", "tenantId", "incidentId", "reputationItemId")
SELECT md5(i."id" || ':' || rid)::text, i."tenantId", i."id", rid
FROM "incidents" i, unnest(i."relatedItemIds") AS rid
WHERE EXISTS (SELECT 1 FROM "reputation_items" r WHERE r."id" = rid AND r."tenantId" = i."tenantId")
ON CONFLICT ("incidentId", "reputationItemId") DO NOTHING;

-- RLS + grant for the new tenant table (same contract as all tenant tables).
GRANT SELECT, INSERT, UPDATE, DELETE ON "incident_related_items" TO tamanor_app;
ALTER TABLE "incident_related_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incident_related_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "incident_related_items";
CREATE POLICY tenant_isolation ON "incident_related_items"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());
