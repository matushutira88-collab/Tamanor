-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN     "durationMs" INTEGER;

-- CreateTable
CREATE TABLE "meta_onboarding_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAccessToken" TEXT NOT NULL,
    "tokenType" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "grantedScopes" TEXT[],
    "pages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_onboarding_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_onboarding_sessions_tenantId_brandId_idx" ON "meta_onboarding_sessions"("tenantId", "brandId");

-- AddForeignKey
ALTER TABLE "meta_onboarding_sessions" ADD CONSTRAINT "meta_onboarding_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
