-- V1.60 — plan model integrity. The column default was the phantom "free" (not a BillingPlanId; it
-- resolved to MINIMAL / lockout). Make free_trial the safe default and backfill any existing "free"
-- tenants to free_trial. This ONLY normalizes the plan string — it does NOT touch trialStartsAt /
-- trialEndsAt / billingStatus / accessState, so no existing tenant gets a fresh trial and each keeps
-- its real access state (governed by resolveAccessState from its unchanged billing/trial dates).
-- Idempotent: re-running changes nothing once no "free" rows remain. pro/dev are left untouched (they
-- are legacy/seed values that can never arrive via checkout or webhook — planForStripePriceId maps only
-- starter/growth/agency).
ALTER TABLE "tenants" ALTER COLUMN "plan" SET DEFAULT 'free_trial';
UPDATE "tenants" SET "plan" = 'free_trial' WHERE "plan" = 'free';
