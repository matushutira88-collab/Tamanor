-- V1.50D — Subscription Billing & Trial Conversion (ADDITIVE ONLY).
--
-- Adds tenant billing state + a Subscription table (safe Stripe identifiers only, never card data)
-- + a Stripe webhook idempotency/audit table. No existing row modified; no NOT NULL without a
-- default; nothing dropped.

-- 1) Tenant billing state (defaults keep trial-only tenants on full access).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billingStatus" TEXT NOT NULL DEFAULT 'no_subscription';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "accessState"   TEXT NOT NULL DEFAULT 'full_access';

-- 2) Subscription (one per tenant). Safe Stripe IDs + billing state only.
CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id"                   TEXT NOT NULL,
  "tenantId"             TEXT NOT NULL,
  "stripeCustomerId"     TEXT NOT NULL,
  "stripeSubscriptionId" TEXT,
  "stripePriceId"        TEXT,
  "plan"                 TEXT NOT NULL,
  "billingInterval"      TEXT,
  "status"               TEXT NOT NULL,
  "currentPeriodStart"   TIMESTAMP(3),
  "currentPeriodEnd"     TIMESTAMP(3),
  "cancelAtPeriodEnd"    BOOLEAN NOT NULL DEFAULT false,
  "canceledAt"           TIMESTAMP(3),
  "trialEndsAt"          TIMESTAMP(3),
  "latestInvoiceStatus"  TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_tenantId_key" ON "subscriptions"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripeCustomerId_key" ON "subscriptions"("stripeCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");
CREATE INDEX IF NOT EXISTS "subscriptions_stripeCustomerId_idx" ON "subscriptions"("stripeCustomerId");
DO $$ BEGIN
  ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Stripe webhook idempotency + bounded audit (no payment payload).
CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "id"            TEXT NOT NULL,
  "stripeEventId" TEXT NOT NULL,
  "eventType"     TEXT NOT NULL,
  "result"        TEXT NOT NULL,
  "processedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_webhook_events_stripeEventId_key" ON "stripe_webhook_events"("stripeEventId");
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_createdAt_idx" ON "stripe_webhook_events"("createdAt");
