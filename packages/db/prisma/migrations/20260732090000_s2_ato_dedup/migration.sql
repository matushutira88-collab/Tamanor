-- S2 — dedup-aware detection: idempotency key + occurrence tracking + reason/resolution, and a partial
-- unique guard. Additive only; legacy rows keep NULL/defaults. RLS/ownership unchanged.
ALTER TABLE "security_detections" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "security_detections" ADD COLUMN "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "security_detections" ADD COLUMN "occurrenceCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "security_detections" ADD COLUMN "reasonCode" TEXT;
ALTER TABLE "security_detections" ADD COLUMN "resolutionNote" TEXT;

CREATE INDEX IF NOT EXISTS "security_detections_tenantId_kind_status_idx" ON "security_detections" ("tenantId", "kind", "status");

-- PARTIAL UNIQUE (raw SQL — Prisma cannot express a partial index): at most ONE ACTIVE
-- (open/acknowledged/confirmed) detection per (tenantId, dedupeKey). Recurring signals increment
-- occurrenceCount instead of duplicating; terminal rows (dismissed/resolved) never block a fresh one.
CREATE UNIQUE INDEX IF NOT EXISTS "security_detections_active_dedupe_uq"
  ON "security_detections" ("tenantId", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL AND "status" IN ('open', 'acknowledged', 'confirmed');
