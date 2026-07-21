-- C8 — Detection Adapter & Human Triage. Adds a cyberbullying TRIAGE overlay on top
-- of the existing SecurityDetection ledger (NOT a second detection model): a 1:1
-- triage-state row + an append-only triage-history/timeline table. The security-
-- domain `security_detections.status` is never touched; no detection is deleted.
-- Both tenant tables are enrolled into strict RLS tenant_isolation (ENABLE+FORCE).

-- CreateTable — 1:1 triage state overlay.
CREATE TABLE "cyberbullying_detection_triage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "securityDetectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "incidentId" TEXT,
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cyberbullying_detection_triage_pkey" PRIMARY KEY ("id")
);

-- CreateTable — append-only triage timeline / status history.
CREATE TABLE "cyberbullying_detection_triage_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "securityDetectionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cyberbullying_detection_triage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cyberbullying_detection_triage_id_tenantId_key" ON "cyberbullying_detection_triage"("id", "tenantId");
-- CreateIndex — one triage row per detection.
CREATE UNIQUE INDEX "cyberbullying_detection_triage_securityDetectionId_tenantI_key" ON "cyberbullying_detection_triage"("securityDetectionId", "tenantId");
-- CreateIndex
CREATE INDEX "cyberbullying_detection_triage_tenantId_status_idx" ON "cyberbullying_detection_triage"("tenantId", "status");
-- CreateIndex
CREATE UNIQUE INDEX "cyberbullying_detection_triage_events_id_tenantId_key" ON "cyberbullying_detection_triage_events"("id", "tenantId");
-- CreateIndex
CREATE INDEX "cyberbullying_detection_triage_events_tenantId_securityDete_idx" ON "cyberbullying_detection_triage_events"("tenantId", "securityDetectionId", "createdAt");

-- AddForeignKey
ALTER TABLE "cyberbullying_detection_triage" ADD CONSTRAINT "cyberbullying_detection_triage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cyberbullying_detection_triage" ADD CONSTRAINT "cyberbullying_detection_triage_securityDetectionId_tenantId_fkey" FOREIGN KEY ("securityDetectionId", "tenantId") REFERENCES "security_detections"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cyberbullying_detection_triage_events" ADD CONSTRAINT "cyberbullying_detection_triage_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cyberbullying_detection_triage_events" ADD CONSTRAINT "cyberbullying_detection_triage_events_securityDetectionId_tenantId_fkey" FOREIGN KEY ("securityDetectionId", "tenantId") REFERENCES "security_detections"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security (strict tenant_isolation, ENABLE+FORCE).
GRANT SELECT, INSERT, UPDATE, DELETE ON "cyberbullying_detection_triage", "cyberbullying_detection_triage_events" TO tamanor_app;

DO $strict$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cyberbullying_detection_triage','cyberbullying_detection_triage_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $strict$;
