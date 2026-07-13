-- V1.38.1 — Instagram Content Ingestion & Webhook Completion (additive only).
--
-- 1) ConnectedAccount.contentPermissionState: last truthful IG content permission/
--    availability state (nullable; set only from a real Graph/discovery signal).
-- 2) WebhookEvent.dedupeKey: stable replay/dedup key (the X-Hub-Signature-256 over the
--    raw body). A UNIQUE index rejects a redelivered (replayed) event. Nullable so rows
--    without a signature (legacy / unsigned) do not collide (multiple NULLs allowed).
--
-- Both columns are nullable and add no constraints to existing rows — safe additive.

ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "contentPermissionState" TEXT;

ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_dedupeKey_key" ON "webhook_events" ("dedupeKey");
