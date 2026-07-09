-- CreateTable
CREATE TABLE "platform_action_executions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "connectedAccountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL DEFAULT 'system',
    "trigger" TEXT NOT NULL DEFAULT 'auto_protect',
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "policyCategory" TEXT,
    "confidence" DOUBLE PRECISION,
    "externalCommentId" TEXT,
    "externalPostId" TEXT,
    "providerResponseCode" TEXT,
    "providerErrorCode" TEXT,
    "providerErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),

    CONSTRAINT "platform_action_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_action_executions_tenantId_brandId_idx" ON "platform_action_executions"("tenantId", "brandId");

-- CreateIndex
CREATE INDEX "platform_action_executions_status_idx" ON "platform_action_executions"("status");

-- CreateIndex
CREATE INDEX "platform_action_executions_itemId_idx" ON "platform_action_executions"("itemId");
