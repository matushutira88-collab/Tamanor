-- CS-C3 — Safety Signal Foundation. One FAMILY-only, tenant-scoped table `safety_signals`. A signal
-- is ONLY a bounded structured record of a REPORTED possible-risk TYPE for a ProtectedProfile — never
-- a message/incident/evidence/alert/AI result/action. Occurrence + classification metadata + review
-- state only. RLS ENABLE+FORCE with a STRICT tenant_isolation policy (NO IS NULL bootstrap branch).
-- App role: SELECT/INSERT/UPDATE only — DELETE/TRUNCATE revoked so dismiss/confirm/archive preserve
-- history. Domain values are TEXT (validated in @guardora/core), not DB enum types.
--
-- The profile link is a same-tenant composite FK with ON DELETE NO ACTION: a profile delete can NEVER
-- cascade-delete signal history (NO ACTION is checked at end-of-statement, so tenant-lifecycle cleanup
-- via the tenant FK — which removes both signals and profiles in one cascade — still succeeds).
-- `reviewedByMembershipId` is OPTIONAL and enforced same-tenant in the repository (RLS lookup) with NO
-- DB FK, so signal history survives a member removal. No existing migration is modified.

-- CreateTable
CREATE TABLE "safety_signals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "protectedProfileId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "confidenceBand" TEXT NOT NULL DEFAULT 'unknown',
    "sourceType" TEXT NOT NULL,
    "sourceReference" TEXT,
    "occurrenceBucket" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'new',
    "detectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByMembershipId" TEXT,
    "resolutionCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "safety_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — tenant/profile/time/status lookups.
CREATE INDEX "safety_signals_tenantId_protectedProfileId_receivedAt_idx" ON "safety_signals"("tenantId", "protectedProfileId", "receivedAt");
CREATE INDEX "safety_signals_tenantId_reviewStatus_receivedAt_idx" ON "safety_signals"("tenantId", "reviewStatus", "receivedAt");
CREATE INDEX "safety_signals_tenantId_signalType_idx" ON "safety_signals"("tenantId", "signalType");

-- CHECK constraints — review/timestamp/resolution/archive consistency (fail-closed at the DB level).
-- Final review states MUST record who reviewed and when.
ALTER TABLE "safety_signals" ADD CONSTRAINT "ss_final_requires_reviewer"
  CHECK ("reviewStatus" NOT IN ('dismissed', 'confirmed_risk') OR ("reviewedAt" IS NOT NULL AND "reviewedByMembershipId" IS NOT NULL));
-- A resolution code is only meaningful on a final/terminal state (dismissed/confirmed/archived).
ALTER TABLE "safety_signals" ADD CONSTRAINT "ss_resolution_on_final"
  CHECK ("resolutionCode" IS NULL OR "reviewStatus" IN ('dismissed', 'confirmed_risk', 'archived'));
-- Archived status ⇔ archivedAt set.
ALTER TABLE "safety_signals" ADD CONSTRAINT "ss_archived_ts_consistent"
  CHECK (("reviewStatus" = 'archived') = ("archivedAt" IS NOT NULL));

-- AddForeignKey — tenant (cascade for tenant lifecycle) + same-tenant profile composite FK (NO ACTION:
-- history is never cascade-deleted by a profile delete).
ALTER TABLE "safety_signals" ADD CONSTRAINT "safety_signals_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "safety_signals" ADD CONSTRAINT "safety_signals_protectedProfileId_tenantId_fkey"
  FOREIGN KEY ("protectedProfileId", "tenantId") REFERENCES "protected_profiles"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- GRANTs — read/append/soft-update only; no hard delete (history preserved). Owner keeps full rights.
GRANT SELECT, INSERT, UPDATE ON "safety_signals" TO tamanor_app;
REVOKE DELETE, TRUNCATE ON "safety_signals" FROM tamanor_app;

-- Row-Level Security (strict tenant_isolation, ENABLE+FORCE, NO IS NULL branch).
ALTER TABLE "safety_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_signals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "safety_signals";
CREATE POLICY tenant_isolation ON "safety_signals"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());
