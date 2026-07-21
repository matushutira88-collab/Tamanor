-- C3 — Incident Core & Detection Binding. Generalizes the single Incident ledger
-- (ADR-0001: brandId nullable + domain discriminator, backward-compatible default
-- 'reputation') and adds the cyberbullying case graph. Existing brand incidents are
-- unaffected (brandId kept, domain backfills to 'reputation'). No incident is deleted.
-- The 4 new tenant tables are enrolled into RLS strict tenant_isolation (ENABLE+FORCE).

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "domain" TEXT NOT NULL DEFAULT 'reputation',
ALTER COLUMN "brandId" DROP NOT NULL;
-- CreateTable
CREATE TABLE "cyberbullying_incident_details" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "protectedSubjectId" TEXT NOT NULL,
    "reportSource" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "allegedActorLabel" TEXT,
    "allegedActorExternalReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cyberbullying_incident_details_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "incident_timeline_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_timeline_events_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "incident_participants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "protectedSubjectId" TEXT,
    "userId" TEXT,
    "externalReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_participants_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "incident_detection_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "securityDetectionId" TEXT NOT NULL,
    "linkedByUserId" TEXT,
    "linkReason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_detection_links_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "cyberbullying_incident_details_tenantId_protectedSubjectId_idx" ON "cyberbullying_incident_details"("tenantId", "protectedSubjectId");
-- CreateIndex
CREATE UNIQUE INDEX "cyberbullying_incident_details_id_tenantId_key" ON "cyberbullying_incident_details"("id", "tenantId");
-- CreateIndex
CREATE UNIQUE INDEX "cyberbullying_incident_details_incidentId_tenantId_key" ON "cyberbullying_incident_details"("incidentId", "tenantId");
-- CreateIndex
CREATE INDEX "incident_timeline_events_tenantId_incidentId_createdAt_idx" ON "incident_timeline_events"("tenantId", "incidentId", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "incident_timeline_events_id_tenantId_key" ON "incident_timeline_events"("id", "tenantId");
-- CreateIndex
CREATE INDEX "incident_participants_tenantId_incidentId_idx" ON "incident_participants"("tenantId", "incidentId");
-- CreateIndex
CREATE UNIQUE INDEX "incident_participants_id_tenantId_key" ON "incident_participants"("id", "tenantId");
-- CreateIndex
CREATE UNIQUE INDEX "incident_participants_incidentId_role_protectedSubjectId_us_key" ON "incident_participants"("incidentId", "role", "protectedSubjectId", "userId", "externalReference");
-- CreateIndex
CREATE INDEX "incident_detection_links_tenantId_incidentId_idx" ON "incident_detection_links"("tenantId", "incidentId");
-- CreateIndex
CREATE UNIQUE INDEX "incident_detection_links_id_tenantId_key" ON "incident_detection_links"("id", "tenantId");
-- CreateIndex
CREATE UNIQUE INDEX "incident_detection_links_incidentId_securityDetectionId_key" ON "incident_detection_links"("incidentId", "securityDetectionId");
-- CreateIndex
CREATE INDEX "incidents_tenantId_domain_status_idx" ON "incidents"("tenantId", "domain", "status");
-- AddForeignKey
ALTER TABLE "incident_evidence" ADD CONSTRAINT "incident_evidence_incidentId_tenantId_fkey" FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cyberbullying_incident_details" ADD CONSTRAINT "cyberbullying_incident_details_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cyberbullying_incident_details" ADD CONSTRAINT "cyberbullying_incident_details_incidentId_tenantId_fkey" FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cyberbullying_incident_details" ADD CONSTRAINT "cyberbullying_incident_details_protectedSubjectId_tenantId_fkey" FOREIGN KEY ("protectedSubjectId", "tenantId") REFERENCES "protected_subjects"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_timeline_events" ADD CONSTRAINT "incident_timeline_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_timeline_events" ADD CONSTRAINT "incident_timeline_events_incidentId_tenantId_fkey" FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_participants" ADD CONSTRAINT "incident_participants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_participants" ADD CONSTRAINT "incident_participants_incidentId_tenantId_fkey" FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_participants" ADD CONSTRAINT "incident_participants_protectedSubjectId_tenantId_fkey" FOREIGN KEY ("protectedSubjectId", "tenantId") REFERENCES "protected_subjects"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_detection_links" ADD CONSTRAINT "incident_detection_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_detection_links" ADD CONSTRAINT "incident_detection_links_incidentId_tenantId_fkey" FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_detection_links" ADD CONSTRAINT "incident_detection_links_securityDetectionId_tenantId_fkey" FOREIGN KEY ("securityDetectionId", "tenantId") REFERENCES "security_detections"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security for the 4 new tenant tables (incidents + incident_evidence already have RLS).
GRANT SELECT, INSERT, UPDATE, DELETE ON "cyberbullying_incident_details", "incident_timeline_events", "incident_participants", "incident_detection_links" TO tamanor_app;

DO $strict$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cyberbullying_incident_details','incident_timeline_events','incident_participants','incident_detection_links'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $strict$;
