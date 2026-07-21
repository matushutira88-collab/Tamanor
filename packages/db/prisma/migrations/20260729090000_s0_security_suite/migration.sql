-- S0 — Security Suite foundations. Additive; no data loss. Detection & response
-- only (no new platform-mutation capability). Tenant-scoped tables added to the
-- RLS strict-table policy below so tenant isolation matches every other table.
-- Mirrors @guardora/core security.ts enums (string columns) + reuses RiskLevel/Platform.

-- CreateTable
CREATE TABLE "security_score_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT,
    "scope" TEXT NOT NULL,
    "subjectId" TEXT,
    "score" INTEGER NOT NULL,
    "subscores" JSONB NOT NULL,
    "inputs" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_score_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_detections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" "RiskLevel" NOT NULL DEFAULT 'low',
    "status" TEXT NOT NULL DEFAULT 'open',
    "evidence" JSONB,
    "detectedByEngine" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "security_detections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_protection_cases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "platform" "Platform",
    "subjectHandle" TEXT,
    "evidenceUrl" TEXT,
    "evidence" JSONB,
    "source" TEXT NOT NULL,
    "severity" "RiskLevel" NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "linkedDetectionId" TEXT,
    "linkedIncidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "brand_protection_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_score_snapshots_tenantId_scope_computedAt_idx" ON "security_score_snapshots"("tenantId", "scope", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "security_score_snapshots_id_tenantId_key" ON "security_score_snapshots"("id", "tenantId");

-- CreateIndex
CREATE INDEX "security_detections_tenantId_status_detectedAt_idx" ON "security_detections"("tenantId", "status", "detectedAt");

-- CreateIndex
CREATE INDEX "security_detections_tenantId_subjectType_subjectId_idx" ON "security_detections"("tenantId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "security_detections_id_tenantId_key" ON "security_detections"("id", "tenantId");

-- CreateIndex
CREATE INDEX "brand_protection_cases_tenantId_status_createdAt_idx" ON "brand_protection_cases"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "brand_protection_cases_id_tenantId_key" ON "brand_protection_cases"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "security_score_snapshots" ADD CONSTRAINT "security_score_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_score_snapshots" ADD CONSTRAINT "security_score_snapshots_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_detections" ADD CONSTRAINT "security_detections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_detections" ADD CONSTRAINT "security_detections_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_protection_cases" ADD CONSTRAINT "brand_protection_cases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_protection_cases" ADD CONSTRAINT "brand_protection_cases_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security: enrol the new tenant-scoped tables into the SAME strict
-- tenant_isolation policy as every other tenant table (see V1.37.2 RLS). No
-- context => no rows (fail-closed). Idempotent. Grants for the runtime role are
-- covered by ALTER DEFAULT PRIVILEGES, restated here defensively.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "security_score_snapshots", "security_detections", "brand_protection_cases"
  TO tamanor_app;

DO $strict$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'security_score_snapshots','security_detections','brand_protection_cases'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $strict$;

