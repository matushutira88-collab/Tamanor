-- V1.45C2 — User Identity Erasure (ADDITIVE ONLY; no reset, no data rewrite, no history edit).
--
-- Adds a GLOBAL, privacy-safe user-deletion receipt. No User/Tenant FK (it must SURVIVE the hard
-- delete of the user). System-scope only (like `leads` / `tenant_deletion_receipts` / global usage):
-- no RLS. The rest of user erasure needs NO schema change — every User FK is already correct
-- (memberships/sessions CASCADE; historical actor/author refs SET NULL). No User deletion state is
-- added: erasure is a single atomic transaction. Safe to re-run in dev (all statements guarded).

-- 1) Initiator enum -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "UserDeletionInitiator" AS ENUM ('self', 'platform_admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) GLOBAL privacy-safe user-deletion receipt. Stores aggregate, NON-PII facts only. `deletedUserId`
--    and `requestedByUserId` are OPAQUE copied cuids with NO foreign key (so the row survives the
--    user cascade). A receipt exists iff the erasure committed (written in the same transaction).
CREATE TABLE IF NOT EXISTS "user_deletion_receipts" (
  "id"                TEXT NOT NULL,
  "operationId"       TEXT NOT NULL,
  "deletedUserId"     TEXT NOT NULL,
  "initiatedBy"       "UserDeletionInitiator" NOT NULL,
  "requestedByUserId" TEXT,
  "membershipCount"   INTEGER NOT NULL DEFAULT 0,
  "sessionCount"      INTEGER NOT NULL DEFAULT 0,
  "requestedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"       TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_deletion_receipts_pkey" PRIMARY KEY ("id")
);
-- Unique operationId prevents duplicate independent operations / double-inserts.
CREATE UNIQUE INDEX IF NOT EXISTS "user_deletion_receipts_operationId_key" ON "user_deletion_receipts"("operationId");
CREATE INDEX IF NOT EXISTS "user_deletion_receipts_deletedUserId_idx" ON "user_deletion_receipts"("deletedUserId");
