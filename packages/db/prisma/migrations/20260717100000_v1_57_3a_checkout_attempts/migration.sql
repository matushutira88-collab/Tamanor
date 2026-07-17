-- V1.57.3A — durable, tenant-scoped Stripe Checkout reservation (ADDITIVE ONLY).
--
-- Closes the checkout concurrency gap the V1.57.3 advisory-lock-only guard left open: the lock was
-- released before the Stripe network call, so two concurrent requests for DIFFERENT plans could each
-- create a Checkout Session (their price-specific idempotency keys differed). This table is a durable
-- reservation that exists BEFORE the Stripe call and stays authoritative until the attempt
-- completes/expires/fails. A DB-ENFORCED partial unique index guarantees AT MOST ONE live attempt
-- (status CREATING|OPEN) per tenant — regardless of plan or interval — so the guarantee no longer
-- depends on application code holding a lock across a network call. Nothing existing is modified.
--
-- Entitlement is NEVER granted from this table; the `subscriptions` row remains the source of truth.
-- This is concurrency + workflow state only.

CREATE TABLE IF NOT EXISTS "stripe_checkout_attempts" (
  "id"                         TEXT NOT NULL,
  "tenantId"                   TEXT NOT NULL,
  "status"                     TEXT NOT NULL,
  "requestedPlan"              TEXT NOT NULL,
  "requestedInterval"          TEXT NOT NULL,
  "stripePriceId"              TEXT NOT NULL,
  "stripeCheckoutSessionId"    TEXT,
  "stripeCheckoutUrl"          TEXT,
  "stripeCheckoutUrlExpiresAt" TIMESTAMP(3),
  "idempotencyKey"             TEXT NOT NULL,
  "createdByUserId"            TEXT,
  "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                  TIMESTAMP(3) NOT NULL,
  "expiresAt"                  TIMESTAMP(3) NOT NULL,
  "completedAt"                TIMESTAMP(3),
  "failedAt"                   TIMESTAMP(3),
  "failureCode"                TEXT,
  CONSTRAINT "stripe_checkout_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stripe_checkout_attempts_stripeCheckoutSessionId_key"
  ON "stripe_checkout_attempts"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_checkout_attempts_idempotencyKey_key"
  ON "stripe_checkout_attempts"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "stripe_checkout_attempts_tenantId_status_idx"
  ON "stripe_checkout_attempts"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "stripe_checkout_attempts_expiresAt_idx"
  ON "stripe_checkout_attempts"("expiresAt");

-- The core guarantee: AT MOST ONE live (CREATING|OPEN) attempt per tenant. A concurrent second
-- reservation for the same tenant — even for a different plan — cannot INSERT a second live row; the
-- unique index rejects it at the database level. Prisma cannot express a partial unique index, so it
-- is created here in raw SQL (and documented on the model).
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_checkout_attempts_one_live_per_tenant"
  ON "stripe_checkout_attempts"("tenantId")
  WHERE "status" IN ('CREATING', 'OPEN');

DO $$ BEGIN
  ALTER TABLE "stripe_checkout_attempts" ADD CONSTRAINT "stripe_checkout_attempts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Row-level security — same defense-in-depth posture as `subscriptions` (V1.51). The owner client
-- (systemDb, no tenant context) drives every reservation/webhook write and is permitted by the
-- `IS NULL` branch; any context-bearing query through the restricted `tamanor_app` runtime role is
-- confined to its own tenant. current_app_tenant_id() is created in the v1_37_2 RLS migration.
ALTER TABLE "stripe_checkout_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stripe_checkout_attempts" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "stripe_checkout_attempts";
CREATE POLICY tenant_isolation ON "stripe_checkout_attempts"
  USING (current_app_tenant_id() IS NULL OR "tenantId" = current_app_tenant_id())
  WITH CHECK (current_app_tenant_id() IS NULL OR "tenantId" = current_app_tenant_id());

-- Explicit runtime grant (mirrors the other tenant tables; the v1_37_2 default privileges also cover
-- future tables, but grant explicitly so the posture is self-evident). Guarded on the role existing.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tamanor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "stripe_checkout_attempts" TO tamanor_app;
  END IF;
END $$;
