-- AlterTable
ALTER TABLE "connected_accounts" ADD COLUMN     "lastCursor" TEXT;

-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN     "cursor" TEXT;
