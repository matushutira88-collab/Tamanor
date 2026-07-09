-- V1.26 — First controlled LIVE Facebook hide.
-- A live hide creates an `executed` row while the preflight `dry_run` row is kept
-- for the same (queueItemId, actionType, trigger). So the active-attempt guard is
-- narrowed to `executed` only: at most ONE executed row per action (the real
-- guarantee — no double live execution / no second hide on double-click). Dry-run
-- de-duplication remains an application-level idempotency check.
DROP INDEX IF EXISTS "platform_action_executions_active_attempt_uq";

CREATE UNIQUE INDEX IF NOT EXISTS "platform_action_executions_executed_uq"
  ON "platform_action_executions" ("queueItemId", "actionType", "trigger")
  WHERE "status" = 'executed' AND "queueItemId" IS NOT NULL;
