# Child Safety — Release Candidate Stabilization V1

A stabilization, security, and end-to-end verification pass over the complete Child Safety vertical. **Not
a production certification and not a legal-compliance statement.** Tamanor reduces risk and speeds
intervention but cannot guarantee 100% protection.

- **Baseline commit:** `9fbb3ca feat(child-safety): add protection plans` (local `main`).
- **Scope:** fix the known RLS D5 security failure, fix the client-bundle build blocker, prove the full
  signal→resolution flow end to end, harden concurrency, and review queries/privacy/authorization/i18n.
  No new feature module.

## 1. Resolved RLS security issue (D5)

**Root cause.** `notifications` and `invites` carried a `tenant_isolation` RLS policy of the form
`(current_app_tenant_id() IS NULL) OR ("tenantId" = current_app_tenant_id())`. The `IS NULL` branch is a
*bootstrap-permissive* clause: if the RLS app role (`tamanor_app`) ever queries **without** a tenant context
set, the policy grants access to **every** row cross-tenant. Every other tenant table was hardened to the
fail-closed form `("tenantId" = current_app_tenant_id())` in `20260720_v1_58_5_rls_security_hardening`;
these two tables were added afterwards (`20260730`, `20260731`) and regressed.

**Correction.** New forward-only migration `20260819090000_rls_fix_notifications_invites_null_branch` drops
and recreates both policies **without** the `IS NULL` branch. `current_app_tenant_id()` =
`nullif(current_setting('app.tenant_id', true), '')`, and `withTenant()` **always** sets that GUC before any
query, so legitimate same-tenant access is unaffected; owner/`systemDb` bypasses RLS (privileged worker
paths keep working); an unset context now yields `"tenantId" = NULL` → **no rows** (fail-closed). No accepted
migration was edited; no GRANT change; `tamanor_app` stays least-privilege.

**Proof.** `rls-security` **37/37** (D5 green, D1/D2/D3 green, D9b fail-closed). New regression
`rls-null-branch-fix` **11/11**: same-tenant read/write works, cross-tenant denied, NULL-context fail-closed,
owner/system path still sees all — for both `notifications` and `invites`.

## 2. Resolved build issue (client bundle) — RESOLVED; production build exits 0

Two distinct issues were involved. Both are now fixed and the **full production build passes (exit 0,
107/107 pages)** with the project's real command `NODE_ENV=production next build`.

**Issue A — server-only `node:crypto` in the client bundle (real; fixed source-level).** `@guardora/core`
is a `transpilePackages` entry whose barrel re-exports SERVER-ONLY modules that import `node:crypto`
(`hibp` SHA-1, `rate-limit-store`, `child-safety-signing`). When a Child Safety **client** component
imported a value from the `@guardora/core` barrel, webpack dragged `node:crypto` into the **browser** graph
→ `UnhandledSchemeError`. **Fix (source-level boundary):** the Child Safety client components now import the
specific **browser-safe subpaths** (`@guardora/core/child-safety-orchestration|child-safety-review|
child-safety-evidence|child-safety-protection-plan`) instead of the barrel, so the barrel's server-only
crypto modules never enter the client graph. The earlier stop-gap webpack fallback in
`apps/web/next.config.mjs` was **removed** — no empty-module aliasing masks the client/server boundary
anymore. Server components / server actions still use the barrel (correct — they run on Node).

**Issue B — the `<Html>` prerender error was NOT a framework bug; it was a build-invocation artifact.** The
earlier "framework blocker" was reproduced only because the build was invoked through
`dotenv -e .env.local -e .env`, and `.env` sets `NODE_ENV=development`. Running `next build` with
`NODE_ENV=development` produces a broken hybrid build whose synthetic pages-router `/404`/`/500`/`/_error`
static export fails with `Error: <Html> should not be imported outside of pages/_document`. **Proof:**
`NODE_ENV=development next build` → fails (`<Html>`); `NODE_ENV=production next build` (the project's actual
build script) → **exit 0, 107/107 pages**. There is no framework regression and no Next 16.x upgrade is
required. The correct build command is the one in `apps/web/package.json`
(`… && NODE_ENV=production next build`), which never loads `.env`.

## 3. End-to-end flow

`child-safety-e2e` (**22/22**) proves the complete canonical workflow on the full authorized guardian chain:
content-free signal → dedupe/idempotent replay → canonical correlation → severity/urgency → exactly-once
escalation → protective intervention → guardian delivery → reviewer surfacing → assign → under-review →
append-only note → evidence + sha256 integrity verify → protection plan create/activate → resolve actions →
fail-closed plan completion → incident resolution → dashboard aggregates → deterministic timeline + audit.
It asserts tenant isolation (cross-tenant list excludes + detail 404), content minimization (no note body /
raw content in audit or timeline), no duplicate incident/escalation/intervention, and a guarded concurrent
status transition.

## 4. Concurrency guarantees

Proven safe (barriers/locks/guards, no timing flakiness):

- **One non-terminal plan per incident** — advisory lock + partial unique index (protection-plan suite).
- **Gap-free unique action `sequence`** — advisory lock + `UNIQUE(planId, sequence)` (protection-plan suite).
- **Evidence chain position** — advisory lock + `UNIQUE(incidentId, chainPosition)` (evidence suite: 12 concurrent → 1..12).
- **Incident correlation / escalation / intervention** — advisory lock + unique link/`(incident,type)` /
  per-signal ledger (incident-domain, intervention, recovery suites).
- **Reviewer incident status transition — HARDENED this sprint.** Was a read-then-write (stale overwrite
  possible); now a **guarded conditional update** (`updateMany WHERE status = observedFrom`, require
  `count === 1`) so only one transition from a given prior status wins and stale transitions fail closed.
  Verified in the E2E concurrency case; reviewer suite still 68/68.
- **Plan/action transitions** — guarded conditional update (+ plan `revision` guard).

## 5. Authorization matrix

Server/API is authoritative; UI visibility mirrors it. Owner / Administrator / Safety Reviewer are the only
principals; Analyst, Viewer, unauthenticated, and cross-tenant authenticated users are denied on every
capability (incident view/manage, notes, evidence view/manage/preview/download/export, protection-plan
view/manage, dashboard). Guardian delivery / escalation / intervention are system/orchestrator paths, never
guardian/SDK/gateway/public. Coverage lives in each domain suite's permission-failure + tenant-isolation
sections (reviewer, evidence, protection-plan, delivery, recipient-authorization) and the E2E test.

## 6. Privacy / content-minimization

No raw communication content exists in the Child Safety architecture (a `SafetySignal` is content-free by
construction). Protected free text — reviewer note bodies, evidence completion/… , protection-action
`completionNote`/`blockReason`, custom action text — is stored only on its own record and returned only via
the authorized reviewer read path; it is **never** copied into general audit, canonical events, timelines,
notifications, or dashboards, and never rendered as unsafe HTML. Storage keys/paths are never exposed
(service `PUBLIC_SELECT` excludes them; download/preview/export use safe filenames). API/server-action errors
return bounded safe codes only — never Prisma/Postgres/stack. Enforced by content-free assertions across the
domain suites + source-invariant checks in the UI suites.

## 7. Query & index review

Every hot Child Safety path is indexed for its filter/order shape:

| Path | Supporting index |
|---|---|
| reviewer incident list / filters | `child_safety_incidents (tenantId, protectedProfileId, riskFamily, status, lastSignalAt)`, `(tenantId, status, escalationState, updatedAt)`, `(tenantId, assignedReviewerId, status)` |
| signal↔incident link / correlation | `child_safety_incident_signals` unique `safetySignalId` + `(tenantId, incidentId)` |
| escalation lookup | `child_safety_escalations (tenantId, incidentId)` + unique `(incidentId, escalationType)` |
| evidence listing / custody | `child_safety_evidence (tenantId, incidentId, chainPosition)`; custody `(tenantId, evidenceId, createdAt)` |
| protection plan / actions / overdue | plans `(tenantId, incidentId, status)`; actions `(tenantId, planId, status)`, `(tenantId, assignedReviewerId, status)`, `(tenantId, dueAt)`; events `(tenantId, planId, createdAt)` |

No unbounded sequential scan on a hot path; child collections are read with an explicit tenant+parent
predicate that matches a composite index prefix.

## 8. Bounded reads

The incident list is paginated (default 25, hard max 100, real total). Child collections on the detail page
(signals, escalations, notifications, deliveries, audit refs, ledgers, reviewer notes, evidence, custody,
protection actions, events) are per-incident/per-plan bounded and read with a deterministic order; they are
naturally bounded by one incident's/plan's fan-out. Ranked list sorts operate over a documented most-recent
cap. No user-controllable unbounded limit is accepted.

## 9. Error contract

Bounded, localized (EN/SK/DE) safe codes across the reviewer/evidence/protection-plan surfaces:
`forbidden`, `not_found`, `invalid_transition`, `invalid_status`, validation codes (`note_empty`,
`title_required`, `file_too_large`, `invalid_url`, …), and concurrency codes
(`concurrent_modification`, `active_plan_exists`, `actions_incomplete`). Authorization failures return the
intended 404 for cross-tenant (no existence disclosure). No raw Prisma/Postgres/Node error reaches a client.

## 10. I18n

EN/SK/DE parity is asserted by the UI suites (reviewer-ui, evidence-ui, protection-plan-ui) with identical
nested key structures and full coverage of statuses, priorities, risk families, timeline/event types,
explanation codes, and the action catalog. No raw backend enum is rendered; dates/durations use deterministic
UTC formatting.

## 11. Retention & immutability

V1 is append-only where history matters and has **no destructive delete/update endpoint** for immutable
records: reviewer notes, review events, evidence, custody events, protection-action events, and audit
entries have no edit/delete path (verified by source-invariant tests). Incidents/plans/actions mutate only
through their explicit guarded lifecycle transitions. **Production retention periods and any lawful deletion
policy remain a configuration/policy decision** and are intentionally not implemented in this sprint.

## 12. Migration-chain validation

`rls-security` provisions a **fresh disposable local database** and applies the full migration chain in
order — including the new `20260819` RLS fix — with the Prisma schema matching the final database, all new
SYSTEM tables `REVOKE`d from `tamanor_app`, partial/unique indexes + composite FKs created, no accidental
broad GRANT, and D1/D2/D3/D5 all green. No accepted migration was modified; `migrate dev` / `db push` were
not used.

## 13. Validation results (exact)

Child Safety: e2e 22, rls-null-branch 11, detector 60, signal 32, incident-domain 36, incident-core 32,
intervention 12, recovery 18, reviewer 68, reviewer-ui 47, evidence 41, evidence-ui 22, protection-plan 50,
protection-plan-ui 32, consent 32, guardian-authority 140, delivery 65, recipient-authorization 46.
Platform: notifications 13, cyberbullying 36, cyberbullying-notifications-sla 48, security-access PASS,
rls-isolation/runtime/web/worker PASS, **rls-security 37/37**. Gates: **typecheck exit 0**, **lint exit 0**.
**Full production build (`NODE_ENV=production next build`): exit 0 — `✓ Compiled successfully`,
`✓ Generating static pages (107/107)`, finalized.** (A build invoked with `NODE_ENV=development`, e.g. via
`dotenv -e .env`, fails at the synthetic error-page prerender — use the project's production build command.)

## 14. Known limitations / future production requirements

- Retention/lawful-deletion policy, antivirus scanning of evidence, and export-custody idempotency on client
  retry remain documented V1 limitations (see evidence/protection-plan docs).
- Local performance measurements are indicative only; production latency depends on real infrastructure.
- Recommendations are advisory (no automatic police/legal/medical reporting); Tamanor cannot guarantee 100%
  protection.
