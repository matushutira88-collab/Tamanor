-- V1.43 — Unified Inbox scalability indexes (ADDITIVE ONLY; index-only, no data/column change).
-- Supports deterministic keyset pagination (ORDER BY createdAt DESC, id DESC within a tenant) so a
-- filtered page seeks to its cursor and reads rows in index order — no sort node, no sequential
-- scan, cost independent of page depth. IF NOT EXISTS keeps it idempotent.

-- 1) Primary keyset index: tenant + descending sort keys. Serves the "all"/facet-filtered views.
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_createdAt_id_idx"
  ON "reputation_items" ("tenantId", "createdAt" DESC, "id" DESC);

-- 2) Default/archived views additionally constrain archivedAt before the sort keys; this composite
--    lets the dominant default inbox (archivedAt IS NULL) seek + read in order.
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_archivedAt_createdAt_id_idx"
  ON "reputation_items" ("tenantId", "archivedAt", "createdAt" DESC, "id" DESC);
