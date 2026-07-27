-- Platform Admin & Privacy Analytics V1 — forward-only migration (hand-authored).
--
-- Additive only. Extends the existing V1.45A platform-admin authorization (User.platformRole) with the
-- operator tiers and admin-lifecycle metadata, and adds SYSTEM analytics/audit tables. The analytics tables
-- are platform-level (NOT tenant-scoped, like `leads`); ALL privileges are REVOKED from the RLS app role
-- tamanor_app (accessed only via the owner-role systemDb). They store ONLY anonymous, bounded, low-cardinality
-- signals — NO raw IP, precise geo, raw query string, raw referrer URL, long-term raw user-agent, form/message
-- content, email/name/phone, cookies/tokens, device fingerprints, advertising ids, arbitrary payload JSON, or
-- any Child Safety / tenant-private data. No accepted migration is edited; no GRANT is added; no RLS weakened.

-- 1. Platform operator tiers (additive enum values; existing none/staff/admin unchanged). Not used in this
--    migration's DEFAULTs, so ADD VALUE is transaction-safe on PostgreSQL 12+.
ALTER TYPE "PlatformRole" ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE "PlatformRole" ADD VALUE IF NOT EXISTS 'analyst';
ALTER TYPE "PlatformRole" ADD VALUE IF NOT EXISTS 'support';

-- 2. Admin-lifecycle metadata on users (all nullable/additive; existing rows keep NULL).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "platformAccessRevokedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "platformRoleUpdatedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "platformLastAccessAt" TIMESTAMP(3);

-- 3. Append-only platform-admin audit.
CREATE TABLE "platform_admin_audit_events" (
    "id"             TEXT NOT NULL,
    "actorUserId"    TEXT,
    "action"         TEXT NOT NULL,
    "targetUserId"   TEXT,
    "platformRole"   TEXT,
    "resultCode"     TEXT NOT NULL DEFAULT 'ok',
    "reportType"     TEXT,
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd"   TIMESTAMP(3),
    "summary"        TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_admin_audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_admin_audit_events_createdAt_idx" ON "platform_admin_audit_events" ("createdAt");
CREATE INDEX "platform_admin_audit_events_action_createdAt_idx" ON "platform_admin_audit_events" ("action", "createdAt");
CREATE INDEX "platform_admin_audit_events_actorUserId_createdAt_idx" ON "platform_admin_audit_events" ("actorUserId", "createdAt");

-- 4. Raw privacy-safe first-party analytics events (short retention).
CREATE TABLE "website_analytics_events" (
    "id"                     TEXT NOT NULL,
    "occurredAt"             TIMESTAMP(3) NOT NULL,
    "receivedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType"              TEXT NOT NULL,
    "normalizedPath"         TEXT NOT NULL DEFAULT '/',
    "referrerCategory"       TEXT NOT NULL DEFAULT 'UNKNOWN',
    "campaignSource"         TEXT,
    "campaignMedium"         TEXT,
    "campaignName"           TEXT,
    "deviceCategory"         TEXT NOT NULL DEFAULT 'UNKNOWN',
    "browserFamily"          TEXT NOT NULL DEFAULT 'Unknown',
    "operatingSystemFamily"  TEXT NOT NULL DEFAULT 'Unknown',
    "countryCode"            TEXT NOT NULL DEFAULT 'UNKNOWN',
    "language"               TEXT NOT NULL DEFAULT 'und',
    "sessionIdHash"          TEXT NOT NULL,
    "visitorIdHash"          TEXT NOT NULL,
    "authenticatedUserState" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "tenantState"            TEXT NOT NULL DEFAULT 'UNKNOWN',
    "conversionContext"      TEXT NOT NULL DEFAULT 'NONE',
    "botClassification"      TEXT NOT NULL DEFAULT 'UNKNOWN',
    "pageLoadCategory"       TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "website_analytics_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "website_analytics_events_occurredAt_idx" ON "website_analytics_events" ("occurredAt");
CREATE INDEX "website_analytics_events_eventType_occurredAt_idx" ON "website_analytics_events" ("eventType", "occurredAt");
CREATE INDEX "website_analytics_events_normalizedPath_occurredAt_idx" ON "website_analytics_events" ("normalizedPath", "occurredAt");
CREATE INDEX "website_analytics_events_sessionIdHash_idx" ON "website_analytics_events" ("sessionIdHash");
CREATE INDEX "website_analytics_events_botClassification_occurredAt_idx" ON "website_analytics_events" ("botClassification", "occurredAt");

-- 5. Daily aggregates (longer retention). Unique on the full dimension tuple (upsert-idempotent).
CREATE TABLE "website_analytics_daily_aggregates" (
    "id"                        TEXT NOT NULL,
    "date"                      TIMESTAMP(3) NOT NULL,
    "normalizedPath"            TEXT NOT NULL,
    "eventType"                 TEXT NOT NULL,
    "referrerCategory"          TEXT NOT NULL,
    "campaignSource"            TEXT NOT NULL DEFAULT '',
    "deviceCategory"            TEXT NOT NULL,
    "browserFamily"             TEXT NOT NULL,
    "operatingSystemFamily"     TEXT NOT NULL,
    "countryCode"               TEXT NOT NULL,
    "language"                  TEXT NOT NULL,
    "authenticatedUserState"    TEXT NOT NULL,
    "botClassification"         TEXT NOT NULL,
    "pageViews"                 INTEGER NOT NULL DEFAULT 0,
    "sessions"                  INTEGER NOT NULL DEFAULT 0,
    "approximateUniqueVisitors" INTEGER NOT NULL DEFAULT 0,
    "conversions"               INTEGER NOT NULL DEFAULT 0,
    "bounces"                   INTEGER NOT NULL DEFAULT 0,
    "engagedSessions"           INTEGER NOT NULL DEFAULT 0,
    "errorPageViews"            INTEGER NOT NULL DEFAULT 0,
    "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                 TIMESTAMP(3) NOT NULL,
    CONSTRAINT "website_analytics_daily_aggregates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "analytics_daily_dim" ON "website_analytics_daily_aggregates" ("date", "normalizedPath", "eventType", "referrerCategory", "campaignSource", "deviceCategory", "browserFamily", "operatingSystemFamily", "countryCode", "language", "authenticatedUserState", "botClassification");
CREATE INDEX "website_analytics_daily_aggregates_date_idx" ON "website_analytics_daily_aggregates" ("date");
CREATE INDEX "website_analytics_daily_aggregates_eventType_date_idx" ON "website_analytics_daily_aggregates" ("eventType", "date");
CREATE INDEX "website_analytics_daily_aggregates_normalizedPath_date_idx" ON "website_analytics_daily_aggregates" ("normalizedPath", "date");

-- 6. Server-conversion idempotency guard.
CREATE TABLE "website_analytics_conversion_idempotency" (
    "id"             TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventType"      TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "website_analytics_conversion_idempotency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "website_analytics_conversion_idempotency_idempotencyKey_key" ON "website_analytics_conversion_idempotency" ("idempotencyKey");
CREATE INDEX "website_analytics_conversion_idempotency_createdAt_idx" ON "website_analytics_conversion_idempotency" ("createdAt");

-- 7. Auditable retention/aggregation run records.
CREATE TABLE "website_analytics_retention_runs" (
    "id"                 TEXT NOT NULL,
    "runType"            TEXT NOT NULL,
    "status"             TEXT NOT NULL DEFAULT 'completed',
    "rawEventsDeleted"   INTEGER NOT NULL DEFAULT 0,
    "aggregatesUpserted" INTEGER NOT NULL DEFAULT 0,
    "windowStart"        TIMESTAMP(3),
    "windowEnd"          TIMESTAMP(3),
    "startedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"        TIMESTAMP(3),
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "website_analytics_retention_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "website_analytics_retention_runs_runType_createdAt_idx" ON "website_analytics_retention_runs" ("runType", "createdAt");

-- SYSTEM tables — the RLS-enforcing app role must have NO access (platform-level, like `leads`).
REVOKE ALL PRIVILEGES ON TABLE "platform_admin_audit_events" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "website_analytics_events" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "website_analytics_daily_aggregates" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "website_analytics_conversion_idempotency" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "website_analytics_retention_runs" FROM tamanor_app;
