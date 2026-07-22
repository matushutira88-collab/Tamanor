-- CS-C9 — Guardian Authority Activation & Revocation. Two MINIMAL, content-free additions to the existing
-- CS-C2 `guardian_authority_records` table (no new table, no PII, no document/identity storage):
--
--  1. authorityLevel — the granted SCOPE of guardian operations (GuardianAuthorityLevel: full|limited|
--     read_only). A SEPARATE axis from authorityType (legal nature), GuardianRole, relationshipType and
--     FamilyRole; it is NEVER auto-derived from any of them and only ever changed by an explicit, audited,
--     PrimaryGuardian-only action. Backfilled to the least-privilege 'read_only' for existing rows, then
--     NOT NULL (every grant sets it explicitly).
--  2. A bounded authorityStatus CHECK that adds the SUSPENDED lifecycle state (pending|verified|suspended|
--     revoked|expired|rejected). Suspend/resume are reversible (verified ⇄ suspended); revoked/expired stay
--     terminal. A suspended authority is NOT effective (isGuardianAuthorityActive requires 'verified').
--
-- Grants & RLS: UNCHANGED. The CS-C2 table already grants SELECT/INSERT/UPDATE to tamanor_app, REVOKES
-- DELETE/TRUNCATE (append-only lifecycle), and has a FORCEd strict tenant_isolation policy — all of which
-- cover the new column. No new/relaxed policy is introduced. No existing migration is modified.

ALTER TABLE "guardian_authority_records" ADD COLUMN "authorityLevel" TEXT;
UPDATE "guardian_authority_records" SET "authorityLevel" = 'read_only' WHERE "authorityLevel" IS NULL;
ALTER TABLE "guardian_authority_records" ALTER COLUMN "authorityLevel" SET NOT NULL;
ALTER TABLE "guardian_authority_records" ADD CONSTRAINT "gar_authority_level_bounded"
  CHECK ("authorityLevel" IN ('full','limited','read_only'));

-- Additive bounded status set (now includes 'suspended'); existing values all remain valid.
ALTER TABLE "guardian_authority_records" ADD CONSTRAINT "gar_authority_status_bounded"
  CHECK ("authorityStatus" IN ('pending','verified','suspended','revoked','expired','rejected'));
