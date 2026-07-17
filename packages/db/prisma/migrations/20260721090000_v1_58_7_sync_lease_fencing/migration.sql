-- V1.58.7 — Sync lease FENCING generation + `interrupted` run lifecycle. Runs as the OWNER
-- (postgres, bypassrls). PRODUCTION-SAFE and BACKWARD-COMPATIBLE with the currently-deployed
-- (old) worker — no deployment-order window is required:
--
--   • `generation` is a BIGINT with DEFAULT 0. The OLD worker's acquire path (Prisma
--     updateMany takeover / create) never sets it, so it keeps working unchanged; every existing
--     lease row is backfilled to the safe floor 0. Any NEW-worker acquire/takeover assigns a
--     strictly higher value, so an old row can never out-rank a new holder.
--   • The token is issued by a monotonic DB SEQUENCE (`nextval`), NEVER an application clock —
--     so it is strictly increasing across crashes, clock skew, and release+re-acquire.
--   • `interrupted` is an ADDITIVE SyncRunStatus value (the old worker never writes it; only the
--     new worker labels a lease-lost/shutdown run with it). Adding an enum value is backward safe.
--
-- ADDITIVE only: no DROP of a table/column/constraint, no data reset, no NOT-NULL without a default,
-- no new constraint that could reject an old-worker write. FENCING IS INACTIVE until the new worker
-- is deployed — this migration only makes the schema ready. ROLLBACK = drop the column + sequence
-- (the enum value is harmless to leave; nothing references it until the new worker runs).

-- 1) Additive run-lifecycle state (existing rows unaffected; not USED in this migration).
ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'interrupted';

-- 2) Monotonic fencing-token source. A DB sequence guarantees strictly increasing tokens
--    independent of any host clock. Owned by postgres; the app role only needs USAGE (nextval).
CREATE SEQUENCE IF NOT EXISTS "sync_lease_generation_seq" AS BIGINT START WITH 1 INCREMENT BY 1;

-- 3) Per-lease fencing generation. DEFAULT 0 = safe floor for existing rows AND for any write by
--    the still-running old worker (which does not set it). The new worker always assigns nextval().
ALTER TABLE "sync_leases" ADD COLUMN IF NOT EXISTS "generation" BIGINT NOT NULL DEFAULT 0;

-- 4) The app role (tamanor_app, NOBYPASSRLS) calls nextval() inside withTenantDb during acquire.
--    USAGE is required to advance the sequence; SELECT lets it read currval for diagnostics. RLS on
--    sync_leases (tenant_isolation, from v1_37_4) is UNCHANGED — this only adds a column + a grant.
GRANT USAGE, SELECT ON SEQUENCE "sync_lease_generation_seq" TO tamanor_app;
