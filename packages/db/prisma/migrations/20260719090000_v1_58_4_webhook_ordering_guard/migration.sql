-- V1.58.4 — out-of-order Stripe webhook guard (ADDITIVE, backward-compatible).
--
-- Records, per subscription aggregate, the `created` time + terminality of the last APPLIED Stripe
-- billing event, so a delayed/retried OLDER event can never overwrite newer billing state (e.g. a
-- late customer.subscription.updated=active must not resurrect access after a customer.subscription.
-- deleted). Nullable / safe-default columns → existing rows are untouched and the FIRST real event
-- applies normally. No data reset. RLS on `subscriptions` (ENABLE+FORCE + tenant_isolation) already
-- covers new columns; tamanor_app grants are table-level and inherit. No new index needed — the guard
-- filters by tenantId, which is already uniquely indexed.

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "lastStripeEventAt" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "lastStripeEventTerminal" BOOLEAN NOT NULL DEFAULT false;
