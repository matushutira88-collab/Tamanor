# Family Billing — Production Activation Runbook

This is the **secure operator path** for activating Family billing in production. It exists because
Claude Code / automation cannot (and must not) hold the production database credential. Every step
below is performed by an **authorized human operator**. Nothing here is automatic.

> **Current status:** Family billing code, catalogue, pricing UI and entitlement ladder are complete
> and deployed. `FAMILY_BILLING_ENABLED` is **OFF** in production. The reconcile migration is **not**
> applied. No Stripe products/prices exist. Do not change any of that except by following this runbook.

The activation prerequisites, in order:

1. Apply the accepted reconcile migration to production (via the GitHub workflow below).
2. Create the Stripe products + six prices; add the six Price IDs as Vercel **Sensitive** production vars.
3. Pass the readiness validator in `activation` mode.
4. Flip `FAMILY_BILLING_ENABLED=true` and redeploy.
5. Run the single controlled smoke test.

---

## 1. One-time setup

### 1.1 GitHub `production` Environment
Create a repository **Environment** named `production` (Settings → Environments). Configure:
- **Required reviewers** — at least one authorized operator must approve each run.
- Optional: a wait timer and a branch restriction to `main`.

The migration job declares `environment: production`, so it pauses for that approval before any step runs.

### 1.2 Required secret — `PRODUCTION_DATABASE_URL`
Add the production Postgres connection string as an Environment secret named **`PRODUCTION_DATABASE_URL`**
on the `production` Environment. It is injected only as `DATABASE_URL` inside the job and is **never**
printed, echoed, or written to an artifact.

### 1.3 Optional (recommended) secret — `PRODUCTION_DATABASE_HOST_FINGERPRINT`
A tamper-check that pins the target database host without storing the host in plaintext. Compute it
locally from the real production URL (this prints only a 16-char hash, never the URL):

```bash
DATABASE_URL='postgres://…the real production url…' \
  pnpm --filter @guardora/db exec tsx -e \
  "import('./scripts/family-activation.ts').then(m => console.log(m.databaseHostFingerprint(process.env.DATABASE_URL)))"
```

Store the printed value as Environment secret **`PRODUCTION_DATABASE_HOST_FINGERPRINT`**. When present,
the workflow refuses to run unless the target host's fingerprint matches. (If absent, the fingerprint
check is skipped; the localhost/loopback refusal still applies.)

---

## 2. Apply the production migration

Trigger **Actions → `production-database-migrate` → Run workflow** (`workflow_dispatch` only) with:

| Input | Value |
|---|---|
| `environment` | `production` (only accepted value) |
| `expected_migration` | `20260812090000_family_billing_baseline_reconcile` |
| `confirmation` | `APPLY_ACCEPTED_PRODUCTION_MIGRATIONS` (exact) |
| `max_legacy_family_tenants` | `100` (default; raise only with intent) |

The job then, in order: refuses any non-`main` ref → validates the three inputs → asserts the target is
production (not localhost, fingerprint match) with read-only connectivity + schema markers → runs the
**pre-migration** read-only checks → applies **`prisma migrate deploy`** (the only migration command) →
runs **post-migration** verification. It prints a redacted JSON summary to the job summary — counts and
migration names only, never credentials.

### 2.1 Interpreting the preflight counts
The preflight prints: pending migrations, tenant groups (workspaceKind × plan × accessState), the exact
`family AND free_trial` count, Family plan counts (`family_free`/`family_basic`/`family_plus`/
`family_premium`), Business plan counts, and domain-data counts (protected profiles, guardian
relationships, invitations, memberships, safety signals, subscriptions, Stripe customer mappings).

Expect the `family/free_trial` legacy count to be small (legacy auto-trial Family workspaces). Review it
before approving.

### 2.2 Hard-stop conditions (the job fails and applies nothing)
- The accepted migration is **not** the only pending migration.
- The `family/free_trial` count exceeds `max_legacy_family_tenants`.
- The database host is local/loopback, or the fingerprint does not match.
- Required schema markers (`tenants`, `_prisma_migrations`) are missing, or any query fails.
- Any arming input is wrong.

### 2.3 Post-migration verification (must all pass, else the job fails)
Migration recorded applied · zero `family/free_trial` remain · reconciled rows are `family_free` /
`full_access` with **cleared** trial dates · `familyTrialConsumedAt` exists and is **null** for
reconciled rows · Business plan counts unchanged · every Family domain-data / subscription / Stripe
mapping count unchanged. The workflow does **not** auto-roll-back; a failure is surfaced for an operator.

---

## 3. Stripe products and prices (manual, by an authorized Stripe operator)

Create the products and **recurring** prices in the production Stripe account. These are the approved
figures — do not guess:

| Public plan | Internal id | Monthly | Yearly (~2 months free) |
|---|---|---|---|
| Family | `family_basic` | **€7.99** | **€79.90** |
| Family Plus | `family_plus` | **€14.99** | **€149.90** |
| Family Pro | `family_premium` | **€24.99** | **€249.90** |
| Custom | — | contact only (no Stripe price) | — |

`family_free` is never sold and has no Stripe price.

Add the resulting Price IDs as **Vercel Sensitive** production environment variables (exactly these six
names — values never go in source control):

```
STRIPE_FAMILY_BASIC_MONTHLY_PRICE_ID
STRIPE_FAMILY_BASIC_YEARLY_PRICE_ID
STRIPE_FAMILY_PLUS_MONTHLY_PRICE_ID
STRIPE_FAMILY_PLUS_YEARLY_PRICE_ID
STRIPE_FAMILY_PREMIUM_MONTHLY_PRICE_ID
STRIPE_FAMILY_PREMIUM_YEARLY_PRICE_ID
```

Then redeploy so the new environment is live.

---

## 4. Readiness validation

Run the read-only validator (it never prints full Price IDs — presence + last 4 only):

```bash
pnpm family-readiness:preflight        # before activation: expects FAMILY_BILLING_ENABLED OFF
pnpm family-readiness:activation       # gate BEFORE flipping the flag
pnpm family-readiness:post-activation  # after the flag is ON
```

- **preflight** requires the flag OFF; reports DB + price status.
- **activation** requires: migration applied, `familyTrialConsumedAt` present, zero `family/free_trial`,
  only expected Family plans, no Family workspace on a Business plan, **and** all six Family Price IDs
  present, validly shaped (`price_…`), unique, and not colliding with a Business Price ID.
- **post-activation** requires all of the above **and** the flag ON.

`FAMILY_BILLING_ENABLED` must remain **OFF** until `family-readiness:activation` passes.

---

## 5. Activate

Only after §2–§4 all pass: set **`FAMILY_BILLING_ENABLED=true`** in the Vercel production environment and
redeploy. Verify the deployment is Ready, routes healthy, and `family-readiness:post-activation` passes.

---

## 6. Controlled smoke test (one plan/interval)

Using an **approved test Family workspace** (never a real customer) and a Stripe test method suitable for
production smoke validation, perform exactly one Family Plus **monthly** checkout. Verify: checkout
session created → Stripe Checkout reached → subscription completes → webhook processed once → tenant
stays `workspaceKind=family`, becomes `family_plus`, `accessState=full_access` → subscription row +
Stripe customer mapping correct → no Business tenant affected → no Family domain data changed → critical
safety still available → billing portal opens → duplicate webhook replay is idempotent. Then cancel and
confirm the fallback to `family_free`/`full_access` with all data preserved and `familyTrialConsumedAt`
unchanged by checkout/cancellation. Do not test all six prices live in this pass.

---

## 7. Emergency disable

If anything looks wrong at any point after activation:

```
set FAMILY_BILLING_ENABLED=false  (Vercel production)  →  redeploy
```

With the flag off: Family checkout/trial fail safe, Family webhook mutations are quarantined (recorded
`ignored`), S2 enforcement is dormant, and Business billing is unaffected. Preserve logs; do not attempt
speculative production repairs — capture the failure and open a fix through the normal review path.
