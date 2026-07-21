-- V1.67 — additive hot-path indexes (no data change, no lock beyond a fast index build on current volume).
--
-- 1) content_items(tenantId, ingestedAt): the dashboard + accounts metrics group content by account over a
--    recent window (WHERE tenantId + ingestedAt >= since). content_items is the highest-cardinality table;
--    without this index each groupBy scans the tenant's entire content history.
CREATE INDEX IF NOT EXISTS "content_items_tenantId_ingestedAt_idx" ON "content_items" ("tenantId", "ingestedAt");

-- 2) audit_logs(tenantId, targetType, targetId): the inbox per-item activity timeline filters by
--    (targetType, targetId IN pageIds); audit_logs grows unbounded, so without this it walks the tenant's
--    audit history newest-first and filters.
CREATE INDEX IF NOT EXISTS "audit_logs_tenantId_targetType_targetId_idx" ON "audit_logs" ("tenantId", "targetType", "targetId");
