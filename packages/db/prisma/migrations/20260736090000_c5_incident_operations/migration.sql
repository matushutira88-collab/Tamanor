-- C5 — Incident Operations & Review Workflow. Adds controlled human review on top
-- of the C3 incident ledger: a single primary reviewer (assignedReviewerUserId on
-- the cyberbullying detail), an append-only assignment history, and append-only,
-- confidential internal reviewer notes. No incident is deleted; existing rows keep
-- a NULL assignee (unassigned). The 2 new tenant tables are enrolled into RLS
-- strict tenant_isolation (ENABLE+FORCE), matching every other tenant table.

-- AlterTable — the one primary reviewer (nullable; existing incidents = unassigned).
ALTER TABLE "cyberbullying_incident_details" ADD COLUMN "assignedReviewerUserId" TEXT;

-- CreateTable — append-only confidential reviewer notes.
CREATE TABLE "incident_reviewer_notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_reviewer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable — append-only assignment history.
CREATE TABLE "incident_assignment_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "previousAssigneeUserId" TEXT,
    "assignedByUserId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_assignment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incident_reviewer_notes_tenantId_incidentId_createdAt_idx" ON "incident_reviewer_notes"("tenantId", "incidentId", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "incident_reviewer_notes_id_tenantId_key" ON "incident_reviewer_notes"("id", "tenantId");
-- CreateIndex
CREATE INDEX "incident_assignment_events_tenantId_incidentId_createdAt_idx" ON "incident_assignment_events"("tenantId", "incidentId", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "incident_assignment_events_id_tenantId_key" ON "incident_assignment_events"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "incident_reviewer_notes" ADD CONSTRAINT "incident_reviewer_notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_reviewer_notes" ADD CONSTRAINT "incident_reviewer_notes_incidentId_tenantId_fkey" FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_assignment_events" ADD CONSTRAINT "incident_assignment_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incident_assignment_events" ADD CONSTRAINT "incident_assignment_events_incidentId_tenantId_fkey" FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security for the 2 new tenant tables (strict tenant_isolation, ENABLE+FORCE).
GRANT SELECT, INSERT, UPDATE, DELETE ON "incident_reviewer_notes", "incident_assignment_events" TO tamanor_app;

DO $strict$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incident_reviewer_notes','incident_assignment_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $strict$;
