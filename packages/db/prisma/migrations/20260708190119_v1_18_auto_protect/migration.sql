-- CreateTable
CREATE TABLE "brand_auto_protect_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'monitor',
    "minConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_auto_protect_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_protect_decisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "matchedCategory" TEXT NOT NULL,
    "policyMode" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_protect_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_auto_protect_policies_tenantId_brandId_isActive_idx" ON "brand_auto_protect_policies"("tenantId", "brandId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "brand_auto_protect_policies_brandId_category_key" ON "brand_auto_protect_policies"("brandId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "auto_protect_decisions_itemId_key" ON "auto_protect_decisions"("itemId");

-- CreateIndex
CREATE INDEX "auto_protect_decisions_tenantId_brandId_idx" ON "auto_protect_decisions"("tenantId", "brandId");

-- CreateIndex
CREATE INDEX "auto_protect_decisions_brandId_decision_idx" ON "auto_protect_decisions"("brandId", "decision");
