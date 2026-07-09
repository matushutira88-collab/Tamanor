-- V1.25B — idempotency guard for controlled Facebook hide executions.
-- At most one ACTIVE (dry_run or executed) attempt may exist per logical action
-- (queueItemId + actionType + trigger). Blocked/failed rows are unconstrained so
-- gate-change re-attempts and explicit retries remain possible. Rows without a
-- queueItemId (autonomous) are excluded — they are not Approve-double-click cases.

-- 1) Collapse pre-existing duplicate active attempts (the V1.25B bug artifact):
--    keep one row per key — prefer an executed row, else the earliest dry_run —
--    and delete the redundant duplicates. Only dry_run/executed rows are touched.
DELETE FROM "platform_action_executions" p
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY "queueItemId", "actionType", "trigger"
           ORDER BY ("status" = 'executed') DESC, "createdAt" ASC
         ) AS rn
  FROM "platform_action_executions"
  WHERE "status" IN ('dry_run', 'executed') AND "queueItemId" IS NOT NULL
) d
WHERE p.id = d.id AND d.rn > 1;

-- 2) Enforce single active attempt per action going forward.
CREATE UNIQUE INDEX IF NOT EXISTS "platform_action_executions_active_attempt_uq"
  ON "platform_action_executions" ("queueItemId", "actionType", "trigger")
  WHERE "status" IN ('dry_run', 'executed') AND "queueItemId" IS NOT NULL;
