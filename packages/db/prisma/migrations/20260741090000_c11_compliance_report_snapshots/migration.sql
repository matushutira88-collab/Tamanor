-- C11 — Reporting & Compliance. One append-only, versioned, hashed compliance
-- snapshot table. Immutability is enforced at the PRIVILEGE level: the app role
-- (tamanor_app) is granted SELECT + INSERT ONLY — never UPDATE or DELETE — so the
-- application can append a snapshot but can never edit or delete one. The owner/
-- system role retains full rights, so tenant/incident cascade cleanup still works.
-- Tenant-scoped, RLS ENABLE+FORCE. No existing incident is changed; no new Case model.

-- CreateTable
CREATE TABLE "compliance_report_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "redactionState" TEXT NOT NULL DEFAULT 'unredacted_internal',
    "generatedByUserId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceIncidentUpdatedAt" TIMESTAMP(3),
    "snapshotHash" TEXT NOT NULL,
    "previousSnapshotHash" TEXT,
    "snapshotPayload" JSONB NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compliance_report_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crs_id_tenant_key" ON "compliance_report_snapshots"("id", "tenantId");
-- CreateIndex — server-computed version is unique per (tenant, incident, reportType).
CREATE UNIQUE INDEX "crs_tenant_incident_type_version_key" ON "compliance_report_snapshots"("tenantId", "incidentId", "reportType", "version");
-- CreateIndex — idempotency guard (NULL keys are distinct in Postgres).
CREATE UNIQUE INDEX "crs_tenant_user_incident_type_idem_key" ON "compliance_report_snapshots"("tenantId", "generatedByUserId", "incidentId", "reportType", "idempotencyKey");
-- CreateIndex
CREATE INDEX "crs_tenant_incident_type_version_idx" ON "compliance_report_snapshots"("tenantId", "incidentId", "reportType", "version");

-- AddForeignKey
ALTER TABLE "compliance_report_snapshots" ADD CONSTRAINT "compliance_report_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "compliance_report_snapshots" ADD CONSTRAINT "compliance_report_snapshots_incidentId_tenantId_fkey" FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- IMMUTABILITY: SELECT + INSERT only for the app role. REVOKE UPDATE/DELETE
-- explicitly to override any ALTER DEFAULT PRIVILEGES that would grant them.
GRANT SELECT, INSERT ON "compliance_report_snapshots" TO tamanor_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "compliance_report_snapshots" FROM tamanor_app;

-- Row-Level Security (strict tenant_isolation, ENABLE+FORCE).
ALTER TABLE "compliance_report_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "compliance_report_snapshots";
CREATE POLICY tenant_isolation ON "compliance_report_snapshots"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());
