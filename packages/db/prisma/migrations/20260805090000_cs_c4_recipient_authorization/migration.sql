-- CS-C4 — Authorized Recipient Resolution & Disclosure Decisions. One FAMILY-only, tenant-scoped table
-- `safety_recipient_authorization_decisions`. Each row is a HISTORICAL snapshot of whether a membership
-- was, at evaluation time, an authorized recipient of a specific disclosure SCOPE for a SafetySignal —
-- point 6 of the pipeline ONLY. NOTHING is delivered; no CS-1/C2/C3 record is mutated. RLS ENABLE+FORCE
-- with a STRICT tenant_isolation policy (NO IS NULL branch). App role: SELECT/INSERT/UPDATE only —
-- DELETE/TRUNCATE revoked so revoke/supersede/archive preserve history. Values are TEXT validated in
-- @guardora/core; `disclosureScope` is a bounded comma-joined allow-listed scalar (never JSON/free text).
--
-- Required links (signal, profile) are same-tenant composite FKs (ON DELETE NO ACTION → signal/profile
-- delete never cascade-deletes authorization history; tenant lifecycle cleans up via the tenant FK).
-- Optional snapshot links (relationship, authority, consent, assessment) are same-tenant composite FKs
-- (ON DELETE NO ACTION). `recipientMembershipId` has NO DB FK: `removeMember` (team-repo.ts) hard-deletes
-- memberships, so NO ACTION/RESTRICT would block legitimate member removal and CASCADE would delete
-- authorization history — same-tenant is enforced in the repository (RLS lookup). No existing migration
-- is modified.

-- CS-C4 prerequisite: a composite unique on safety_signals so a decision can reference (id, tenantId).
CREATE UNIQUE INDEX "safety_signals_id_tenantId_key" ON "safety_signals"("id", "tenantId");

-- CreateTable
CREATE TABLE "safety_recipient_authorization_decisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "safetySignalId" TEXT NOT NULL,
    "protectedProfileId" TEXT NOT NULL,
    "recipientMembershipId" TEXT NOT NULL,
    "guardianRelationshipId" TEXT,
    "guardianAuthorityRecordId" TEXT,
    "consentRecordId" TEXT,
    "safeRecipientAssessmentId" TEXT,
    "decisionStatus" TEXT NOT NULL,
    "disclosureScope" TEXT NOT NULL DEFAULT '',
    "reasonCode" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "safety_recipient_authorization_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — tenant/signal/profile/recipient/status lookups + stable effective lookup.
CREATE INDEX "sread_tenant_signal_status_idx" ON "safety_recipient_authorization_decisions"("tenantId", "safetySignalId", "decisionStatus");
CREATE INDEX "sread_tenant_profile_idx" ON "safety_recipient_authorization_decisions"("tenantId", "protectedProfileId");
CREATE INDEX "sread_tenant_recipient_idx" ON "safety_recipient_authorization_decisions"("tenantId", "recipientMembershipId");
CREATE INDEX "sread_effective_lookup_idx" ON "safety_recipient_authorization_decisions"("tenantId", "safetySignalId", "recipientMembershipId", "createdAt");

-- CHECK constraints — decision integrity (fail-closed at the DB level).
-- AUTHORIZED requires the complete reference chain (authority is always required per CS-C2).
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "srad_authorized_chain"
  CHECK ("decisionStatus" <> 'authorized' OR ("guardianRelationshipId" IS NOT NULL AND "guardianAuthorityRecordId" IS NOT NULL AND "consentRecordId" IS NOT NULL AND "safeRecipientAssessmentId" IS NOT NULL));
-- DENIED must carry a denial reason (never the authorized reason).
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "srad_denied_reason"
  CHECK ("decisionStatus" <> 'denied' OR "reasonCode" <> 'complete_authorization_chain');
-- REVOKED/SUPERSEDED timestamp consistency.
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "srad_revoked_ts"
  CHECK ("decisionStatus" <> 'revoked' OR "revokedAt" IS NOT NULL);
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "srad_superseded_ts"
  CHECK ("decisionStatus" <> 'superseded' OR "supersededAt" IS NOT NULL);
-- AUTHORIZED must have a non-empty disclosure scope; DENIED must have NONE (never wider than safe default).
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "srad_authorized_scope"
  CHECK ("decisionStatus" <> 'authorized' OR length("disclosureScope") > 0);
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "srad_denied_scope"
  CHECK ("decisionStatus" <> 'denied' OR "disclosureScope" = '');
-- validUntil must be after evaluatedAt when set.
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "srad_validuntil_gt_eval"
  CHECK ("validUntil" IS NULL OR "validUntil" > "evaluatedAt");

-- AddForeignKey — tenant (cascade for tenant lifecycle) + REQUIRED same-tenant composite FKs (NO ACTION).
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "safety_recipient_authorization_decisions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "safety_recipient_authorization_decisions_safetySignalId_te_fkey"
  FOREIGN KEY ("safetySignalId", "tenantId") REFERENCES "safety_signals"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "safety_recipient_authorization_decisions_protectedProfileI_fkey"
  FOREIGN KEY ("protectedProfileId", "tenantId") REFERENCES "protected_profiles"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey — OPTIONAL same-tenant snapshot composite FKs (NO ACTION; enforced only when non-null).
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "srad_gr_fkey"
  FOREIGN KEY ("guardianRelationshipId", "tenantId") REFERENCES "guardian_relationships"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "srad_gar_fkey"
  FOREIGN KEY ("guardianAuthorityRecordId", "tenantId") REFERENCES "guardian_authority_records"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "srad_cr_fkey"
  FOREIGN KEY ("consentRecordId", "tenantId") REFERENCES "consent_records"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "safety_recipient_authorization_decisions" ADD CONSTRAINT "srad_sra_fkey"
  FOREIGN KEY ("safeRecipientAssessmentId", "tenantId") REFERENCES "safe_recipient_assessments"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- GRANTs — read/append/soft-update only; no hard delete (history preserved). Owner keeps full rights.
GRANT SELECT, INSERT, UPDATE ON "safety_recipient_authorization_decisions" TO tamanor_app;
REVOKE DELETE, TRUNCATE ON "safety_recipient_authorization_decisions" FROM tamanor_app;

-- Row-Level Security (strict tenant_isolation, ENABLE+FORCE, NO IS NULL branch).
ALTER TABLE "safety_recipient_authorization_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_recipient_authorization_decisions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "safety_recipient_authorization_decisions";
CREATE POLICY tenant_isolation ON "safety_recipient_authorization_decisions"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());
