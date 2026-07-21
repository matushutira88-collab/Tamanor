-- C2 — Cyberbullying Evidence Foundation. Four additive, tenant-scoped tables:
-- storage_objects (LOCAL reference only), incident_evidence (immutable original +
-- mutable governance), evidence_context_items, evidence_custody_events (append-only).
-- Enrolled into the RLS strict-table tenant_isolation policy (ENABLE + FORCE).

-- CreateTable
CREATE TABLE "storage_objects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "storage_objects_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "incident_evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "captureMethod" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "submittedByUserId" TEXT,
    "incidentId" TEXT,
    "protectedSubjectId" TEXT,
    "storageObjectId" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL,
    "integrityStatus" TEXT NOT NULL DEFAULT 'unverified',
    "scanStatus" TEXT NOT NULL DEFAULT 'pending_scan',
    "retentionUntil" TIMESTAMP(3),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "incident_evidence_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "evidence_context_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "sequencePosition" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidence_context_items_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "evidence_custody_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "reason" TEXT,
    "previousHash" TEXT,
    "resultingHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidence_custody_events_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "storage_objects_tenantId_createdAt_idx" ON "storage_objects"("tenantId", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "storage_objects_id_tenantId_key" ON "storage_objects"("id", "tenantId");
-- CreateIndex
CREATE INDEX "incident_evidence_tenantId_incidentId_idx" ON "incident_evidence"("tenantId", "incidentId");
-- CreateIndex
CREATE INDEX "incident_evidence_tenantId_protectedSubjectId_idx" ON "incident_evidence"("tenantId", "protectedSubjectId");
-- CreateIndex
CREATE UNIQUE INDEX "incident_evidence_id_tenantId_key" ON "incident_evidence"("id", "tenantId");
-- CreateIndex
CREATE INDEX "evidence_context_items_tenantId_evidenceId_idx" ON "evidence_context_items"("tenantId", "evidenceId");
-- CreateIndex
CREATE UNIQUE INDEX "evidence_context_items_id_tenantId_key" ON "evidence_context_items"("id", "tenantId");
-- CreateIndex
CREATE INDEX "evidence_custody_events_tenantId_evidenceId_createdAt_idx" ON "evidence_custody_events"("tenantId", "evidenceId", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "evidence_custody_events_id_tenantId_key" ON "evidence_custody_events"("id", "tenantId");
-- AddForeignKey
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_evidence" ADD CONSTRAINT "incident_evidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_evidence" ADD CONSTRAINT "incident_evidence_storageObjectId_tenantId_fkey" FOREIGN KEY ("storageObjectId", "tenantId") REFERENCES "storage_objects"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "evidence_context_items" ADD CONSTRAINT "evidence_context_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "evidence_context_items" ADD CONSTRAINT "evidence_context_items_evidenceId_tenantId_fkey" FOREIGN KEY ("evidenceId", "tenantId") REFERENCES "incident_evidence"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "evidence_custody_events" ADD CONSTRAINT "evidence_custody_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "evidence_custody_events" ADD CONSTRAINT "evidence_custody_events_evidenceId_tenantId_fkey" FOREIGN KEY ("evidenceId", "tenantId") REFERENCES "incident_evidence"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security: strict tenant_isolation on all four new tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON "storage_objects", "incident_evidence", "evidence_context_items", "evidence_custody_events" TO tamanor_app;

DO $strict$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['storage_objects','incident_evidence','evidence_context_items','evidence_custody_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $strict$;
