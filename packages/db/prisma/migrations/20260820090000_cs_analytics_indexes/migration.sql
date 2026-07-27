-- Child Safety Analytics & Trends V1 — forward-only performance indexes.
--
-- Analytics reads are tenant-scoped aggregations over a BOUNDED date range on the accepted canonical
-- child-safety tables. The existing indexes are prefixed by tenantId but ordered by other columns, so a
-- bounded range scan on the time column is not directly served. These composite (tenantId, <timeCol>)
-- indexes serve the time-series + overview + median queries. No column, constraint, GRANT, RLS policy,
-- or data is changed — index-only. These tables are SYSTEM-scoped (ALL privileges already REVOKED from
-- tamanor_app); adding an index does not alter that. Forward-only; no accepted migration is modified.

-- Incidents: time series of "incidents created" + overview counts (createdAt), and the "resolutions"
-- series + resolution-median (closedAt).
CREATE INDEX IF NOT EXISTS "child_safety_incidents_tenantId_createdAt_idx"
    ON "child_safety_incidents" ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "child_safety_incidents_tenantId_closedAt_idx"
    ON "child_safety_incidents" ("tenantId", "closedAt");

-- Escalations: escalation time series + overview counts (triggeredAt).
CREATE INDEX IF NOT EXISTS "child_safety_escalations_tenantId_triggeredAt_idx"
    ON "child_safety_escalations" ("tenantId", "triggeredAt");

-- Protection plans: plan time series + overview counts (createdAt).
CREATE INDEX IF NOT EXISTS "child_safety_protection_plans_tenantId_createdAt_idx"
    ON "child_safety_protection_plans" ("tenantId", "createdAt");
