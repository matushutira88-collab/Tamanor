-- V1.27 Production Safe Mode — per-brand/account kill switches + brand safety envelope.

ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "killSwitch" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "killSwitch" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "brand_live_safety_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "liveModeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autonomousHideEnabled" BOOLEAN NOT NULL DEFAULT false,
    "approvalRequiredAboveDailyLimit" BOOLEAN NOT NULL DEFAULT true,
    "dailyAutoHideLimit" INTEGER NOT NULL DEFAULT 10,
    "hourlyAutoHideLimit" INTEGER NOT NULL DEFAULT 3,
    "perCategoryDailyLimit" INTEGER NOT NULL DEFAULT 5,
    "maxConsecutiveWithoutReview" INTEGER NOT NULL DEFAULT 5,
    "minConfidenceForAutoHide" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "requireDryRunBeforeFirstLive" BOOLEAN NOT NULL DEFAULT true,
    "requireHumanApprovalForNewCategory" BOOLEAN NOT NULL DEFAULT true,
    "rollbackRequiredBeforeAutonomy" BOOLEAN NOT NULL DEFAULT true,
    "crisisLockEnabled" BOOLEAN NOT NULL DEFAULT true,
    "approvedAutoHideCategories" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "brand_live_safety_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "brand_live_safety_settings_brandId_key" ON "brand_live_safety_settings"("brandId");
CREATE INDEX IF NOT EXISTS "brand_live_safety_settings_tenantId_idx" ON "brand_live_safety_settings"("tenantId");

DO $$ BEGIN
  ALTER TABLE "brand_live_safety_settings" ADD CONSTRAINT "brand_live_safety_settings_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
