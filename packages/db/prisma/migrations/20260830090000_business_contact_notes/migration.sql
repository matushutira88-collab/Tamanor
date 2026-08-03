-- BUSINESS-CRM-V2 (Phase A) — internal, APPEND-ONLY contact notes.
-- Additive, forward-only, idempotent (IF NOT EXISTS). NO destructive statement, NO backfill, and NO change to
-- contact identity or deduplication (`dedupeKey` and the `(tenantId, dedupeKey)` unique are untouched).
-- Sorts strictly after 20260829090000_meta_credential_authorization_provenance.
--
-- The status/assignment timeline reuses the EXISTING audit ledger (`audit_logs`, already RLS-scoped and
-- indexed on (tenantId, targetType, targetId)), so no BusinessContactActivity model is introduced.
--
-- APPEND-ONLY IS ENFORCED BY THE DATABASE: the app role receives SELECT + INSERT only — no UPDATE, no DELETE —
-- exactly like business_contact_ingestion_events. Phase A has no edit and no delete path, and the grant makes
-- that structural rather than a convention a future change could quietly break.

CREATE TABLE IF NOT EXISTS "business_contact_notes" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "contactId"    TEXT NOT NULL,
  "authorUserId" TEXT,
  "body"         TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_contact_notes_pkey" PRIMARY KEY ("id")
);

-- The timeline read: one contact's notes in creation order, tenant-scoped.
CREATE INDEX IF NOT EXISTS "business_contact_notes_tenantId_contactId_createdAt_idx"
  ON "business_contact_notes" ("tenantId", "contactId", "createdAt");

-- Cascade is deliberate: a note has no meaning without its contact or tenant, so both cascade. The AUTHOR is
-- SetNull instead — deleting a user must not destroy the append-only record; the note survives with an unknown
-- author and the UI renders no actor rather than a raw id.
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_contact_notes_tenantId_fkey') THEN
    ALTER TABLE "business_contact_notes"
      ADD CONSTRAINT "business_contact_notes_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_contact_notes_contactId_fkey') THEN
    ALTER TABLE "business_contact_notes"
      ADD CONSTRAINT "business_contact_notes_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "business_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_contact_notes_authorUserId_fkey') THEN
    ALTER TABLE "business_contact_notes"
      ADD CONSTRAINT "business_contact_notes_authorUserId_fkey"
      FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;

-- Tenant isolation, same fail-closed policy as every other business table.
ALTER TABLE "business_contact_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_contact_notes" FORCE ROW LEVEL SECURITY;
DO $pol$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_contact_notes' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "business_contact_notes"
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id());
  END IF;
END $pol$;

-- APPEND-ONLY: SELECT + INSERT only. No UPDATE and no DELETE grant — Phase A cannot edit or delete a note.
GRANT SELECT, INSERT ON "business_contact_notes" TO tamanor_app;
