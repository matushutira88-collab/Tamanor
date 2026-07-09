-- AlterTable
ALTER TABLE "platform_action_executions" ADD COLUMN     "policyId" TEXT,
ADD COLUMN     "queueItemId" TEXT,
ALTER COLUMN "trigger" SET DEFAULT 'autonomous';
