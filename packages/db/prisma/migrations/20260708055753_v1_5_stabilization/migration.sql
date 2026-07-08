-- AlterTable
ALTER TABLE "connected_accounts" ADD COLUMN     "nextRetryAt" TIMESTAMP(3),
ADD COLUMN     "syncAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "webhook_events" ADD COLUMN     "error" TEXT,
ADD COLUMN     "matched" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "webhook_events_processed_idx" ON "webhook_events"("processed");
