-- CUSTOMER CLASSIFICATION PROJECTION — persist the canonical customer-visible verdict.
--
-- Additive, forward-only, idempotent (IF NOT EXISTS). NO destructive statement, NO backfill, NO change to
-- any existing column. The RAW verdict (`riskLevel`, `riskConfidence`, `riskCategories`, `aiDiagnostics`)
-- is untouched and remains the immutable diagnostic source of truth.
-- Sorts strictly after 20260831090000_business_contact_privacy_lifecycle.
--
-- WHY. The evidence gate that decides whether an accusation may be shown to a customer lives inside the
-- `aiDiagnostics` JSON. A JSON verdict cannot be indexed or filtered in SQL, so the customer-facing
-- "risky" sentiment filter still matched legacy rows whose accusation was never substantiated. Persisting
-- the projection into indexed columns lets the SQL predicate itself be gate-aware, which removes the
-- in-memory post-filter and keeps cursor pagination correct.
--
-- DEPLOY ORDER. This migration ships ALONE, before any code that reads these columns. Production has
-- previously suffered P2022 (code deployed ahead of its migration); this file therefore contains no
-- application coupling whatsoever.
--
-- UNPROJECTED SEMANTICS (enforced in application code, documented here). "Not yet projected" is carried
-- by the STATE and VERSION markers — never by the category array. Prisma does not support optional
-- scalar lists (`String[]?`), so `customerRiskCategories` is NOT NULL DEFAULT '{}' and an empty array is
-- simply "no confirmed categories". It says nothing on its own about whether the row was projected:
--   customerClassificationState             NULL / unknown -> review_required (fail closed)
--   customerClassificationProjectionVersion NULL or < current -> stale; re-project before trusting
--   customerRiskLevel                       NULL -> may never be presented as high/critical
--   customerRequiresReanalysis              NULL -> treated as requiring re-analysis
--   customerRiskCategories                  '{}' -> no CONFIRMED category; authority rests with state
--                                                   + version, so '{}' alone implies neither clean nor
--                                                   review_required
-- The two markers are authoritative together: a row is trusted only when state is a known value AND the
-- version is current. Every existing row gets '{}' from the DEFAULT with a NULL state and NULL version,
-- so it fails closed into review_required until the bounded backfill projects it.

-- ===========================================================================================================
-- 1) THE PERSISTED PROJECTION
-- ===========================================================================================================
ALTER TABLE "reputation_items"
  -- confirmed | review_required | no_issue. TEXT (not an enum) so a future projection state is an
  -- application change rather than a type migration + lock on a hot table.
  ADD COLUMN IF NOT EXISTS "customerClassificationState" TEXT,
  -- Safe-capped level a customer may see. Reuses the existing RiskLevel enum so it is directly
  -- comparable with, and indexable like, the raw `riskLevel`.
  ADD COLUMN IF NOT EXISTS "customerRiskLevel" "RiskLevel",
  -- CONFIRMED customer-visible categories only. NOT NULL with an empty-array default: Prisma has no
  -- optional scalar list, so NULL could never be the supported application representation of "never
  -- projected" — the state + version markers carry that instead. The constant DEFAULT is metadata-only
  -- in PostgreSQL 11+, so every existing row gets '{}' without a table rewrite and without a backfill.
  ADD COLUMN IF NOT EXISTS "customerRiskCategories" TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  -- Which version of the projection algorithm produced the row. Lets a later algorithm change
  -- invalidate stale projections without touching the raw verdict.
  ADD COLUMN IF NOT EXISTS "customerClassificationProjectionVersion" INTEGER,
  -- True when the stored verdict (and any Auto-Protect decision derived from it) can only be cleared
  -- by re-analysis rather than by re-interpretation.
  ADD COLUMN IF NOT EXISTS "customerRequiresReanalysis" BOOLEAN;

-- ===========================================================================================================
-- 2) INDEXES
-- ===========================================================================================================
-- Customer-facing state filtering (risky / requires-review facets), tenant-scoped.
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_customerClassificationState_idx"
  ON "reputation_items" ("tenantId", "customerClassificationState");

-- Customer-visible severity filtering and confirmed high/critical totals, tenant-scoped.
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_customerRiskLevel_idx"
  ON "reputation_items" ("tenantId", "customerRiskLevel");

-- Keyset pagination for a state-filtered inbox page: seek to the cursor and read in index order, with
-- cost independent of page depth — the same shape as the existing (tenantId, createdAt, id) index.
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_state_createdAt_id_idx"
  ON "reputation_items" ("tenantId", "customerClassificationState", "createdAt" DESC, "id" DESC);

-- Confirmed-category filtering. GIN is the correct access method for `text[]` containment/overlap
-- (`@>` / `&&`), which is how "has any of these confirmed categories" is expressed. The column is
-- NOT NULL, so every row is indexable and an empty array is a normal, searchable value.
CREATE INDEX IF NOT EXISTS "reputation_items_customerRiskCategories_gin_idx"
  ON "reputation_items" USING GIN ("customerRiskCategories");

-- Backfill cursor: find rows not yet on the current projection version, tenant-scoped, in id order.
CREATE INDEX IF NOT EXISTS "reputation_items_tenantId_projectionVersion_id_idx"
  ON "reputation_items" ("tenantId", "customerClassificationProjectionVersion", "id");

-- ===========================================================================================================
-- 3) PRIVILEGES
-- ===========================================================================================================
-- None required. 20260712010000_v1_37_2_rls granted SELECT/INSERT/UPDATE/DELETE on ALL TABLES IN SCHEMA
-- public to tamanor_app, and these are new columns on an already-granted table. Row-level security on
-- reputation_items is unchanged: the existing tenant_isolation policy continues to apply.
