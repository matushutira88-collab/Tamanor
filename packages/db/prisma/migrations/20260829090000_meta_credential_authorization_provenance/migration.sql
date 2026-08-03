-- META-EXTERNAL-ACCESS-V2 — credential authorization provenance.
-- Additive, forward-only, idempotent (IF NOT EXISTS). NO drops, NO backfill, NO data change: existing rows
-- keep NULL, which every consumer reads as "not attributable to any Meta identity" and therefore NEVER
-- invalidates. Sorts strictly after 20260828090000_business_meta_leadgen_page_subscription.
--
-- WHY: Meta's deauthorize and data-deletion callbacks identify the requester only by an app-scoped user id.
-- Nothing in the schema previously recorded WHICH Meta identity's grant produced the credential stored for a
-- Facebook Page or Instagram account, so a person could remove Tamanor from Facebook while Tamanor kept a
-- usable Page credential and continued comment sync, moderation and lead fetching. These columns record that
-- provenance so the callbacks can invalidate exactly the credentials that grant produced — and nothing else.
--
-- CONTENT: an opaque provider subject id only. No token, no ciphertext, no PII. Written server-side on every
-- credential store/rotate, so a reconnect by a different authorised person replaces it.

ALTER TABLE "provider_credentials"
  ADD COLUMN IF NOT EXISTS "authorizingProviderUserId" TEXT;

ALTER TABLE "meta_onboarding_sessions"
  ADD COLUMN IF NOT EXISTS "authorizingProviderUserId" TEXT;

-- Callback lookup path: every active credential currently authorised by one provider identity.
CREATE INDEX IF NOT EXISTS "provider_credentials_provider_authorizingProviderUserId_idx"
  ON "provider_credentials" ("provider", "authorizingProviderUserId");
