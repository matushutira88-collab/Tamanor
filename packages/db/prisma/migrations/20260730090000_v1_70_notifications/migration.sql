-- V1.70 (Release B / B2) — tenant-scoped product notifications, RLS-enforced.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('first_sync_completed', 'sync_failed', 'risk_comment_detected', 'monitoring_disabled_by_plan', 'trial_ending', 'trial_expired', 'payment_failed', 'account_reconnect_required');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "NotificationType" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'info',
    "titleKey" TEXT NOT NULL,
    "messageKey" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_readAt_createdAt_idx" ON "notifications"("tenantId", "userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_createdAt_idx" ON "notifications"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenantId_dedupeKey_key" ON "notifications"("tenantId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security: tenant isolation (ENABLE + FORCE so even the table owner is constrained), the
-- same current_app_tenant_id() policy every tenant table uses, plus the runtime-role grant.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications"
  USING (current_app_tenant_id() IS NULL OR "tenantId" = current_app_tenant_id())
  WITH CHECK (current_app_tenant_id() IS NULL OR "tenantId" = current_app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications" TO tamanor_app;
