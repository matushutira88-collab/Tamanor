-- C6 — Manual Incident Reporting. One minimal table for DURABLE double-submit
-- protection: the manual-report create flow inserts a (tenantId, userId,
-- idempotencyKey) claim as the LAST write of its transaction, so a duplicate
-- submit hits the unique index and rolls the whole incident creation back (no
-- orphan). Client/session state alone can't survive a refresh-after-submit, so
-- the guard must be durable. No existing incident is touched. Tenant-scoped and
-- enrolled into strict RLS tenant_isolation (ENABLE+FORCE) like every tenant table.

-- CreateTable
CREATE TABLE "cyberbullying_report_submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cyberbullying_report_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cyberbullying_report_submissions_id_tenantId_key" ON "cyberbullying_report_submissions"("id", "tenantId");
-- CreateIndex — the double-submit guard: one incident per (tenant, user, key).
CREATE UNIQUE INDEX "cyberbullying_report_submissions_tenantId_userId_idempotenc_key" ON "cyberbullying_report_submissions"("tenantId", "userId", "idempotencyKey");
-- CreateIndex
CREATE INDEX "cyberbullying_report_submissions_tenantId_incidentId_idx" ON "cyberbullying_report_submissions"("tenantId", "incidentId");

-- AddForeignKey
ALTER TABLE "cyberbullying_report_submissions" ADD CONSTRAINT "cyberbullying_report_submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cyberbullying_report_submissions" ADD CONSTRAINT "cyberbullying_report_submissions_incidentId_tenantId_fkey" FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security (strict tenant_isolation, ENABLE+FORCE).
GRANT SELECT, INSERT, UPDATE, DELETE ON "cyberbullying_report_submissions" TO tamanor_app;

DO $strict$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cyberbullying_report_submissions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $strict$;
