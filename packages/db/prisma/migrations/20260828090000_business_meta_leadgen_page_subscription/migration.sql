-- BUSINESS-LEADGEN-SUBSCRIPTION-V1 — truthful Page-level `leadgen` webhook subscription state.
-- Additive, forward-only, idempotent (IF NOT EXISTS). NO drops, NO backfill, NO data change: every existing
-- row keeps NULL, which the capability evaluator reads as "not verified" (fail-closed — a Page is never
-- assumed subscribed). Sorts strictly after 20260827100000_business_provider_credential_vault_meta_leads_v1.
--
-- A Meta app subscribed to the `leadgen` webhook topic still receives nothing for a Page until that Page is
-- subscribed to the app via /{page-id}/subscribed_apps. These two columns record the last verified result of
-- that check so the UI can state the truth instead of claiming Lead Ads is active.
--
-- leadgenSubscriptionStatus: verified | not_subscribed | unavailable  (NULL = never checked)
-- Holds NO secret — a status label plus the time the check ran.

ALTER TABLE "connected_accounts"
  ADD COLUMN IF NOT EXISTS "leadgenSubscriptionStatus"    TEXT,
  ADD COLUMN IF NOT EXISTS "leadgenSubscriptionCheckedAt" TIMESTAMP(3);
