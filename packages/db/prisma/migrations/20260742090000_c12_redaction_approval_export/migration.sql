-- C12 — Manual Redaction, Four-Eyes Approval & Export Package Preparation. Adds
-- redaction provenance to the C11 snapshot (a REDACTED snapshot is a NEW immutable
-- row; originals are untouched), plus 5 tenant-scoped tables. Manifests + history
-- are append-only (SELECT+INSERT only for the app role); drafts / rules /
-- authorizations use controlled server-side transitions mirrored into the append-only
-- history. All new tables RLS ENABLE+FORCE. No existing incident changed.

-- AlterTable — redaction provenance on the C11 snapshot (nullable; null on originals).
ALTER TABLE "compliance_report_snapshots"
  ADD COLUMN "sourceReportId" TEXT,
  ADD COLUMN "sourceSnapshotHash" TEXT,
  ADD COLUMN "redactionDraftId" TEXT,
  ADD COLUMN "redactionRuleSetHash" TEXT,
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "redactionSummary" JSONB;

-- CreateTable
CREATE TABLE "compliance_redaction_drafts" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "incidentId" TEXT NOT NULL, "sourceReportId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft', "revision" INTEGER NOT NULL DEFAULT 1, "createdByUserId" TEXT NOT NULL,
    "submittedByUserId" TEXT, "submittedAt" TIMESTAMP(3), "approvedByUserId" TEXT, "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT, "rejectedAt" TIMESTAMP(3), "rejectionReasonCode" TEXT, "producedReportId" TEXT,
    "idempotencyKey" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "compliance_redaction_drafts_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "compliance_redaction_rules" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "draftId" TEXT NOT NULL, "fieldPath" TEXT NOT NULL,
    "action" TEXT NOT NULL, "reasonCode" TEXT NOT NULL, "reasonNote" TEXT, "replacementMarkerKey" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0, "createdByUserId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compliance_redaction_rules_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "compliance_export_authorizations" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "incidentId" TEXT NOT NULL, "reportId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested', "purposeCode" TEXT NOT NULL, "purposeNote" TEXT, "recipientType" TEXT NOT NULL,
    "recipientLabel" TEXT, "requestedByUserId" TEXT NOT NULL, "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT, "approvedAt" TIMESTAMP(3), "rejectedByUserId" TEXT, "rejectedAt" TIMESTAMP(3), "rejectionReasonCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "compliance_export_authorizations_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "compliance_export_package_manifests" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "incidentId" TEXT NOT NULL, "reportId" TEXT NOT NULL, "authorizationId" TEXT NOT NULL,
    "packageVersion" INTEGER NOT NULL, "schemaVersion" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'prepared',
    "purposeCode" TEXT NOT NULL, "recipientType" TEXT NOT NULL, "preparedByUserId" TEXT NOT NULL, "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportSnapshotHash" TEXT NOT NULL, "redactionRuleSetHash" TEXT, "authorizationHash" TEXT NOT NULL, "manifestHash" TEXT NOT NULL,
    "previousManifestHash" TEXT, "manifestPayload" JSONB NOT NULL, "idempotencyKey" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compliance_export_package_manifests_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "compliance_approval_history_events" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "incidentId" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL, "actorUserId" TEXT, "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compliance_approval_history_events_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "crd_id_tenant_key" ON "compliance_redaction_drafts"("id", "tenantId");
CREATE UNIQUE INDEX "crd_tenant_user_source_idem_key" ON "compliance_redaction_drafts"("tenantId", "createdByUserId", "sourceReportId", "idempotencyKey");
CREATE INDEX "crd_tenant_incident_status_idx" ON "compliance_redaction_drafts"("tenantId", "incidentId", "status");
CREATE UNIQUE INDEX "crr_id_tenant_key" ON "compliance_redaction_rules"("id", "tenantId");
CREATE INDEX "crr_tenant_draft_order_idx" ON "compliance_redaction_rules"("tenantId", "draftId", "order");
CREATE UNIQUE INDEX "cea_id_tenant_key" ON "compliance_export_authorizations"("id", "tenantId");
CREATE UNIQUE INDEX "cea_tenant_user_report_idem_key" ON "compliance_export_authorizations"("tenantId", "requestedByUserId", "reportId", "idempotencyKey");
CREATE INDEX "cea_tenant_incident_status_idx" ON "compliance_export_authorizations"("tenantId", "incidentId", "status");
CREATE UNIQUE INDEX "cepm_id_tenant_key" ON "compliance_export_package_manifests"("id", "tenantId");
CREATE UNIQUE INDEX "cepm_tenant_incident_report_version_key" ON "compliance_export_package_manifests"("tenantId", "incidentId", "reportId", "packageVersion");
CREATE UNIQUE INDEX "cepm_tenant_user_auth_idem_key" ON "compliance_export_package_manifests"("tenantId", "preparedByUserId", "authorizationId", "idempotencyKey");
CREATE INDEX "cepm_tenant_incident_version_idx" ON "compliance_export_package_manifests"("tenantId", "incidentId", "packageVersion");
CREATE UNIQUE INDEX "cahe_id_tenant_key" ON "compliance_approval_history_events"("id", "tenantId");
CREATE INDEX "cahe_tenant_entity_idx" ON "compliance_approval_history_events"("tenantId", "entityType", "entityId", "createdAt");

-- Foreign keys
ALTER TABLE "compliance_redaction_drafts" ADD CONSTRAINT "crd_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_redaction_rules" ADD CONSTRAINT "crr_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_redaction_rules" ADD CONSTRAINT "crr_draft_fkey" FOREIGN KEY ("draftId", "tenantId") REFERENCES "compliance_redaction_drafts"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_export_authorizations" ADD CONSTRAINT "cea_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_export_package_manifests" ADD CONSTRAINT "cepm_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_approval_history_events" ADD CONSTRAINT "cahe_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Privileges: drafts/rules/authorizations = full CRUD (controlled transitions);
-- manifests + history = append-only (SELECT+INSERT only, UPDATE/DELETE revoked).
GRANT SELECT, INSERT, UPDATE, DELETE ON "compliance_redaction_drafts", "compliance_redaction_rules", "compliance_export_authorizations" TO tamanor_app;
GRANT SELECT, INSERT ON "compliance_export_package_manifests", "compliance_approval_history_events" TO tamanor_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "compliance_export_package_manifests", "compliance_approval_history_events" FROM tamanor_app;

-- RLS (strict tenant_isolation, ENABLE+FORCE) for all 5 new tables.
DO $strict$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compliance_redaction_drafts','compliance_redaction_rules','compliance_export_authorizations','compliance_export_package_manifests','compliance_approval_history_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $strict$;
