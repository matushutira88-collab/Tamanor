-- V1.50B — Production Authentication & Social Login (ADDITIVE ONLY).
--
-- Adds the external-identity link table for USER login (Google/Facebook), entirely
-- separate from the Meta Page connector, plus a nullable onboarding-state column on
-- tenants. No existing row is modified; no NOT NULL is introduced; nothing is dropped.

-- 1) External login identities. One user ↔ many providers; each external identity is unique.
CREATE TABLE IF NOT EXISTS "oauth_accounts" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "provider"          TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_accounts_provider_providerAccountId_key" ON "oauth_accounts"("provider", "providerAccountId");
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_accounts_userId_provider_key" ON "oauth_accounts"("userId", "provider");
CREATE INDEX IF NOT EXISTS "oauth_accounts_userId_idx" ON "oauth_accounts"("userId");
DO $$ BEGIN
  ALTER TABLE "oauth_accounts"
    ADD CONSTRAINT "oauth_accounts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Onboarding state on the tenant (NULL = pending).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);
