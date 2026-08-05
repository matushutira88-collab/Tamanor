-- SINGLE-ITEM RE-ANALYSIS FOUNDATION — priority provenance + the durable Preview→Confirm record.
--
-- Additive, forward-only, idempotent (IF NOT EXISTS / guarded DO blocks). NO destructive statement,
-- NO backfill, NO change to any existing column. Sorts strictly after
-- 20260901090000_customer_classification_projection.
--
-- DEPLOY ORDER. This migration ships ALONE, before any code that knows these fields. Production has
-- previously suffered P2022 from the reverse order, so this file contains no application coupling.
--
-- ===========================================================================================================
-- WHY PRIORITY PROVENANCE MUST FAIL CLOSED AS `unknown`
-- ===========================================================================================================
-- `reputation_items.priority` is written by BOTH the classifier (priorityFor(level) at ingest) and by
-- operators (setInboxPriority, and bulkInboxAction kind=set_priority). The audit trail cannot separate
-- them retroactively: the BULK path writes
--     audit(..., `inbox.bulk_set_priority`, null, null, { requested, affected })
-- with targetType AND targetId NULL, so it records counts only and never says WHICH items an operator
-- changed. A NULL actor therefore proves nothing — inferring "system-derived" from it would silently
-- overwrite every bulk-set human override.
--
-- Every existing row is consequently `unknown`, which is the honest answer: the origin of its priority
-- cannot be established from stored data. Automatic/background re-analysis must PRESERVE `unknown` (and
-- `human`); only an explicit, authorized single-item Confirm — where an operator is shown the exact
-- current-versus-proposed priority — may replace it, after which the row becomes `system`.

-- ===========================================================================================================
-- 1) PRIORITY PROVENANCE
-- ===========================================================================================================
DO $enum$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PriorityProvenance') THEN
    CREATE TYPE "PriorityProvenance" AS ENUM ('system', 'human', 'unknown');
  END IF;
END $enum$;

ALTER TABLE "reputation_items"
  -- NOT NULL DEFAULT 'unknown': a constant default is metadata-only in PostgreSQL 11+, so every existing
  -- row becomes `unknown` with no table rewrite and no backfill. NOT NULL is deliberate — a nullable
  -- column would reintroduce exactly the "NULL means system" inference this migration exists to forbid.
  ADD COLUMN IF NOT EXISTS "priorityProvenance" "PriorityProvenance" NOT NULL DEFAULT 'unknown',
  -- Bounded AUDIT REFERENCE to the operator who last set the priority. Deliberately NOT a foreign key:
  --   · ON DELETE SET NULL would erase the actor while the row still (correctly) claims `human`, and the
  --     product has a real user-deletion flow (UserDeletionReceipt) that must keep working;
  --   · ON DELETE RESTRICT would block that deletion flow outright.
  -- Provenance itself survives either way because it lives in the enum, not in this column.
  ADD COLUMN IF NOT EXISTS "prioritySetByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "prioritySetAt" TIMESTAMP(3);

-- The only new query path: a future bounded batch re-analysis selects rows eligible for automatic
-- priority recomputation, i.e. provenance = 'system', tenant-scoped, in id order.
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_priorityProvenance_id_idx"
  ON "reputation_items" ("tenantId", "priorityProvenance", "id");

-- ===========================================================================================================
-- 2) DURABLE SINGLE-ITEM RE-ANALYSIS PREVIEW
-- ===========================================================================================================
-- Preview→Confirm equivalence requires the proposal to be computed ONCE, server-side, and applied
-- verbatim: a design that re-runs the provider at Confirm could apply something the operator never saw.
-- No existing model can hold it — AiResultCache is content-keyed and deliberately re-readable (no
-- one-time use), ModerationDecision requires a ModerationAction, ActionQueueItem is itemId-unique and
-- models platform actions, and the compliance drafts are FK-bound to incidents. Hence this table.
--
-- `proposal` is BOUNDED JSON because the canonical write set spans classification, diagnostics,
-- language, translation, processing, intelligence, projection, Auto-Protect and priority — not a fixed
-- column set. `proposalDigest` makes tampering detectable; the application caps the byte size.
CREATE TABLE IF NOT EXISTS "reputation_reanalysis_previews" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "brandId"           TEXT NOT NULL,
  "reputationItemId"  TEXT NOT NULL,
  "createdByUserId"   TEXT NOT NULL,
  -- pending | consumed | expired | superseded. TEXT rather than an enum so a future state is an
  -- application change, not a type migration + lock.
  "status"            TEXT NOT NULL DEFAULT 'pending',
  -- Optimistic concurrency: the exact source state the proposal was computed against.
  "sourceContentHash" TEXT,
  "sourceUpdatedAt"   TIMESTAMP(3) NOT NULL,
  "sourceAssessedAt"  TIMESTAMP(3),
  -- sha256 over the full protected-field tuple (workflow, moderation, priority + provenance, queue).
  "sourceFingerprint" TEXT NOT NULL,
  "proposal"          JSONB NOT NULL,
  "proposalDigest"    TEXT NOT NULL,
  "idempotencyKey"    TEXT NOT NULL,
  "expiresAt"         TIMESTAMP(3) NOT NULL,
  "consumedAt"        TIMESTAMP(3),
  "consumedAuditId"   TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reputation_reanalysis_previews_pkey" PRIMARY KEY ("id")
);

-- Repository convention: composite (id, tenantId) so children/lookups can be tenant-pinned.
CREATE UNIQUE INDEX IF NOT EXISTS "reputation_reanalysis_previews_id_tenantId_key"
  ON "reputation_reanalysis_previews" ("id", "tenantId");

-- One preview per (tenant, actor, item, idempotency key) — the retry/duplicate-submit guard.
CREATE UNIQUE INDEX IF NOT EXISTS "rrp_tenant_user_item_idem_key"
  ON "reputation_reanalysis_previews" ("tenantId", "createdByUserId", "reputationItemId", "idempotencyKey");

-- "Does this item have a live preview?" and the per-item preview history.
CREATE INDEX IF NOT EXISTS "reputation_reanalysis_previews_tenantId_item_status_idx"
  ON "reputation_reanalysis_previews" ("tenantId", "reputationItemId", "status");

-- Bounded cleanup sweep: expired pending, and terminal rows past retention.
CREATE INDEX IF NOT EXISTS "reputation_reanalysis_previews_tenantId_status_expiresAt_idx"
  ON "reputation_reanalysis_previews" ("tenantId", "status", "expiresAt");

-- Composite tenant-safe FKs: a preview can NEVER reference an item or tenant from another tenant,
-- because the referenced key includes tenantId. Same pattern as business_contact_notes / inbox labels.
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reputation_reanalysis_previews_tenantId_fkey') THEN
    ALTER TABLE "reputation_reanalysis_previews"
      ADD CONSTRAINT "reputation_reanalysis_previews_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reputation_reanalysis_previews_item_tenant_fkey') THEN
    ALTER TABLE "reputation_reanalysis_previews"
      ADD CONSTRAINT "reputation_reanalysis_previews_item_tenant_fkey"
      FOREIGN KEY ("reputationItemId", "tenantId") REFERENCES "reputation_items"("id", "tenantId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- Tenant isolation, same fail-closed policy as every other tenant table.
ALTER TABLE "reputation_reanalysis_previews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reputation_reanalysis_previews" FORCE ROW LEVEL SECURITY;
DO $pol$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reputation_reanalysis_previews' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "reputation_reanalysis_previews"
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id());
  END IF;
END $pol$;

-- ===========================================================================================================
-- 3) PRIVILEGES
-- ===========================================================================================================
-- A preview is created, consumed (status/consumedAt) and swept, so the app role needs the full set on
-- the new table. 20260712010000_v1_37_2_rls granted these on ALL TABLES IN SCHEMA public at the time;
-- this table is new, so the grant is restated explicitly rather than assumed.
GRANT SELECT, INSERT, UPDATE, DELETE ON "reputation_reanalysis_previews" TO tamanor_app;
-- reputation_items already carries SELECT/INSERT/UPDATE for the app role, so the three new provenance
-- columns need no additional grant.
