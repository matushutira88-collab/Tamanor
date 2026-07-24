-- FAMILY-BILLING S3A — Family baseline-plan reconciliation + one-time-trial foundation.
--
-- Two MINIMAL changes; Business is completely untouched:
--
--  1. Add the AUTHORITATIVE one-time Family-trial marker `familyTrialConsumedAt` (nullable).
--     null = the introductory Family trial has never been consumed; non-null = already consumed.
--     Family-only authority. Never derived from trialStartsAt/trialEndsAt (which the legacy
--     Business-style registration set for every workspace and are NOT proof of eligibility).
--     Additive nullable column → no default, no backfill, no impact on any existing row.
--
--  2. Reconcile ONLY Family tenants still on the legacy Family-registration baseline
--     (workspaceKind = 'family' AND plan = 'free_trial') to the Family Free baseline:
--       plan          → 'family_free'
--       accessState   → 'full_access'
--       trialStartsAt → NULL   (clear the legacy Business-style trial)
--       trialEndsAt   → NULL
--     familyTrialConsumedAt stays NULL — the legacy auto-trial does NOT count as a consumed Family
--     trial, so these users remain eligible for the future explicit Family trial.
--
--     The predicate is constrained to workspaceKind='family' AND plan='free_trial', so:
--       • Business tenants (workspaceKind <> 'family') are NEVER touched.
--       • Paid Family tenants (family_plus/family_premium) and already-family_free Family tenants
--         are NEVER touched (they are not on 'free_trial').
--       • It is idempotent: a second run matches zero rows (those tenants are now 'family_free').
--     No subscription, Stripe-customer mapping, or Family domain data (profiles / guardians /
--     memberships / invitations / signals / evidence / incidents / deliveries / audit / consent) is
--     read or modified by this migration.

-- (1) authoritative one-time Family-trial marker
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "familyTrialConsumedAt" TIMESTAMP(3);

-- (2) reconcile the legacy Family baseline (free_trial → family_free), Family-only, idempotent
UPDATE "tenants"
   SET "plan"          = 'family_free',
       "accessState"   = 'full_access',
       "trialStartsAt" = NULL,
       "trialEndsAt"   = NULL
 WHERE "workspaceKind" = 'family'
   AND "plan"          = 'free_trial';
