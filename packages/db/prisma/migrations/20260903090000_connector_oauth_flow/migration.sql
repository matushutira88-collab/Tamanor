-- CONNECTOR OAUTH FLOW — the durable, provider-neutral OAuth authorization transaction.
--
-- Additive, forward-only, idempotent (IF NOT EXISTS / guarded DO blocks). NO destructive statement,
-- NO backfill, NO change to any existing column or policy. Sorts strictly after
-- 20260902090000_single_item_reanalysis_foundation.
--
-- DEPLOY ORDER. This migration ships ALONE, before any code that knows the table. Production has
-- previously suffered P2022 from the reverse order, so this file contains no application coupling.
--
-- ===========================================================================================================
-- WHY THIS TABLE HAS TO EXIST
-- ===========================================================================================================
-- An OAuth callback arrives carrying NOTHING but the provider's `code` and `state`. No cookie, no bearer.
-- Until now that was survivable because every connector flow began in a logged-in browser, so the callback
-- could re-read `tamanor_session` and recover the actor. A flow that begins on a PHONE has no such cookie,
-- and every way of manufacturing one — the bearer in the URL, the bearer in the OAuth state, or minting a
-- browser login — leaks a credential. This row is the correlation instead: the callback hashes the state it
-- received, finds exactly this row, and recovers the user/tenant/session that started the authorization.
--
-- Replay protection cannot be stateless. A signed token proves authenticity and expiry but never FIRST USE:
-- nothing about it changes when it is redeemed, so a captured state could be replayed until it expired.
-- `stateHash UNIQUE` plus a guarded `stateConsumedAt` update is what makes a second callback fail. Process
-- memory cannot do this job either — apps/web runs serverless, so a Map written by one instance is simply
-- absent in the next, and "already consumed" would become per-instance, i.e. bypassable by retrying.
--
-- WHAT IT DELIBERATELY CANNOT HOLD: a bearer, a session token, a provider authorization code, a provider
-- access or refresh token, or a client secret. There is no column for any of them. Only sha256(oauthState)
-- is stored, exactly as user_sessions / password_reset_tokens store only a hash. Provider credentials
-- continue to live in the existing encrypted vault and meta_onboarding_sessions; `resultRefId` points at
-- that canonical record rather than duplicating it.

-- ===========================================================================================================
-- 1) TABLE
-- ===========================================================================================================
CREATE TABLE IF NOT EXISTS "connector_oauth_flows" (
  "id"              TEXT NOT NULL,

  "userId"          TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  -- The originating UserSession. Storing the ID (never the token) is what lets a logout fail a
  -- pending authorization closed: the row cascades away with the session.
  "sessionId"       TEXT NOT NULL,

  -- Bounded in application code: surface web|mobile, provider meta|google_business,
  -- intent connect|reconnect. Kept as TEXT rather than enums so adding a provider is a code
  -- change, not a migration — the vocabularies are asserted by the test suite.
  "surface"         TEXT NOT NULL,
  "provider"        TEXT NOT NULL,
  "intent"          TEXT NOT NULL,

  "brandId"         TEXT,
  "accountId"       TEXT,

  -- sha256(oauthState), hex. The UNIQUE index below IS the replay guard.
  "stateHash"       TEXT NOT NULL,

  "status"          TEXT NOT NULL DEFAULT 'pending',
  -- Bounded failure/result code only. A raw provider message must never land here.
  "resultCode"      TEXT,
  "resultAccountId" TEXT,
  -- A canonical follow-up record (e.g. meta_onboarding_sessions.id) — never a credential.
  "resultRefId"     TEXT,

  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  -- Set by the ATOMIC one-time consume; a second callback finds it non-null and is rejected.
  "stateConsumedAt" TIMESTAMP(3),
  "completedAt"     TIMESTAMP(3),

  CONSTRAINT "connector_oauth_flows_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================================================
-- 2) INDEXES
-- ===========================================================================================================
-- The replay guard. A UNIQUE index (not merely an index) so a duplicate state cannot be inserted at all.
CREATE UNIQUE INDEX IF NOT EXISTS "connector_oauth_flows_stateHash_key"
  ON "connector_oauth_flows"("stateHash");
-- Status reads are always scoped to one tenant + user.
CREATE INDEX IF NOT EXISTS "connector_oauth_flows_tenantId_userId_idx"
  ON "connector_oauth_flows"("tenantId", "userId");
-- The TTL sweep in the existing maintenance tick.
CREATE INDEX IF NOT EXISTS "connector_oauth_flows_expiresAt_idx"
  ON "connector_oauth_flows"("expiresAt");

-- ===========================================================================================================
-- 3) FOREIGN KEYS
-- ===========================================================================================================
-- All three CASCADE: deleting a tenant, a user, or revoking-and-purging a session must not leave a
-- danglingly-authorized OAuth transaction behind.
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connector_oauth_flows_tenantId_fkey') THEN
    ALTER TABLE "connector_oauth_flows"
      ADD CONSTRAINT "connector_oauth_flows_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connector_oauth_flows_userId_fkey') THEN
    ALTER TABLE "connector_oauth_flows"
      ADD CONSTRAINT "connector_oauth_flows_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connector_oauth_flows_sessionId_fkey') THEN
    ALTER TABLE "connector_oauth_flows"
      ADD CONSTRAINT "connector_oauth_flows_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- ===========================================================================================================
-- 4) ROW LEVEL SECURITY
-- ===========================================================================================================
-- Tenant isolation, the same fail-closed policy as every other tenant table. Note what this does NOT
-- cover: the provider callback must find the flow BEFORE any tenant identity is known, so that ONE lookup
-- runs through the owner role via a single narrow repository function (consumeConnectorOAuthState), which
-- may only match by stateHash and atomically consume. Every read and write after the tenant is resolved
-- goes back through the normal tenant client and is subject to this policy.
ALTER TABLE "connector_oauth_flows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connector_oauth_flows" FORCE ROW LEVEL SECURITY;
DO $pol$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'connector_oauth_flows' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "connector_oauth_flows"
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id());
  END IF;
END $pol$;

-- ===========================================================================================================
-- 5) PRIVILEGES
-- ===========================================================================================================
-- A flow is created, updated (status/result), read and swept, so the app role needs the full set.
-- 20260712010000_v1_37_2_rls granted these on ALL TABLES IN SCHEMA public at the time; this table is
-- new, so the grant is restated explicitly rather than assumed.
GRANT SELECT, INSERT, UPDATE, DELETE ON "connector_oauth_flows" TO tamanor_app;
