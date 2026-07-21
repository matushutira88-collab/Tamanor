-- CS-C1 — Child Safety Family Domain Foundation. Two FAMILY-workspace-only, tenant-scoped
-- tables: `protected_profiles` and `guardian_relationships`. Both RLS ENABLE+FORCE with the
-- standard tenant_isolation policy. Access is additionally gated ABOVE RLS by workspace kind +
-- FamilyRole in the server repository (packages/db/src/child-safety-family.ts).
--
-- A ProtectedProfile is NOT a User: it stores only a guardian-chosen label, an age band and a
-- protection status — never login/email/phone/Meta id/external account id/username/message/media/
-- precise location. Domain values are stored as TEXT validated against the CS-C0 @guardora/core
-- enums (no duplicated DB enum types) so CS-C2 workflows are not over-constrained.
--
-- Cross-tenant linking is impossible at the DB level: guardian_relationships uses composite
-- (id, tenantId) FKs into memberships and protected_profiles, so a guardian membership and a
-- profile MUST share the relationship's tenant. Archiving is soft (archivedAt) and the app role is
-- granted SELECT/INSERT/UPDATE but NOT DELETE — archiving/revoking never deletes historical rows.
-- No changes to any existing migration; no `_prisma_migrations` assumptions.

-- CreateTable — ProtectedProfile (NOT a User; content-free).
CREATE TABLE "protected_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "guardianLabel" TEXT,
    "ageBand" TEXT NOT NULL,
    "protectionStatus" TEXT NOT NULL DEFAULT 'inactive',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "protected_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable — GuardianRelationship (guardian Membership ↔ ProtectedProfile).
CREATE TABLE "guardian_relationships" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "guardianMembershipId" TEXT NOT NULL,
    "protectedProfileId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "authorityLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "consentStatus" TEXT NOT NULL DEFAULT 'not_requested',
    "consentType" TEXT,
    "safeRecipientEligibility" TEXT NOT NULL DEFAULT 'not_verified',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "guardian_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — composite (id, tenantId) enabling same-tenant composite FKs.
CREATE UNIQUE INDEX "protected_profiles_id_tenantId_key" ON "protected_profiles"("id", "tenantId");
CREATE INDEX "protected_profiles_tenantId_archivedAt_idx" ON "protected_profiles"("tenantId", "archivedAt");
CREATE UNIQUE INDEX "guardian_relationships_id_tenantId_key" ON "guardian_relationships"("id", "tenantId");
CREATE INDEX "guardian_relationships_tenantId_protectedProfileId_idx" ON "guardian_relationships"("tenantId", "protectedProfileId");
CREATE INDEX "guardian_relationships_tenantId_guardianMembershipId_idx" ON "guardian_relationships"("tenantId", "guardianMembershipId");

-- CreateIndex — composite unique on memberships so GuardianRelationship can reference (id, tenantId).
CREATE UNIQUE INDEX "memberships_id_tenantId_key" ON "memberships"("id", "tenantId");

-- CreateIndex — at most ONE ACTIVE relationship per (tenant, guardian, profile, type). A revoked or
-- archived relationship no longer counts, so a fresh one may be created afterwards (no CS-C2 lock-in).
CREATE UNIQUE INDEX "gr_one_active_per_guardian_profile_type"
  ON "guardian_relationships"("tenantId", "guardianMembershipId", "protectedProfileId", "relationshipType")
  WHERE "revokedAt" IS NULL AND "archivedAt" IS NULL;

-- Timestamp/state consistency: revoked status IFF revokedAt is set (independent of archivedAt).
ALTER TABLE "guardian_relationships" ADD CONSTRAINT "gr_revoked_ts_consistent"
  CHECK ((("status" = 'revoked') AND ("revokedAt" IS NOT NULL)) OR (("status" <> 'revoked') AND ("revokedAt" IS NULL)));

-- AddForeignKey — tenant + same-tenant composite FKs (cross-tenant linking impossible).
ALTER TABLE "protected_profiles" ADD CONSTRAINT "protected_profiles_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guardian_relationships" ADD CONSTRAINT "guardian_relationships_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guardian_relationships" ADD CONSTRAINT "guardian_relationships_guardianMembershipId_tenantId_fkey"
  FOREIGN KEY ("guardianMembershipId", "tenantId") REFERENCES "memberships"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guardian_relationships" ADD CONSTRAINT "guardian_relationships_protectedProfileId_tenantId_fkey"
  FOREIGN KEY ("protectedProfileId", "tenantId") REFERENCES "protected_profiles"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- GRANTs — app role may read/append/soft-update (archive/revoke) but NEVER hard-delete, so archiving
-- and revoking preserve historical rows. The owner/system role keeps full rights (tenant cascade).
GRANT SELECT, INSERT, UPDATE ON "protected_profiles", "guardian_relationships" TO tamanor_app;
REVOKE DELETE, TRUNCATE ON "protected_profiles", "guardian_relationships" FROM tamanor_app;

-- Row-Level Security (strict tenant_isolation, ENABLE+FORCE) — the existing repository pattern.
DO $cs_c1$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['protected_profiles','guardian_relationships'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $cs_c1$;
