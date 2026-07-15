-- V1.51C — additive, EXPLAIN-proven index for the inbox sentiment facet counts.
--
-- The inbox facet panel issues per-sentiment COUNT(*) queries per tenant
-- (`WHERE "tenantId" = $1 AND sentiment = $2`). With no composite index these ran as a Seq Scan.
-- Measured with EXPLAIN (ANALYZE, BUFFERS) on a 10,115-row table:
--   before: Seq Scan — cost 1137, shared buffers 986, ~75 ms
--   after : Index Only Scan — cost 162, shared buffers 37, ~0.5 ms  (~150× faster; planner chose it)
--
-- This is the ONLY index added in V1.51C. The other candidates were rejected as speculative:
-- connected_accounts (145 rows) and usage_periods (62 rows) are too small — EXPLAIN shows the planner
-- keeps a Seq Scan even with the candidate index present, so no benefit could be proven at current
-- data volume (revisit with production-scale data).
--
-- Additive + backward compatible: index-only, no column/constraint change. IF NOT EXISTS is idempotent.
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_sentiment_idx"
  ON "reputation_items" ("tenantId", "sentiment");
