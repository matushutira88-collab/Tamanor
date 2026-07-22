-- CS-C11 — Safe Recipient Assessment. Two MINIMAL, content-free additions to the existing CS-C2
-- `safe_recipient_assessments` table (no new table, no PII, no document/identity storage):
--
--  1. purpose — the AssessmentPurpose the guardian is assessed for as a safe recipient of Family safety
--     information (safety_information | safety_signal | incident_summary | emergency_contact). Bounded
--     CHECK; a NOT NULL column with a safe default ('safety_information') so pre-C11 rows + the CS-C2 create
--     path keep working. An assessment is scoped to (tenant, profile, relationship, purpose).
--  2. A bounded assessmentStatus CHECK that adds the SUSPENDED lifecycle state (not_started | pending |
--     approved | suspended | rejected | revoked | expired). Suspend/resume are reversible (approved ⇄
--     suspended); rejected/expired stay terminal. A suspended assessment is NOT approved/effective.
--
-- The assessment ONLY determines whether a guardian may be a SAFE RECIPIENT — it NEVER grants access to
-- data (that is CS-C12 RecipientAuthorization). Grants & RLS are UNCHANGED: the CS-C2 table already grants
-- SELECT/INSERT/UPDATE to tamanor_app, REVOKES DELETE/TRUNCATE (append-only), and has a FORCEd strict
-- tenant_isolation policy — all covering the new column. No new/relaxed policy. No existing migration is
-- modified.

ALTER TABLE "safe_recipient_assessments" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'safety_information';
ALTER TABLE "safe_recipient_assessments" ADD CONSTRAINT "sra_purpose_bounded"
  CHECK ("purpose" IN ('safety_information','safety_signal','incident_summary','emergency_contact'));

-- Additive bounded status set (now includes 'suspended'); existing values all remain valid.
ALTER TABLE "safe_recipient_assessments" ADD CONSTRAINT "sra_status_bounded"
  CHECK ("assessmentStatus" IN ('not_started','pending','approved','suspended','rejected','revoked','expired'));
