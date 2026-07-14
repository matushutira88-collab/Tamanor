-- V1.45C3 — Webhook Retention & Global Lead Erasure (ADDITIVE; the ONLY non-add is relaxing a NOT NULL).
--
-- Deletes NO webhook rows and NULLs NO payloads at migration time — the runtime retention job does that
-- on the operator's schedule. Makes `webhook_events.payload` nullable so payloads can be MINIMIZED, adds
-- the two retention scan indexes, and adds a GLOBAL privacy-safe lead-erasure receipt (system-scope,
-- no RLS, no FK — like the other global receipts). Guarded / idempotent for dev re-runs.

-- 1) Relax payload NOT NULL (safe: no existing row is modified; new inserts still provide a payload).
ALTER TABLE "webhook_events" ALTER COLUMN "payload" DROP NOT NULL;

-- 2) Retention scan indexes.
--    (a) plain receivedAt — backs the global row-TTL age scan (DELETE WHERE receivedAt < cutoff).
CREATE INDEX IF NOT EXISTS "webhook_events_receivedAt_idx" ON "webhook_events"("receivedAt");
--    (b) PARTIAL index for the payload-minimization scan — only rows that still hold a payload are
--        candidates, so a partial index keeps the working set tiny and the scan index-only.
CREATE INDEX IF NOT EXISTS "webhook_events_payload_present_receivedAt_idx"
  ON "webhook_events"("receivedAt") WHERE "payload" IS NOT NULL;

-- 3) Lead erasure mode enum.
DO $$ BEGIN
  CREATE TYPE "LeadErasureMode" AS ENUM ('lead_id', 'normalized_email');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4) GLOBAL privacy-safe lead-erasure receipt. No RLS, no FK. Aggregate/opaque fields only — NEVER the
--    erased lead ids, email, email hash, name, company, website, message, or notes.
CREATE TABLE IF NOT EXISTS "lead_erasure_receipts" (
  "id"                TEXT NOT NULL,
  "operationId"       TEXT NOT NULL,
  "requestedByUserId" TEXT,
  "mode"              "LeadErasureMode" NOT NULL,
  "matchedCount"      INTEGER NOT NULL DEFAULT 0,
  "requestedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"       TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lead_erasure_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "lead_erasure_receipts_operationId_key" ON "lead_erasure_receipts"("operationId");
