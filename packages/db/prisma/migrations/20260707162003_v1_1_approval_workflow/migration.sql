/*
  Warnings:

  - You are about to drop the column `actorKind` on the `moderation_decisions` table. All the data in the column will be lost.
  - You are about to drop the column `actorUserId` on the `moderation_decisions` table. All the data in the column will be lost.
  - You are about to drop the column `approvedAt` on the `moderation_decisions` table. All the data in the column will be lost.
  - You are about to drop the column `approvedByUserId` on the `moderation_decisions` table. All the data in the column will be lost.
  - You are about to drop the column `error` on the `moderation_decisions` table. All the data in the column will be lost.
  - Added the required column `proposedByKind` to the `moderation_decisions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "DecisionStatus" ADD VALUE 'cancelled';

-- AlterEnum
ALTER TYPE "ModerationAction" ADD VALUE 'ignore';

-- DropForeignKey
ALTER TABLE "moderation_decisions" DROP CONSTRAINT "moderation_decisions_actorUserId_fkey";

-- DropForeignKey
ALTER TABLE "moderation_decisions" DROP CONSTRAINT "moderation_decisions_approvedByUserId_fkey";

-- AlterTable
ALTER TABLE "moderation_decisions" DROP COLUMN "actorKind",
DROP COLUMN "actorUserId",
DROP COLUMN "approvedAt",
DROP COLUMN "approvedByUserId",
DROP COLUMN "error",
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "proposedByKind" "ActorKind" NOT NULL,
ADD COLUMN     "proposedByUserId" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewerUserId" TEXT,
ADD COLUMN     "riskSnapshot" JSONB;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
