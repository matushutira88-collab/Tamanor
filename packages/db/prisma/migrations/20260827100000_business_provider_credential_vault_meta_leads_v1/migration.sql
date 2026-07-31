-- BUSINESS-VAULT-V1 — Secure Provider Credential Vault + narrow Meta lead-account link.
-- Additive, forward-only, idempotent (IF NOT EXISTS everywhere). NO destructive drops. NO token nulling here
-- (the legacy ConnectedAccount token columns are UNTOUCHED; a separate dry-run backfill CLI handles cutover).
-- Sorts strictly after 20260827090000_family_notification_scheduler.
--
-- 1) provider_credentials — envelope-encrypted provider tokens. OWNER/systemDb ONLY: REVOKE ALL from the app
--    role so the ordinary UI/app (tamanor_app) gets permission-denied. RLS is ALSO enabled+forced with the
--    strict fail-closed policy (defence-in-depth: even a future accidental GRANT stays tenant-isolated).
-- 2) business_platform_connections.connectedAccountId — the narrow, same-tenant, provider=meta link to the
--    existing Meta moderation ConnectedAccount (guarded by a trigger + partial unique index).

-- ===========================================================================================================
-- 1) PROVIDER CREDENTIAL VAULT (owner-only)
-- ===========================================================================================================
DO $enum$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProviderCredentialPurpose') THEN
    CREATE TYPE "ProviderCredentialPurpose" AS ENUM ('access_token', 'long_lived_token', 'refresh_token');
  END IF;
END $enum$;

CREATE TABLE IF NOT EXISTS "provider_credentials" (
  "id"                   TEXT NOT NULL,
  "tenantId"             TEXT NOT NULL,
  "provider"             "BusinessProvider" NOT NULL,
  "purpose"              "ProviderCredentialPurpose" NOT NULL,
  "connectedAccountId"   TEXT,
  "businessConnectionId" TEXT,
  "ciphertext"           TEXT NOT NULL,
  "iv"                   TEXT NOT NULL,
  "authTag"              TEXT NOT NULL,
  "wrappedDataKey"       TEXT NOT NULL,
  "keyProvider"          TEXT NOT NULL,
  "keyVersion"           TEXT NOT NULL,
  "formatVersion"        TEXT NOT NULL,
  "tokenType"            TEXT,
  "expiresAt"            TIMESTAMP(3),
  "scopes"               TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "fingerprint"          TEXT NOT NULL,
  "rotatedAt"            TIMESTAMP(3),
  "revokedAt"            TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "provider_credentials_tenantId_provider_purpose_idx"
  ON "provider_credentials" ("tenantId", "provider", "purpose");
CREATE INDEX IF NOT EXISTS "provider_credentials_connectedAccountId_idx"
  ON "provider_credentials" ("connectedAccountId");
CREATE INDEX IF NOT EXISTS "provider_credentials_businessConnectionId_idx"
  ON "provider_credentials" ("businessConnectionId");

-- At most ONE active (non-revoked) credential per (tenant, provider, connection, purpose). Revoked history rows
-- may coexist. Two partial unique indexes: one per connection kind (exactly one of the two ids is set per row).
CREATE UNIQUE INDEX IF NOT EXISTS "provider_credentials_active_connected_account_uq"
  ON "provider_credentials" ("tenantId", "provider", "connectedAccountId", "purpose")
  WHERE "revokedAt" IS NULL AND "connectedAccountId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "provider_credentials_active_business_connection_uq"
  ON "provider_credentials" ("tenantId", "provider", "businessConnectionId", "purpose")
  WHERE "revokedAt" IS NULL AND "businessConnectionId" IS NOT NULL;

-- FK constraints (all ON DELETE CASCADE) — declared in raw SQL (the model has no Prisma relations by design).
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_credentials_tenantId_fkey') THEN
    ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_credentials_connectedAccountId_fkey') THEN
    ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_connectedAccountId_fkey"
      FOREIGN KEY ("connectedAccountId") REFERENCES "connected_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_credentials_businessConnectionId_fkey') THEN
    ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_businessConnectionId_fkey"
      FOREIGN KEY ("businessConnectionId") REFERENCES "business_platform_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- Exactly-one-connection CHECK: a credential binds to a connected account XOR a business connection.
DO $ck$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_credentials_one_connection_ck') THEN
    ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_one_connection_ck"
      CHECK (("connectedAccountId" IS NOT NULL)::int + ("businessConnectionId" IS NOT NULL)::int = 1);
  END IF;
END $ck$;

-- OWNER-ONLY: the RLS app role gets NO privileges (undo the blanket default GRANT).
REVOKE ALL PRIVILEGES ON TABLE "provider_credentials" FROM tamanor_app;

-- Defence-in-depth RLS: enabled + FORCED, strict fail-closed policy (no IS NULL bootstrap branch). The owner
-- (systemDb, BYPASSRLS) still reaches rows; the policy only ever matters if a future GRANT is added by mistake.
ALTER TABLE "provider_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_credentials" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "provider_credentials";
CREATE POLICY "tenant_isolation" ON "provider_credentials"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());

-- ===========================================================================================================
-- 2) NARROW MetaConnectedAccount <-> BusinessPlatformConnection LINK
-- ===========================================================================================================
ALTER TABLE "business_platform_connections" ADD COLUMN IF NOT EXISTS "connectedAccountId" TEXT;
CREATE INDEX IF NOT EXISTS "business_platform_connections_connectedAccountId_idx"
  ON "business_platform_connections" ("connectedAccountId");

-- A ConnectedAccount is linked by AT MOST ONE BusinessPlatformConnection.
CREATE UNIQUE INDEX IF NOT EXISTS "business_platform_connections_connectedAccountId_uq"
  ON "business_platform_connections" ("connectedAccountId")
  WHERE "connectedAccountId" IS NOT NULL;

-- FK ON DELETE SET NULL — the business connection survives a moderation account removal (link just clears).
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_platform_connections_connectedAccountId_fkey') THEN
    ALTER TABLE "business_platform_connections" ADD CONSTRAINT "business_platform_connections_connectedAccountId_fkey"
      FOREIGN KEY ("connectedAccountId") REFERENCES "connected_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;

-- Same-tenant + provider=meta guard (checks stored tenantId, not RLS visibility → protects runtime AND owner).
-- Fires only when connectedAccountId is non-null, so a SetNull on delete never trips it.
CREATE OR REPLACE FUNCTION assert_business_connection_account_link() RETURNS trigger AS $$
BEGIN
  IF NEW."connectedAccountId" IS NOT NULL THEN
    IF NEW."provider" <> 'meta' THEN
      RAISE EXCEPTION 'business_connection_account_link_requires_meta' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "connected_accounts" a
      WHERE a."id" = NEW."connectedAccountId" AND a."tenantId" = NEW."tenantId") THEN
      RAISE EXCEPTION 'cross_tenant_or_missing_connected_account' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_business_connection_account_link ON "business_platform_connections";
CREATE TRIGGER trg_business_connection_account_link BEFORE INSERT OR UPDATE ON "business_platform_connections"
  FOR EACH ROW EXECUTE FUNCTION assert_business_connection_account_link();
