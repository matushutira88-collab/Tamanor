-- CS-C7 — Protected Profile lifecycle & Guardian workflow. TWO minimal, content-free schema additions
-- on the existing FAMILY-only, tenant-scoped tables. NO new table, NO PII column, NO raw content.
--
--  1. protected_profiles."language"   — a bounded, OPTIONAL Family-UI language preference (en|sk|de).
--       A display preference only — NEVER the child's real name, DOB, exact age, avatar, note, contact,
--       identifier or any raw content. The content-free invariant is preserved.
--  2. guardian_relationships."guardianRole" — the guardian's ROLE within a profile's circle
--       (primary|secondary|emergency|view_only). A SEPARATE axis from relationshipType (legal nature) and
--       authorityLevel (permission depth): a role change never derives or alters either.
--
-- Backfill: existing guardian relationships have NO safely-derivable role, so they are set to the
-- least-authority-implying default 'secondary' (NEVER auto-'primary' — that would falsely assert a
-- primary-guardian claim). guardianRole is then made NOT NULL (no DB default): every NEW row must set it
-- explicitly at the application layer.
--
-- PRIMARY invariant: AT MOST ONE ACTIVE 'primary' guardian per (tenant, profile). "Active" mirrors the
-- repository's isActiveGuardianRelationship: not deactivated (status <> 'suspended'), not revoked
-- (revokedAt IS NULL), not archived (archivedAt IS NULL). Enforced by a partial UNIQUE index below AND
-- re-checked transactionally in the repository. Deactivating/revoking/archiving a primary frees the slot.
--
-- Grants & RLS: UNCHANGED. A table-level GRANT already covers new columns, so the CS-C1 grants
-- (SELECT/INSERT/UPDATE to tamanor_app; DELETE/TRUNCATE REVOKED) still apply — soft archive/deactivate,
-- never hard delete. The existing FORCEd `tenant_isolation` RLS policy likewise covers the new columns;
-- no new or relaxed policy is introduced. No existing migration is modified.

-- 1) ProtectedProfile.language — optional, bounded (content-free display preference).
ALTER TABLE "protected_profiles" ADD COLUMN "language" TEXT;
ALTER TABLE "protected_profiles" ADD CONSTRAINT "pp_language_bounded"
  CHECK ("language" IS NULL OR "language" IN ('en','sk','de'));

-- 2) GuardianRelationship.guardianRole — add nullable, backfill deterministically, then enforce NOT NULL.
ALTER TABLE "guardian_relationships" ADD COLUMN "guardianRole" TEXT;
-- Deterministic backfill: no existing row has a safely-derivable role → 'secondary' (never 'primary').
UPDATE "guardian_relationships" SET "guardianRole" = 'secondary' WHERE "guardianRole" IS NULL;
ALTER TABLE "guardian_relationships" ALTER COLUMN "guardianRole" SET NOT NULL;
-- Bounded enum at the DB level (matches @guardora/core GuardianRole).
ALTER TABLE "guardian_relationships" ADD CONSTRAINT "gr_guardian_role_bounded"
  CHECK ("guardianRole" IN ('primary','secondary','emergency','view_only'));

-- PRIMARY invariant — at most one ACTIVE primary guardian per (tenant, profile). Inactive
-- (deactivated/revoked/archived) primaries do NOT occupy the slot, so a new primary is allowed
-- once the previous one is deactivated.
CREATE UNIQUE INDEX "gr_one_active_primary_per_profile"
  ON "guardian_relationships"("tenantId", "protectedProfileId")
  WHERE "guardianRole" = 'primary' AND "status" <> 'suspended' AND "revokedAt" IS NULL AND "archivedAt" IS NULL;
