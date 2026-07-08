-- CreateEnum
CREATE TYPE "ConnectorMode" AS ENUM ('placeholder', 'oauth_ready', 'read_only', 'action_disabled');

-- CreateEnum
CREATE TYPE "ConnectorHealth" AS ENUM ('unknown', 'healthy', 'degraded', 'error');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('running', 'completed', 'failed');

-- AlterTable
ALTER TABLE "connected_accounts" ADD COLUMN     "grantedPermissions" TEXT[],
ADD COLUMN     "health" "ConnectorHealth" NOT NULL DEFAULT 'unknown',
ADD COLUMN     "igBusinessId" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessfulSyncAt" TIMESTAMP(3),
ADD COLUMN     "longLivedToken" TEXT,
ADD COLUMN     "mode" "ConnectorMode" NOT NULL DEFAULT 'placeholder',
ADD COLUMN     "pageId" TEXT,
ADD COLUMN     "tokenType" TEXT;

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "connectedAccountId" TEXT NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'running',
    "mock" BOOLEAN NOT NULL DEFAULT false,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "deduped" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "eventType" TEXT,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_runs_tenantId_idx" ON "sync_runs"("tenantId");

-- CreateIndex
CREATE INDEX "sync_runs_connectedAccountId_startedAt_idx" ON "sync_runs"("connectedAccountId", "startedAt");

-- CreateIndex
CREATE INDEX "webhook_events_platform_receivedAt_idx" ON "webhook_events"("platform", "receivedAt");

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "connected_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
