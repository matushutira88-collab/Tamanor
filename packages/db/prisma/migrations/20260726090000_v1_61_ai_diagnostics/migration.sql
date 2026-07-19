-- V1.61 — admin-only classification diagnostics on reputation items.
-- Additive + nullable: historical rows keep NULL; no backfill, no lock beyond a fast metadata change.
-- Stores structured verdicts (rules / AI / merged) + AI invocation metadata. NEVER comment text,
-- prompt, or raw model output.
ALTER TABLE "reputation_items" ADD COLUMN "aiDiagnostics" JSONB;
