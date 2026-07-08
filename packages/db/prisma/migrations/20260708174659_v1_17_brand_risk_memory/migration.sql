-- CreateTable
CREATE TABLE "brand_risk_feedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "itemId" TEXT,
    "actorId" TEXT,
    "feedbackType" TEXT NOT NULL,
    "originalRiskLevel" TEXT,
    "correctedRiskLevel" TEXT,
    "originalCategory" TEXT,
    "correctedCategory" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_risk_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_risk_memory_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "normalizedPhrase" TEXT NOT NULL,
    "language" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_risk_memory_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_risk_feedback_tenantId_brandId_idx" ON "brand_risk_feedback"("tenantId", "brandId");

-- CreateIndex
CREATE INDEX "brand_risk_feedback_brandId_feedbackType_idx" ON "brand_risk_feedback"("brandId", "feedbackType");

-- CreateIndex
CREATE INDEX "brand_risk_memory_rules_tenantId_brandId_isActive_idx" ON "brand_risk_memory_rules"("tenantId", "brandId", "isActive");

-- CreateIndex
CREATE INDEX "brand_risk_memory_rules_brandId_type_idx" ON "brand_risk_memory_rules"("brandId", "type");
