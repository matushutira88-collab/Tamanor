# Family Notifications — Production Activation Runbook (Phase 4A.1)

> **Verdict: C — NOT ACTIVATED.** Deployment, the production migration, cron activation, and all live
> verification (authenticated cron invocation, provider-triggered run observation, scheduler-health read,
> anonymous/wrong-workspace access probes, Family UI + canary action smoke) **were not performed and remain
> explicitly unverified.** This document is a *prepared* operator runbook only. No production mutation, no
> production secret read/print/rotate, and no production data change was made in preparing it.

This is the **secure operator path** for activating the Family notification pipeline in production. It exists
because the local R&D environment cannot (and must not) hold the production database credential, cannot drive a
browser for UI smoke, and has no approved production canary tenant. Every mutating step below is performed by an
**authorized human operator** through the sanctioned GitHub Actions workflows and the Vercel dashboard — nothing
here is automatic, and nothing was run while writing it.

- **Exact baseline to deploy:** `13eaa6f4f8b1f48accfbc360463256d67830ebb4` (branch `main`, `origin/main` in sync).
  Do not deploy any other ref. All checks below assume this SHA.
- **Scope:** deploy + activate the notification pipeline that already exists through `13eaa6f` — 13 triggers,
  durable outbox + processor, deterministic expiry evaluators, DB-backed scheduler lease, authenticated cron,
  Vercel cron schedule, Family Notification Center, shell bell, read/mark-all/dismiss/safe-open. **No product
  feature is added by this phase.**

---

## 0. What was verified locally (green) vs. what is blocked

**Verified locally (non-production, real):**
- Baseline integrity: `HEAD == origin/main == 13eaa6f`, clean tree.
- Migration is **additive / replay-safe**: `20260827090000_family_notification_scheduler` uses `CREATE TABLE IF
  NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` only, `REVOKE ALL` on the app role, **no** `DROP`/`DELETE`/`RESET`/
  `TRUNCATE`, no RLS/CHECK/grant changes to existing objects.
- Effective cron config: exactly one Family entry (`/api/internal/cron/family-notifications @ */5 * * * *`) in
  `apps/web/vercel.json`, alongside three pre-existing, unchanged jobs.
- Cron endpoint auth contract (source): `GET`, `Authorization: Bearer ${CRON_SECRET}`, **fail-closed** when the
  secret is unset, constant-time comparison, generic 401, aggregate counts only (no ids).
- Build gate at `13eaa6f`: `typecheck` / `lint` / `build` all `rc=0`; the build output includes both
  `/api/internal/cron/family-notifications` and `/family/notifications` (see §7 for the re-run command).

**Blocked from this environment (require the operator / production / a browser / an approved canary):**
- §9 authenticated live cron invocation, §11 scheduler-lease behavior, §12 provider-triggered run + aggregate
  health, §13 anonymous / wrong-workspace access probes, §14 Family Center + bell render, §15 one canary UI
  action. These are **prepared** below with exact steps but are **UNVERIFIED**.

---

## 1. Deployment configuration audit (findings)

| Item | Finding | Action for operator |
|---|---|---|
| Vercel project | Linked at **repo root** (`.vercel/project.json`), project name **`tamanor-web`**. | Confirm in the Vercel dashboard this is the intended production project. |
| **Root Directory** | ⚠️ The cron config + Next app live in **`apps/web/`** (`apps/web/vercel.json`), but `.vercel` is at the repo root. Vercel only reads crons from the project's **Root Directory**. | **Verify the project's Root Directory is set to `apps/web`.** If it is the repo root, the `*/5` Family cron (and the 3 existing crons) will **not** register — this is a hard blocker for activation. |
| Monorepo | pnpm workspace (`apps/*`, `packages/*`), `packageManager pnpm@9.15.9`. Build = `pnpm --filter @guardora/db generate && NODE_ENV=production next build`. | Ensure the Vercel build command / install use pnpm 9.15.9 and build `@guardora/web`. |
| Region | `apps/web/vercel.json` pins `regions: ["fra1"]`. | Confirm the production DB is reachable/low-latency from `fra1`. |
| Migration guard | `pnpm db:migrate:deploy` runs an `assert-local-db` guard first and **refuses non-local targets** — it must **not** be used for production. | Use the **GitHub `production-prisma-migrate` workflow** only (§4). |

---

## 2. Required production environment variables (NAMES ONLY — never values)

Set/confirm these in the **Vercel `tamanor-web` Production** environment. **Values must never be committed,
printed, or pasted into this repo or any log.** This runbook lists names only.

**Essential for the notification pipeline + scheduler cron:**
```
DATABASE_URL                    # owner/systemDb connection (BYPASSRLS) — scheduler + migration role
APP_DATABASE_URL                # tamanor_app role connection (RLS-enforced) — request path
CRON_SECRET                     # REQUIRED: without it the cron route fail-closes (denies all) and the scheduler never runs
AUTH_SECRET                     # session auth — required for the Family console guard
APP_URL / APP_BASE_URL          # absolute base URL used server-side
NEXT_PUBLIC_APP_URL             # public base URL
TOKEN_ENCRYPTION_KEY            # token-at-rest encryption
TOKEN_ENCRYPTION_MODE
TOKEN_STORAGE_REQUIRE_ENCRYPTION
EXPECTED_LAST_MIGRATION         # readiness/verify pin (see §4) — 20260827090000_family_notification_scheduler
```

**Baseline app vars also present in production (names only; unchanged by this phase):**
```
READINESS_MODE  HIDE_TRACE  NODE_ENV  VERCEL_ENV  NEXT_PUBLIC_VERCEL_ENV
TAMANOR_ANALYTICS_HASH_KEY  TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL
FAMILY_BILLING_ENABLED  MAX_LEGACY_FAMILY_TENANTS
EMAIL_PROVIDER  EMAIL_FROM  RESEND_API_KEY  GOOGLE_EMAIL_CLIENT_ID  GOOGLE_EMAIL_CLIENT_SECRET
  GOOGLE_EMAIL_REFRESH_TOKEN  GOOGLE_EMAIL_SENDER
STRIPE_SECRET_KEY  STRIPE_WEBHOOK_SECRET  STRIPE_BILLING_PORTAL_RETURN_URL
META_APP_SECRET  META_WEBHOOK_SYNC  META_CONNECTOR_HEALTH  TURNSTILE_SECRET_KEY
AI_RISK_PROVIDER  AI_RISK_PROVIDER_ENABLED  AI_RISK_MIN_CONFIDENCE
TRANSLATION_ENABLED  TRANSLATION_PROVIDER  TRANSLATION_TARGET_MODE
EVIDENCE_AV_MODE  EVIDENCE_STORE_DIR  INDEXNOW_KEY
NEXT_PUBLIC_GA_MEASUREMENT_ID  NEXT_PUBLIC_GOOGLE_ADS_ID  NEXT_PUBLIC_META_PIXEL_ID
```

**Verification (operator, no values printed):** `vercel env ls production` — confirm each essential NAME is
present. **Stop condition:** if `CRON_SECRET`, `DATABASE_URL`, `APP_DATABASE_URL`, or `AUTH_SECRET` is missing →
**do not proceed**; the scheduler and/or the Family console cannot function.

---

## 3. One-time GitHub Environment setup (for the migration workflow)

The migration runs through `.github/workflows/production-prisma-migrate.yml`, gated behind a GitHub **Environment
named exactly `Production`**:
- **Required reviewers** — at least one authorized operator must approve each run (the job pauses on `environment: Production`).
- Secret **`PRODUCTION_DATABASE_URL`** — the production Postgres URL, injected only as `DATABASE_URL` inside the
  job, **never printed** (the workflow asserts it is set without echoing it).
- Optional secret **`PRODUCTION_DATABASE_HOST_FINGERPRINT`** — pins the target host by hash; when present the
  workflow refuses to run against any other host. Recommended.

---

## 4. Apply the production migration (operator, via GitHub Actions ONLY)

**Trigger:** Actions → **`production-prisma-migrate`** → **Run workflow** (`workflow_dispatch`, on `main` only):

| Input | Value |
|---|---|
| `environment` | `production` (only accepted value) |
| `expected_last_migration` | `20260827090000_family_notification_scheduler` |
| `confirmation` | `APPLY_ACCEPTED_PRODUCTION_MIGRATIONS` (exact) |

The job, in order: refuses any non-`main` ref → asserts `PRODUCTION_DATABASE_URL` is mapped (never printed) →
installs (frozen lockfile) → `prisma generate` → **read-only preflight**
(`production-prisma-migrate-preflight.cli.ts`: asserts a real production target + host fingerprint, reads
`_prisma_migrations`, fail-closes on any failed/in-progress migration, an `expected_last` mismatch, or a
surprising pending set; prints migration **names** only) → **`prisma migrate deploy`** (the only migration
command; no `migrate dev`/`db push`/`reset`/ad-hoc SQL) → **read-only verify**
(`production-prisma-migrate-verify.cli.ts`: DB up to date, `expected_last` applied, platform-admin migration
present).

**Expected pending set** (a fresh notification pipeline): up to three Family migrations may apply in one deploy —
`20260825090000_family_notifications`, `20260826090000_family_notification_outbox`,
`20260827090000_family_notification_scheduler`. `migrate deploy` applies all accepted pending migrations up to and
including the newest. Review the preflight's printed pending list before approving.

**Hard-stop conditions (the job applies nothing and fails):**
- The newest applied would not end exactly at `expected_last_migration`, or a different/unexpected migration is pending.
- Any migration is in `failed`/in-progress state.
- Target host is local/loopback, or the fingerprint does not match.
- Schema markers `tenants` / `_prisma_migrations` are missing, or any query fails.
- Any arming input is wrong.

**This migration adds:** `scheduler_leases` (owner-only, `REVOKE ALL` from `tamanor_app`) + two additive
expiry-scan indexes. It removes/alters nothing. There is a companion recovery workflow
(`production-prisma-migrate-recover`) if a prior migration is stuck `failed`.

---

## 5. Deploy the baseline (operator)

Deploy **exactly `13eaa6f`** to production. Two sanctioned options:

- **Preferred — promote from `main`:** ensure `main` is at `13eaa6f`, let the Vercel Git integration build the
  production deployment for that commit, and confirm the deployed commit SHA equals `13eaa6f`.
- **CLI (from a clean checkout of `13eaa6f`):**
  ```
  git -C <clean-checkout> rev-parse HEAD   # must print 13eaa6f4...
  vercel pull --environment=production      # pulls prod env into the CI/operator machine (NOT this repo)
  vercel build --prod
  vercel deploy --prebuilt --prod
  ```

**Order matters:** apply the **migration (§4) before** the deploy only if the new code requires the new schema at
boot. The scheduler code tolerates the lease table being created first; because the migration is additive and the
cron does not run until §6, applying §4 then §5 is the safe default. Do **not** deploy a ref other than `13eaa6f`.

**Post-deploy sanity (operator):** deployment state `Ready`; the build log shows routes
`/api/internal/cron/family-notifications` and `/family/notifications`.

---

## 6. Activate the cron (operator)

Vercel registers crons from `apps/web/vercel.json` **at deploy time**, provided the project **Root Directory is
`apps/web`** (see §1). After the §5 production deployment:
- Vercel dashboard → Project → **Settings → Cron Jobs** → confirm `/api/internal/cron/family-notifications`
  appears with schedule `*/5 * * * *`, enabled, and the 3 pre-existing crons are unchanged.
- Confirm `CRON_SECRET` is set in Production (Vercel injects `Authorization: Bearer ${CRON_SECRET}` into cron
  invocations automatically). **If `CRON_SECRET` is unset, the endpoint fail-closes and the scheduler never runs.**

---

## 7. Commands: local-safe vs. production-only

**Safe to run locally (read-only / non-production):**
```
git rev-parse HEAD                                   # must be 13eaa6f4...
git status --porcelain                               # must be empty
pnpm --filter @guardora/web typecheck
pnpm --filter @guardora/web lint
pnpm --filter @guardora/web build                    # NODE_ENV=production next build (compile gate)
pnpm --filter @guardora/db exec tsx scripts/production-prisma-migrate.test.ts           # workflow logic unit test
pnpm --filter @guardora/db exec tsx scripts/production-prisma-migrate-workflow.test.ts
cat apps/web/vercel.json                             # inspect effective cron config
vercel env ls production                             # NAMES only — never prints values
vercel projects ls / vercel inspect <url>            # deployment metadata
```

**MUST run only through the approved production workflow (never from this environment):**
```
# GitHub Actions → production-prisma-migrate (workflow_dispatch) — the ONLY production migration path
prisma migrate deploy            # (runs inside the workflow; never run by hand against prod)
vercel deploy --prod             # operator/CI, from a clean 13eaa6f checkout
curl -H "Authorization: Bearer <CRON_SECRET>" https://<prod-host>/api/internal/cron/family-notifications
                                 # §9 authenticated cron probe — operator only; secret never pasted into repo/logs
```

---

## 8. Live verification (operator — PREPARED, currently UNVERIFIED)

Perform in this order after §4–§6. Record pass/fail; do **not** convert an unknown into a pass.

1. **Authenticated cron (§9).** `GET /api/internal/cron/family-notifications` with the correct Bearer → `200`
   `{ ok: true, ...aggregate counts, acquired, stoppedReason }`. No ids/tenants/recipients in the body.
2. **Anonymous / wrong secret (§13).** Same URL with **no** header and with a **wrong** Bearer → **`401`
   Unauthorized**, generic body, no token echo. Fail-closed confirmed.
3. **Lease behavior (§11).** Two near-simultaneous authenticated invocations → exactly one acquires the
   `family-notifications-scheduler` lease; the other reports not-acquired. No duplicate processing.
4. **Provider-triggered run + health (§12).** Wait for one Vercel-scheduled `*/5` firing; confirm via ops
   telemetry (`cron.job.started` / `cron.job.completed`, `operation: family_notifications_scheduler`) and
   `getFamilyNotificationSchedulerHealth` that outbox pending/processing/completed/dead_letter counts move as
   expected and nothing is wedged.
5. **Family Center + bell render (§14).** As an **authorized Family user** in production, load
   `/family/notifications`: one `h1`, list renders, unread badge (0 / 1–99 / 99+) correct, no id/raw metadata in
   the DOM, `loading`/`error` boundaries safe.
6. **Wrong-workspace fail-closed (§13).** A non-Family / different-workspace session hitting `/family/...` is
   denied by `requireFamilyConsole` (no enumeration, no leak).
7. **One canary UI action (§15).** In a **dedicated approved production canary Family account (never a real
   customer)**, perform exactly **one** safe action — mark-one-read *or* mark-all-read *or* dismiss an eligible
   row *or* safe-open a CTA. Confirm: server-authoritative (client sends only `notificationId`), idempotent,
   own-recipient/tenant/Family-scoped, urgent/non-dismissible correctly rejected, redirect only to an
   allow-listed id-free Family list route, and the source domain is unchanged. Do not exercise multiple actions
   or multiple accounts in this pass.

**Log-privacy check (§ all):** across every step above, confirm **no** tenant/user/profile/source id, email,
notification content, DATABASE_URL, or `CRON_SECRET` appears in any log, job summary, or response body. Bounded
ops events only.

---

## 9. Rollback & emergency stop

If any step looks wrong:
- **Disable the scheduler immediately:** Vercel → Settings → Cron Jobs → **disable**
  `/api/internal/cron/family-notifications` (stops all further runs within one cycle). Alternatively rotate/blank
  `CRON_SECRET` in Production to fail-close the endpoint (then redeploy).
- **Roll back the app:** Vercel → Deployments → promote the previous known-good production deployment
  (instant; no rebuild). The baseline code change is UI + an authenticated read-mostly scheduler — reverting the
  deployment removes the route and the cron target.
- **The migration is forward-only and additive** — do **not** attempt to drop `scheduler_leases` or the indexes
  under incident pressure. They are inert without the running cron. If the migration itself is stuck `failed`,
  use the `production-prisma-migrate-recover` workflow, not hand SQL.
- **Preserve logs; do not attempt speculative production repairs.** Capture the failure and open a fix through
  the normal review path (a narrowly scoped commit), then re-run this runbook from §7.

**Stop conditions (halt activation, do not proceed):**
- Root Directory is not `apps/web` (crons won't register) — §1.
- `CRON_SECRET` / `DATABASE_URL` / `APP_DATABASE_URL` / `AUTH_SECRET` missing — §2.
- Migration preflight hard-stops, or the pending set is not the expected Family set — §4.
- Deployed commit ≠ `13eaa6f` — §5.
- Anonymous/wrong-secret cron probe does **not** return 401 — §8.2.
- Any id/secret/notification content appears in a log or response — §8 log-privacy.

---

## 10. 41-point activation report

Status legend: **✅ LOCAL-VERIFIED** (checked here, non-production, green) · **🟡 PREPARED** (runbook step ready
for the operator) · **⛔ BLOCKED** (cannot be done from this environment) · **⬜ UNVERIFIED** (requires the live
production run).

| # | Check | Status |
|---|---|---|
| 1 | HEAD == `13eaa6f` (exact baseline) | ✅ LOCAL-VERIFIED |
| 2 | Clean working tree, `origin/main` in sync | ✅ LOCAL-VERIFIED |
| 3 | `13eaa6f` is the ref to deploy (no drift) | ✅ LOCAL-VERIFIED |
| 4 | Migration `…_family_notification_scheduler` is additive/replay-safe | ✅ LOCAL-VERIFIED |
| 5 | No `DROP`/`DELETE`/`RESET`/`TRUNCATE`/grant-alter in migration | ✅ LOCAL-VERIFIED |
| 6 | Newest migration name pinned for the workflow input | ✅ LOCAL-VERIFIED |
| 7 | Effective cron config = one Family `*/5` + 3 unchanged jobs | ✅ LOCAL-VERIFIED |
| 8 | Cron endpoint present (`GET`, nodejs, force-dynamic, no-store) | ✅ LOCAL-VERIFIED |
| 9 | Cron auth fail-closed when secret unset (source) | ✅ LOCAL-VERIFIED |
| 10 | Cron returns aggregate counts only (no ids) | ✅ LOCAL-VERIFIED |
| 11 | Center route + boundaries + bell files present | ✅ LOCAL-VERIFIED |
| 12 | `typecheck` rc=0 at `13eaa6f` | ✅ LOCAL-VERIFIED |
| 13 | `lint` rc=0 at `13eaa6f` | ✅ LOCAL-VERIFIED |
| 14 | `build` rc=0; routes compiled into output | ✅ LOCAL-VERIFIED |
| 15 | Migration-workflow unit tests pass | ✅ LOCAL-VERIFIED |
| 16 | Vercel project identified (`tamanor-web`) | ✅ LOCAL-VERIFIED |
| 17 | Root Directory must be `apps/web` (crons) — flagged | 🟡 PREPARED |
| 18 | Required env-var NAMES enumerated (no values) | ✅ LOCAL-VERIFIED |
| 19 | `CRON_SECRET` present in Production | 🟡 PREPARED / ⬜ UNVERIFIED |
| 20 | `DATABASE_URL` / `APP_DATABASE_URL` present in Production | 🟡 PREPARED / ⬜ UNVERIFIED |
| 21 | `AUTH_SECRET` present in Production | 🟡 PREPARED / ⬜ UNVERIFIED |
| 22 | GitHub `Production` Environment + reviewers configured | 🟡 PREPARED / ⬜ UNVERIFIED |
| 23 | `PRODUCTION_DATABASE_URL` secret mapped (never printed) | 🟡 PREPARED / ⬜ UNVERIFIED |
| 24 | Host fingerprint secret set (recommended) | 🟡 PREPARED |
| 25 | Migration preflight passes against production | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 26 | `prisma migrate deploy` applied (workflow) | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 27 | Migration verify passes (up to date) | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 28 | `13eaa6f` deployed; deployed SHA matches | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 29 | Deployment `Ready`; both routes live | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 30 | Vercel cron registered + enabled | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 31 | Authenticated cron → 200 + aggregate body | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 32 | Anonymous cron → 401 fail-closed | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 33 | Wrong-secret cron → 401 fail-closed | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 34 | Scheduler lease: single acquisition under concurrency | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 35 | Provider-triggered `*/5` run observed via telemetry | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 36 | Aggregate scheduler/outbox health sane | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 37 | Family Center + bell render for authorized Family user | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 38 | Wrong-workspace / anonymous console access fail-closed | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 39 | One canary UI action verified (dedicated canary account) | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 40 | No id/secret/notification content in any log or response | ⛔ BLOCKED / ⬜ UNVERIFIED |
| 41 | Rollback + incident-response documented | ✅ LOCAL-VERIFIED (this doc, §9) |

**Tally:** 15 local-verified · items 17–24 prepared (operator/CI) · items 25–40 blocked/unverified (require the
live production run). **No production-active claim is permitted** until 25–40 are performed and pass.

---

## 11. Verdict

**C — NOT ACTIVATED.** Family notification production activation is not complete; no production-active claim is
permitted until the listed blockers (Root Directory confirmation, production env vars, the gated migration, the
`13eaa6f` production deploy, cron registration, and the live cron/scheduler/access/UI/canary verifications) are
resolved by an authorized operator through the sanctioned workflows above.
