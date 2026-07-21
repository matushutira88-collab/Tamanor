-- S1 — Security Score snapshot: score becomes NULLABLE (insufficient_data is null,
-- never a fabricated 0) and a status column records measured | insufficient_data.
-- Additive; no data loss. RLS already applies (table enrolled in S0).

-- AlterTable
ALTER TABLE "security_score_snapshots" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'insufficient_data',
ALTER COLUMN "score" DROP NOT NULL;

