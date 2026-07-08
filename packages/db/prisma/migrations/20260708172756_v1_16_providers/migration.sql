-- AlterTable
ALTER TABLE "reputation_items" ADD COLUMN     "aiProvider" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "aiProviderStatus" TEXT NOT NULL DEFAULT 'skipped',
ADD COLUMN     "classificationMode" TEXT NOT NULL DEFAULT 'rules_only';

-- CreateTable
CREATE TABLE "provider_calls" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "itemId" TEXT,
    "tenantId" TEXT,
    "brandId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_calls_type_createdAt_idx" ON "provider_calls"("type", "createdAt");

-- CreateIndex
CREATE INDEX "provider_calls_tenantId_idx" ON "provider_calls"("tenantId");
