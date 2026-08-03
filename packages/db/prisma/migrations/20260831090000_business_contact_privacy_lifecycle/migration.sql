-- BUSINESS-CRM-V2 (Phase C) — contact privacy lifecycle, anonymization tombstones and note redaction.
-- Additive, forward-only, idempotent (IF NOT EXISTS / guarded DO blocks). NO destructive statement, NO backfill
-- of personal data, and NO change to contact identity or deduplication: `dedupeKey`, `externalLeadId` and the
-- `(tenantId, dedupeKey)` unique are untouched, so webhook replay protection is exactly as before.
-- Sorts strictly after 20260830090000_business_contact_notes.
--
-- SAFE DEFAULTS: every existing contact becomes `active`; nothing is hidden, reclassified or anonymized by this
-- migration. `business_contact_notes.body` becomes NULLABLE — a widening, so no existing row changes.

-- ===========================================================================================================
-- 1) PRIVACY LIFECYCLE (orthogonal to the sales status enum, which is untouched)
-- ===========================================================================================================
DO $enum$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BusinessContactLifecycle') THEN
    CREATE TYPE "BusinessContactLifecycle" AS ENUM ('active', 'spam', 'archived', 'anonymized');
  END IF;
END $enum$;

ALTER TABLE "business_contacts"
  ADD COLUMN IF NOT EXISTS "lifecycleState" "BusinessContactLifecycle" NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "anonymizedAt" TIMESTAMP(3),
  -- One of the fixed ContactAnonymizationReason values. Never free text.
  ADD COLUMN IF NOT EXISTS "anonymizationReason" TEXT;

-- Default list (lifecycle-filtered, newest first) and the retention-review scan.
CREATE INDEX IF NOT EXISTS "business_contacts_tenantId_lifecycleState_receivedAt_idx"
  ON "business_contacts" ("tenantId", "lifecycleState", "receivedAt");

-- ===========================================================================================================
-- 2) NOTE REDACTION
-- ===========================================================================================================
-- Widening NOT NULL -> NULL. A null body means "content removed by anonymization"; the previous text is never
-- copied into another table, an audit row, an event or a backup column.
ALTER TABLE "business_contact_notes" ALTER COLUMN "body" DROP NOT NULL;
ALTER TABLE "business_contact_notes" ADD COLUMN IF NOT EXISTS "redactedAt" TIMESTAMP(3);

-- ===========================================================================================================
-- 3) THE SMALLEST PRIVILEGE CHANGE THAT PERMITS REDACTION
-- ===========================================================================================================
-- Phase A granted the app role SELECT + INSERT only, which makes notes append-only at the database level. That
-- is still the rule for every ordinary path: there is no note edit and no note delete.
--
-- Anonymization is the single exception, and it needs to clear a body. Rather than granting table-wide UPDATE,
-- the grant is scoped to EXACTLY the two columns redaction touches. The role therefore still cannot rewrite a
-- note's author, its timestamps, its tenant or its parent contact, and still cannot DELETE a note at all —
-- so the append-only guarantee for authorship and history survives intact.
GRANT UPDATE ("body", "redactedAt") ON "business_contact_notes" TO tamanor_app;

-- business_contacts already carries SELECT/INSERT/UPDATE for the app role (status + assignment changes), so the
-- lifecycle and anonymization columns need no additional grant. No DELETE is granted anywhere here: Phase C
-- deliberately has no hard-deletion path — anonymization keeps the row as a non-identifying tombstone so audit
-- references, operational counts and replay protection all stay valid.
