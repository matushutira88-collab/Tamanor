-- CS-C2 — Consent, Guardian Authority & Safe Recipients. Three FAMILY-only, tenant-scoped tables
-- that keep the four axes (relationship / authority / consent / eligibility) strictly SEPARATE and
-- never auto-derived. All RLS ENABLE+FORCE with a STRICT tenant_isolation policy (no IS NULL
-- bootstrap branch). App role: SELECT/INSERT/UPDATE only — DELETE/TRUNCATE revoked so revoke/expire/
-- archive preserve history. Domain values are TEXT (validated in @guardora/core), not DB enum types.
--
-- Required composite (id, tenantId) FKs make cross-tenant linking impossible at the DB level:
--   guardian_authority_records.(guardianRelationshipId, tenantId) → guardian_relationships
--   consent_records.(protectedProfileId, tenantId)               → protected_profiles
--   safe_recipient_assessments.(guardianRelationshipId, tenantId)→ guardian_relationships
-- OPTIONAL links (consent.guardianRelationshipId, consent.grantedByMembershipId,
-- assessment.assessedByMembershipId) carry the shared tenantId and are enforced same-tenant in the
-- repository (RLS-scoped lookup, fail-closed); they intentionally have NO DB FK so that history
-- survives a membership removal and to avoid SET NULL on the NOT NULL shared tenantId column.
-- No document/evidence storage; verificationMethod/reasonCode are allow-listed process metadata.
-- No existing migration is modified; no `_prisma_migrations` assumption.

-- CreateTable — GuardianAuthorityRecord.
CREATE TABLE "guardian_authority_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "guardianRelationshipId" TEXT NOT NULL,
    "authorityType" TEXT NOT NULL,
    "authorityStatus" TEXT NOT NULL DEFAULT 'pending',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verificationMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "guardian_authority_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable — ConsentRecord.
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "protectedProfileId" TEXT NOT NULL,
    "guardianRelationshipId" TEXT,
    "consentType" TEXT NOT NULL,
    "consentStatus" TEXT NOT NULL DEFAULT 'not_requested',
    "grantedByMembershipId" TEXT,
    "grantedAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable — SafeRecipientAssessment.
CREATE TABLE "safe_recipient_assessments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "guardianRelationshipId" TEXT NOT NULL,
    "eligibilityStatus" TEXT NOT NULL DEFAULT 'not_verified',
    "assessmentStatus" TEXT NOT NULL DEFAULT 'not_started',
    "assessedByMembershipId" TEXT,
    "assessedAt" TIMESTAMP(3),
    "reasonCode" TEXT,
    "validUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "safe_recipient_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — composite (id, tenantId) uniques (enable same-tenant composite FKs) + effective-lookup indexes.
CREATE UNIQUE INDEX "guardian_authority_records_id_tenantId_key" ON "guardian_authority_records"("id", "tenantId");
CREATE INDEX "guardian_authority_records_tenantId_guardianRelationshipId__idx" ON "guardian_authority_records"("tenantId", "guardianRelationshipId", "authorityStatus");
CREATE UNIQUE INDEX "consent_records_id_tenantId_key" ON "consent_records"("id", "tenantId");
CREATE INDEX "consent_records_tenantId_protectedProfileId_consentStatus_idx" ON "consent_records"("tenantId", "protectedProfileId", "consentStatus");
CREATE INDEX "consent_records_tenantId_guardianRelationshipId_idx" ON "consent_records"("tenantId", "guardianRelationshipId");
CREATE UNIQUE INDEX "safe_recipient_assessments_id_tenantId_key" ON "safe_recipient_assessments"("id", "tenantId");
CREATE INDEX "safe_recipient_assessments_tenantId_guardianRelationshipId__idx" ON "safe_recipient_assessments"("tenantId", "guardianRelationshipId", "assessmentStatus");

-- NOTE on uniqueness: "at most ONE EFFECTIVE authority/consent/assessment" is enforced in the
-- APPLICATION (time-aware pure evaluators), NOT by a partial unique index. Effectiveness depends on
-- validUntil vs now(), which is not IMMUTABLE and therefore cannot appear in a partial-index predicate;
-- a status-only partial unique (status='verified'/'active'/'approved') would block legitimate HISTORY —
-- e.g. a new grant after an old one EXPIRED but is not yet revoked. Per the CS-C2 rule "partial unique
-- indexes only where they do not block history", such indexes are intentionally omitted.

-- CHECK constraints — status/timestamp consistency (fail-closed at the DB level).
ALTER TABLE "guardian_authority_records" ADD CONSTRAINT "gar_revoked_ts_consistent"
  CHECK (("authorityStatus" = 'revoked') = ("revokedAt" IS NOT NULL));
-- GRANTED consent must be provable (grantedAt + grantedBy); REVOKED (withdrawn) must have revokedAt.
ALTER TABLE "consent_records" ADD CONSTRAINT "cr_granted_requires_grantor"
  CHECK ("consentStatus" <> 'active' OR ("grantedAt" IS NOT NULL AND "grantedByMembershipId" IS NOT NULL));
ALTER TABLE "consent_records" ADD CONSTRAINT "cr_revoked_ts_consistent"
  CHECK (("consentStatus" = 'withdrawn') = ("revokedAt" IS NOT NULL));
-- APPROVED assessment must be provable (assessedBy + assessedAt); REVOKED must have revokedAt.
ALTER TABLE "safe_recipient_assessments" ADD CONSTRAINT "sra_approved_requires_assessor"
  CHECK ("assessmentStatus" <> 'approved' OR ("assessedByMembershipId" IS NOT NULL AND "assessedAt" IS NOT NULL));
ALTER TABLE "safe_recipient_assessments" ADD CONSTRAINT "sra_revoked_ts_consistent"
  CHECK (("assessmentStatus" = 'revoked') = ("revokedAt" IS NOT NULL));

-- AddForeignKey — tenant + REQUIRED same-tenant composite FKs.
ALTER TABLE "guardian_authority_records" ADD CONSTRAINT "guardian_authority_records_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guardian_authority_records" ADD CONSTRAINT "guardian_authority_records_guardianRelationshipId_tenantId_fkey"
  FOREIGN KEY ("guardianRelationshipId", "tenantId") REFERENCES "guardian_relationships"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_protectedProfileId_tenantId_fkey"
  FOREIGN KEY ("protectedProfileId", "tenantId") REFERENCES "protected_profiles"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "safe_recipient_assessments" ADD CONSTRAINT "safe_recipient_assessments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "safe_recipient_assessments" ADD CONSTRAINT "safe_recipient_assessments_guardianRelationshipId_tenantId_fkey"
  FOREIGN KEY ("guardianRelationshipId", "tenantId") REFERENCES "guardian_relationships"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- GRANTs — read/append/soft-update only; no hard delete (history preserved). Owner keeps full rights.
GRANT SELECT, INSERT, UPDATE ON "guardian_authority_records", "consent_records", "safe_recipient_assessments" TO tamanor_app;
REVOKE DELETE, TRUNCATE ON "guardian_authority_records", "consent_records", "safe_recipient_assessments" FROM tamanor_app;

-- Row-Level Security (strict tenant_isolation, ENABLE+FORCE, NO IS NULL branch).
DO $cs_c2$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['guardian_authority_records','consent_records','safe_recipient_assessments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $cs_c2$;
