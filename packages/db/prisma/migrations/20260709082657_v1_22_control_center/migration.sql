-- CreateTable
CREATE TABLE "control_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "connectedAccountId" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'any',
    "sourceType" TEXT NOT NULL DEFAULT 'comment',
    "category" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'monitor',
    "allowedActions" TEXT[],
    "minConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "control_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_queue_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "proposedAction" TEXT NOT NULL,
    "queueState" TEXT NOT NULL,
    "policyId" TEXT,
    "reason" TEXT,
    "safetyBlocked" BOOLEAN NOT NULL DEFAULT false,
    "wouldExecute" BOOLEAN NOT NULL DEFAULT false,
    "approvedByUserId" TEXT,
    "rejectedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "sourcePlatform" TEXT,
    "relatedItemIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "control_policies_tenantId_brandId_isActive_idx" ON "control_policies"("tenantId", "brandId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "control_policies_brandId_platform_sourceType_category_key" ON "control_policies"("brandId", "platform", "sourceType", "category");

-- CreateIndex
CREATE UNIQUE INDEX "action_queue_items_itemId_key" ON "action_queue_items"("itemId");

-- CreateIndex
CREATE INDEX "action_queue_items_tenantId_brandId_queueState_idx" ON "action_queue_items"("tenantId", "brandId", "queueState");

-- CreateIndex
CREATE INDEX "incidents_tenantId_brandId_status_idx" ON "incidents"("tenantId", "brandId", "status");
