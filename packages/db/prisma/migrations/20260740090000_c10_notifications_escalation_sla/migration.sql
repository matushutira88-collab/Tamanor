-- C10 — Internal Notifications, Escalation & SLA Foundation. Two tenant tables:
-- a cyberbullying-scoped in-app `cyberbullying_notifications` foundation (recipient-based,
-- with a per-(tenant,recipient,dedupKey) unique guard), and `cyberbullying_escalations`
-- (an explicit human step that never mutates the incident lifecycle/risk/tasks/assignments).
-- SLA state is DERIVED, not stored. No existing incident is changed; no new Case model.
-- Both tables RLS ENABLE+FORCE.
--
-- NOTE: this table was renamed from `notifications` to `cyberbullying_notifications` during
-- the origin/main merge — origin/main's V1.70 owns the general product `notifications` table
-- (different shape), so the two notification domains coexist without colliding.

-- CreateTable — cyberbullying notification foundation.
CREATE TABLE "cyberbullying_notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "incidentId" TEXT,
    "deduplicationKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    CONSTRAINT "cyberbullying_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable — manual escalation.
CREATE TABLE "cyberbullying_escalations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "severity" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "note" TEXT,
    "escalatedByUserId" TEXT NOT NULL,
    "escalatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetUserId" TEXT,
    "targetRole" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cyberbullying_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cyberbullying_notifications_id_tenantId_key" ON "cyberbullying_notifications"("id", "tenantId");
-- CreateIndex — dedup guard.
CREATE UNIQUE INDEX "cyberbullying_notifications_dedup_key" ON "cyberbullying_notifications"("tenantId", "recipientUserId", "deduplicationKey");
-- CreateIndex — unread list.
CREATE INDEX "cyberbullying_notifications_unread_idx" ON "cyberbullying_notifications"("tenantId", "recipientUserId", "readAt", "createdAt");
-- CreateIndex
CREATE INDEX "cyberbullying_notifications_tenantId_incidentId_idx" ON "cyberbullying_notifications"("tenantId", "incidentId");
-- CreateIndex
CREATE UNIQUE INDEX "cyberbullying_escalations_id_tenantId_key" ON "cyberbullying_escalations"("id", "tenantId");
-- CreateIndex
CREATE INDEX "cyberbullying_escalations_tenantId_incidentId_status_idx" ON "cyberbullying_escalations"("tenantId", "incidentId", "status");

-- AddForeignKey
ALTER TABLE "cyberbullying_notifications" ADD CONSTRAINT "cyberbullying_notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cyberbullying_escalations" ADD CONSTRAINT "cyberbullying_escalations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cyberbullying_escalations" ADD CONSTRAINT "cyberbullying_escalations_incidentId_tenantId_fkey" FOREIGN KEY ("incidentId", "tenantId") REFERENCES "incidents"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security (strict tenant_isolation, ENABLE+FORCE).
GRANT SELECT, INSERT, UPDATE, DELETE ON "cyberbullying_notifications", "cyberbullying_escalations" TO tamanor_app;

DO $strict$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cyberbullying_notifications','cyberbullying_escalations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $strict$;
