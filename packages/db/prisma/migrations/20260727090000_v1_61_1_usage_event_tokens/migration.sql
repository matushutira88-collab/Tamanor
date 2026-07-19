-- V1.61.1 — persist provider-reported token usage on a finalized paid UsageEvent, so the admin AI
-- diagnostics panel can show input/output tokens (joined from UsageEvent, never duplicated in aiDiagnostics).
-- ADDITIVE + NULLABLE: no default, no index, no backfill, no constraint. Historical rows and non-paid
-- events keep NULL and render as "Usage details unavailable" in the admin panel.
ALTER TABLE "usage_events" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "usage_events" ADD COLUMN "outputTokens" INTEGER;
