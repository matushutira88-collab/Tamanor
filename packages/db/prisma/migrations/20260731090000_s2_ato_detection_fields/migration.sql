-- S2 — Account-Takeover detection foundation: two additive, nullable columns on the existing S0 ledger.
-- `confidence` (0..100 deterministic strength of evidence) and `source` (DetectionSource). Additive only;
-- no data change; legacy rows keep NULL. RLS/ownership on security_detections is unchanged (S0 policy).
ALTER TABLE "security_detections" ADD COLUMN "confidence" INTEGER;
ALTER TABLE "security_detections" ADD COLUMN "source" TEXT;
