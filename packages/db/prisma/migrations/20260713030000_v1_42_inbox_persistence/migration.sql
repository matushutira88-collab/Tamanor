-- V1.42 — Unified Inbox persistence foundation (ADDITIVE ONLY; no reset, no history edit).
-- Adds Tamanor-side workflow state to reputation_items + three new tenant-scoped tables for
-- labels / label joins / notes, all with RLS (ENABLE + FORCE + tenant_isolation) and composite
-- (childId, tenantId) → (parent id, tenantId) FKs so cross-tenant links are DB-impossible.

-- 1) Inbox workflow status enum.
DO $$ BEGIN
  CREATE TYPE "InboxWorkflowStatus" AS ENUM ('new', 'in_review', 'action_required', 'resolved');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) reputation_items — additive workflow columns (defaults backfill existing rows).
ALTER TABLE "reputation_items" ADD COLUMN IF NOT EXISTS "isRead" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reputation_items" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "reputation_items" ADD COLUMN IF NOT EXISTS "assignedToUserId" TEXT;
ALTER TABLE "reputation_items" ADD COLUMN IF NOT EXISTS "inboxWorkflowStatus" "InboxWorkflowStatus" NOT NULL DEFAULT 'new';

CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_isRead_idx" ON "reputation_items" ("tenantId", "isRead");
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_archivedAt_idx" ON "reputation_items" ("tenantId", "archivedAt");
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_assignedToUserId_idx" ON "reputation_items" ("tenantId", "assignedToUserId");
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_priority_idx" ON "reputation_items" ("tenantId", "priority");
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_inboxWorkflowStatus_idx" ON "reputation_items" ("tenantId", "inboxWorkflowStatus");

-- Assignment FK → users, SetNull on user delete (assignment cleared, item + history retained).
DO $$ BEGIN
  ALTER TABLE "reputation_items"
    ADD CONSTRAINT "reputation_items_assignedToUserId_fkey"
    FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3) inbox_labels — tenant-scoped; unique normalized name per tenant; composite unique for FK.
CREATE TABLE IF NOT EXISTS "inbox_labels" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "colorKey" TEXT NOT NULL DEFAULT 'neutral',
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inbox_labels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_labels_tenantId_normalizedName_key" ON "inbox_labels" ("tenantId", "normalizedName");
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_labels_id_tenantId_key" ON "inbox_labels" ("id", "tenantId");
CREATE INDEX IF NOT EXISTS "inbox_labels_tenantId_idx" ON "inbox_labels" ("tenantId");
DO $$ BEGIN
  ALTER TABLE "inbox_labels" ADD CONSTRAINT "inbox_labels_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4) inbox_item_labels — join with composite tenant-safe FKs (cross-tenant assignment impossible).
CREATE TABLE IF NOT EXISTS "inbox_item_labels" (
  "tenantId" TEXT NOT NULL,
  "reputationItemId" TEXT NOT NULL,
  "labelId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inbox_item_labels_pkey" PRIMARY KEY ("reputationItemId", "labelId")
);
CREATE INDEX IF NOT EXISTS "inbox_item_labels_tenantId_idx" ON "inbox_item_labels" ("tenantId");
CREATE INDEX IF NOT EXISTS "inbox_item_labels_labelId_tenantId_idx" ON "inbox_item_labels" ("labelId", "tenantId");
DO $$ BEGIN
  ALTER TABLE "inbox_item_labels" ADD CONSTRAINT "inbox_item_labels_reputationItemId_tenantId_fkey"
    FOREIGN KEY ("reputationItemId", "tenantId") REFERENCES "reputation_items"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "inbox_item_labels" ADD CONSTRAINT "inbox_item_labels_labelId_tenantId_fkey"
    FOREIGN KEY ("labelId", "tenantId") REFERENCES "inbox_labels"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 5) inbox_notes — composite tenant-safe FK to the item; author SetNull on user delete.
CREATE TABLE IF NOT EXISTS "inbox_notes" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "reputationItemId" TEXT NOT NULL,
  "authorUserId" TEXT,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "inbox_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "inbox_notes_tenantId_reputationItemId_idx" ON "inbox_notes" ("tenantId", "reputationItemId");
DO $$ BEGIN
  ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_reputationItemId_tenantId_fkey"
    FOREIGN KEY ("reputationItemId", "tenantId") REFERENCES "reputation_items"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_authorUserId_fkey"
    FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 6) RLS — ENABLE + FORCE + tenant_isolation (USING + WITH CHECK) on the three new tables.
ALTER TABLE "inbox_labels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbox_labels" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "inbox_labels";
CREATE POLICY tenant_isolation ON "inbox_labels"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());

ALTER TABLE "inbox_item_labels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbox_item_labels" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "inbox_item_labels";
CREATE POLICY tenant_isolation ON "inbox_item_labels"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());

ALTER TABLE "inbox_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbox_notes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "inbox_notes";
CREATE POLICY tenant_isolation ON "inbox_notes"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());

-- 7) Grant the non-superuser runtime role the same contract as every other tenant table.
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "inbox_labels" TO tamanor_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON "inbox_item_labels" TO tamanor_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON "inbox_notes" TO tamanor_app;
EXCEPTION WHEN undefined_object THEN null; END $$;
