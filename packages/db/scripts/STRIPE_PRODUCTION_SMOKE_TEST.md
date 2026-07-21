# Stripe Production Smoke Test — Operator Runbook (Release A / A5)

**Purpose.** Prove the *whole* billing lifecycle works against **live Stripe + production**, end to end,
before onboarding a first paying customer. Code paths are already unit/integration tested; this runbook
exercises the one thing tests cannot: a **real payment** flowing through live Stripe into production
entitlements.

**Who runs this.** A human operator with access to the live Stripe Dashboard, the production Vercel env,
and the production database URL. Claude Code **cannot** run this — it cannot create live payments and has
no Stripe credentials. Every step below is operator-driven.

**Read-only verifier.** After each step, confirm the resulting DB state with the bundled verifier (it only
reads — never writes):

```
pnpm --filter @guardora/db exec dotenv -e ../../.env -- tsx scripts/stripe-smoke-verify.ts --customer cus_XXXX
# or, once you know the tenant id:
pnpm --filter @guardora/db exec dotenv -e ../../.env -- tsx scripts/stripe-smoke-verify.ts --tenant <tenantId>
# with no argument it prints the secret-free config readiness only:
pnpm --filter @guardora/db exec dotenv -e ../../.env -- tsx scripts/stripe-smoke-verify.ts
```

> ⚠️ The command targets whatever `DATABASE_URL` your `.env` points at. For a production check that must be
> the production database. Use a **dedicated throwaway test tenant/customer** — never a real customer.

---

## 0. Pre-flight (no payment yet)

- [ ] `GET https://<prod-host>/api/ready` → billing components healthy
      (`stripe api`, `prices`, `webhook`, `portal`). This is `stripeBillingReadiness` (secret-free).
- [ ] Run the verifier with no target → `configured: true`, `duplicatePriceIds: false`, all 6 prices present.
- [ ] Stripe Dashboard is in **live mode**; the webhook endpoint `…/api/webhooks/stripe` is enabled and
      subscribed to: `checkout.session.completed`, `checkout.session.expired`,
      `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`.
- [ ] `STRIPE_SECRET_KEY` is `sk_live_…`; the 6 `STRIPE_PRICE_*` ids are live `price_…`; `STRIPE_WEBHOOK_SECRET`
      is the live `whsec_…`; `STRIPE_BILLING_PORTAL_RETURN_URL` is https.

## 1. Trial (baseline)

- [ ] Register a fresh test account. Verifier: `lifecycle=active_trial`, `plan=free_trial`,
      `billingStatus=no_subscription`, `trialDaysRemaining≈14`, `providerSync=true`.

## 2. Checkout → Payment → Webhook → Entitlement

- [ ] From `/dashboard/billing` start Checkout for **Starter (monthly)**. Complete payment with a real card
      (or a live-mode test card the account allows).
- [ ] Stripe Dashboard: a **Customer**, a **Subscription** (`active`), and an **Invoice** (`paid`) exist.
- [ ] Verifier (`--customer cus_…`):
  - [ ] `plan=starter`, `billingStatus=active`, `lifecycle=active_paid`, `effectiveAccess=full_access`.
  - [ ] `subscription`: correct `status`, `currentPeriodEnd` in the future, `stripeCustomerId` set.
  - [ ] `entitlements`: `maxBrands=1`, `maxConnectedAccounts=4` (Starter).
  - [ ] `webhook idempotency`: `processed ≥ 1`, `failed=0`.
  - [ ] `checkout attempts`: the attempt is `COMPLETED` (not stuck `CREATING`/`OPEN`).
  - [ ] `audit`: a `billing.subscription_activated` row.

## 3. Idempotency (replay safety)

- [ ] In the Stripe Dashboard, **Resend** the `checkout.session.completed` (or `invoice.paid`) event.
- [ ] Verifier: `webhook processed` count does **not** double-apply; plan/entitlement unchanged; no new
      subscription row. (The event id is the idempotency key; a replay is a no-op.)

## 4. Upgrade (Starter → Growth)

- [ ] Upgrade to **Growth** (Checkout or Customer Portal). Verifier: `plan=growth`,
      `maxBrands=3`, `maxConnectedAccounts=12`; `audit` shows the change.

## 5. Cancellation (cancel at period end)

- [ ] Cancel via the Customer Portal (cancel at period end).
- [ ] Verifier: `subscription.cancelAtPeriodEnd=true`, still `lifecycle=active_paid` (paid through the
      period), `effectiveAccess=full_access`. The Usage page shows **"Cancels on <date>"**.

## 6. End of billing period → access lapses

- [ ] Either wait for the period to end, or in Stripe test-clocks/live cancel-now to force
      `customer.subscription.deleted`.
- [ ] Verifier: `billingStatus=canceled`, and once the paid period has passed `lifecycle=canceled`,
      `effectiveAccess=restricted`, `providerSync=false`. Audit: `billing.subscription_canceled`.

## 7. Downgrade → limits enforced (keep oldest)

Pre-req: on Growth (step 4) connect enough accounts to exceed the lower plan (e.g. 5 monitored accounts).

- [ ] Downgrade Growth → Starter. On the `customer.subscription.updated` webhook the keep-oldest
      reconciliation runs (A2).
- [ ] Verifier: `plan=starter`, `monitoredAccounts ≤ 4`, and `audit` contains a
      `monitoring.limit_enforced` row. Confirm **no accounts were deleted or disconnected** (only
      `monitoringEnabled` flipped to false on the newest over-cap accounts). The Usage page shows
      **"N accounts have monitoring disabled by your plan limit."**

## 8. Payment failure path (optional but recommended)

- [ ] Force an `invoice.payment_failed` (a failing test card on renewal). Verifier: `billingStatus=past_due`,
      `lifecycle=past_due`, and within the grace window `effectiveAccess=grace_period` (access retained);
      after grace, `restricted`. Audit: `billing.payment_failed`.

---

## Pass / Fail

**PASS** only when every checked box holds AND, across the whole run:
`webhook failed = 0`, no checkout attempt is stuck in `CREATING`/`OPEN`, entitlements always match the plan,
and every state change left an audit row.

**FAIL** on any `webhook failed > 0` (Stripe is retrying → a DB write is erroring), a duplicated
subscription, an entitlement that does not match the plan, a downgrade that deleted/disconnected data,
or a replayed event that double-applied.

## Cleanup

- [ ] Cancel and delete the test subscription/customer in Stripe (live mode).
- [ ] Delete the test tenant via the normal in-app deletion flow (never a manual DB delete).

---

### What is NOT proven here (be honest)

- This runbook is **operator-pending**: as of this writing no live payment has been run in production
  (`0 subscriptions / 0 checkouts`). The code paths are tested; the **live money path is unverified until an
  operator completes this runbook**. Record the run date + result here when done.
- The verifier is read-only. It confirms DB state; it does not (and must not) create payments.
