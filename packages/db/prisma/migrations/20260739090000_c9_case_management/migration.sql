-- C9 — Case Management & Protection Plan Foundation. A case IS the incident — these
-- are 1:1 / owned extensions of an Incident, NOT a second case model: a manual
-- Protection Plan (risk level, protection status, objective, notes, follow-up,
-- manually-toggled milestone timestamps) and Case Tasks. All human-set; nothing
-- automatic. Both tenant tables are enrolled into strict RLS (ENABLE+FORCE).

-- CreateTable — 1:1 protection plan.
CREATE TABLE "cyberbullying_protection_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "riskLevel" TEXT,
    "protectionStatus" TEXT NOT NULL DEFAULT 'not_started',
    "objective" TEXT,
    "notes" TEXT,
    "nextReviewAt" TIMESTAMP(3),
    "lastReviewAt" TIMESTAMP(3),
    "followUpNotes" TEXT,
    "milestoneInitialReviewAt" TIMESTAMP(3),
    "milestoneEvidenceCollectedAt" TIMESTAMP(3),
    "milestoneVictimContactedAt" TIMESTAMP(3),
    "milestoneProtectionActiveAt" TIMESTAMP(3),
    "milestoneResolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cyberbullying_protection_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable — case tasks.
CREATE TABLE "cyberbullying_case_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "assigneeUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cyberbullying_case_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cyberbullying_protection_plans_id_tenantId_key" ON "cyberbullying_protection_plans"("id", "tenantId");
-- CreateIndex — one protection plan per incident.
CREATE UNIQUE INDEX "cyberbullying_protection_plans_incidentId_tenantId_key" ON "cyberbullying_protection_plans"("incidentId", "tenantId");
-- CreateIndex
CREATE INDEX "cyberbullying_protection_plans_tenantId_protectionStatus_idx" ON "cyberbullying_protection_plans"("tenantId", "protectionStatus");
-- CreateIndex
CREATE UNIQUE INDEX "cyberbullying_case_tasks_id_tenantId_key" ON "cyberbullying_case_tasks"("id", "tenantId");
-- CreateIndex
CREATE INDEX "cyberbullying_case_tasks_tenantId_incidentId_status_idx" ON "cyberbullying_case_tasks"("tenantId", "incidentId", "status");

-- AddForeignKey
ALTER TABLE "cyberbullying_protection_plans" ADD CONSTRAINT "cyberbullying_protection_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cyberbullying_protection_plans" ADD CONSTRAINT "cyberbullying_protection_plans_incidentId_tenantId_fkey" FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cyberbullying_case_tasks" ADD CONSTRAINT "cyberbullying_case_tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cyberbullying_case_tasks" ADD CONSTRAINT "cyberbullying_case_tasks_incidentId_tenantId_fkey" FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security (strict tenant_isolation, ENABLE+FORCE).
GRANT SELECT, INSERT, UPDATE, DELETE ON "cyberbullying_protection_plans", "cyberbullying_case_tasks" TO tamanor_app;

DO $strict$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cyberbullying_protection_plans','cyberbullying_case_tasks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $strict$;
