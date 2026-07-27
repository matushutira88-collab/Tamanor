# Child Safety — Analytics & Trends V1

An **internal operational** analytics module over the accepted canonical Child Safety domain. It surfaces
volume, trend, distribution, response-time, protection-plan, guardian-delivery, and reviewer-workload
signals to help a safety team run the queue. **It is not a certification, not a legal statement, and not a
profiling system.**

> **Explicitly NOT built (by design):** child profiling, child ranking, child scoring, behaviour
> prediction, message/keyword/evidence content analytics, guardian analytics, or reviewer performance
> ranking / leaderboards. Analytics is a read-only operational tool.

- **Scope:** a new read-only analytics vertical. No detection/decision/intervention behaviour changes.
- **Baseline:** builds on signal ingestion → canonical incident domain → escalation → intervention →
  guardian delivery → reviewer workspace → evidence → protection plans (all pre-existing).

## 1. Architecture

Analytics uses **only existing canonical data** — there is **no duplicate analytical truth** and no
materialized rollup table. Every number is derived on read.

```
canonical SYSTEM tables ──► @guardora/db  getChildSafetyAnalyticsReport(actor, {from,to,granularity})
  child_safety_incidents            (systemDb, explicit tenantId, bounded date range, suppressed)
  child_safety_escalations                     │
  child_safety_protection_plans                ├──► @guardora/core pure policy
  child_safety_protection_actions              │      suppression · bucketing · CSV · permissions
  child_safety_evidence                        │
  child_safety_interventions          ┌────────┴─────────┐
  child_safety_review_events          ▼                  ▼
  safety_signal_deliveries      web server module   API routes ──► UI page (/…/reviewer/analytics)
                                (session→actor,      GET /analytics        overview · trends ·
                                 safe error map)     GET /analytics/export distributions · performance ·
                                                     (CSV, O/A only)       plans · delivery · workload
```

- **`packages/core/src/child-safety-analytics.ts`** — pure vocabulary + policy: permissions, suppression
  (primary + secondary), deterministic UTC bucketing, distribution value-sets, range validation, median,
  CSV serialization. No I/O, clock, or randomness.
- **`packages/db/src/child-safety-analytics.ts`** — the SYSTEM-scoped service (`systemDb`, explicit
  `tenantId`). Reads the coarse content-free columns once per canonical table, aggregates, suppresses, and
  returns the report. Also `exportChildSafetyAnalyticsCsv` (aggregated-metrics-only CSV).
- **`apps/web/src/server/child-safety/analytics.ts`** — session → actor → service → safe JSON/CSV.
- **`apps/web/src/app/api/v1/child-safety/reviewer/analytics/{route,export/route}.ts`** — the two GET
  endpoints.
- **`apps/web/src/app/dashboard/child-safety/reviewer/analytics/*`** — the dashboard (page, view-model,
  i18n, charts, loading/error/unauthorized).

## 2. Privacy model

- **Content-free.** A `SafetySignal` is content-free by construction; the canonical tables store no raw
  message / transcript / evidence bytes / recipient contact. Analytics reads only coarse status/severity/
  urgency/risk-family codes and timestamps — never a note body, completion note, block reason, or storage
  key.
- **Tenant isolation.** Every query is `where: { tenantId, <timeCol> in [from,to] }`. These are SYSTEM
  tables (all privileges REVOKED from `tamanor_app`); enforcement is explicit scoping + composite
  `(id, tenantId)` FKs, exactly like the reviewer service. Cross-tenant analytics is impossible.
- **k-anonymity suppression** protects individuals from re-identification (see §5).
- **No profiling.** No per-child metric exists. Reviewer workload is an operational load view, never a
  ranking/score (see §9).

## 3. Permissions

Two new capabilities (in `@guardora/core` `Permission`):

| Capability | Owner | Administrator | Safety Reviewer | Analyst / Viewer |
|---|:--:|:--:|:--:|:--:|
| `child_safety:analytics_view` | ✅ | ✅ | ✅ | ❌ |
| `child_safety:analytics_export` (CSV) | ✅ | ✅ | ❌ | ❌ |

`view` opens the dashboard + JSON endpoint. `export` is **elevated** — deliberately withheld from the
Reviewer role — and re-checked server-side in `exportChildSafetyAnalyticsCsv` (a Reviewer receives 403).
There is no public / guardian / SDK / gateway path.

## 4. Metrics

- **Overview:** incidents created, incidents resolved, open incidents, escalations, active escalations,
  active protection plans, completed protection plans, overdue actions, blocked actions, evidence items,
  interventions, and the guardian-delivery outcome breakdown.
- **Time series** (day / week / month): incidents, resolutions, escalations, interventions, protection
  plans. **Every bucket in the range exists; a bucket with no events is a real `0`, never a gap.**
- **Distributions** (zero-filled + suppressed): severity, urgency, risk family, incident status,
  escalation status, plan status, action status, guardian delivery outcome.
- **Response performance** (median + observation count): incident → first review, incident → resolved,
  plan activation → completion.
- **Reviewer workload** (per reviewer, suppressed, never ranked): assigned, resolved, active actions,
  overdue actions, median first review, median resolution.
- **Protection plans:** active/completed/draft/cancelled/reopened counts + overdue/blocked actions +
  plan/action status distributions.

## 5. Suppression (privacy) — how a hidden value stays hidden

- **Minimum cohort = 5.** A **non-zero** count below 5 is suppressed: `{ value: null, suppressed: true }`.
  `0` is reported truthfully as `{ value: 0, suppressed: false }` (a zero reveals nothing about an
  individual). `≥ 5` is revealed. The hidden number is **never** returned in any field.
- **Secondary (complementary) suppression** prevents a *reconstruction-by-subtraction* attack: if exactly
  one cell in a distribution is suppressed, a published total minus the known cells would recover it, so
  the smallest revealed non-zero cell is **also** hidden — guaranteeing ≥ 2 unknowns whenever any cell is
  hidden. (`applySecondarySuppression`, folded into `buildDistribution`.)
- **Median durations** are suppressed when their observation cohort is `< 5` (`suppressDuration`) so a
  small-n median can't fingerprint a case.
- **Display + CSV** render a suppressed value as a mask (`•••`) / the literal `suppressed` — never a
  number. The UI notes "some values hidden for privacy" wherever a suppressed cell appears.
- **What is NOT suppressed:** grand-total overview scalars and time-series volumes (aggregate volume, not
  identity cohorts). Categorical breakdowns and per-reviewer rows — where re-identification concentrates —
  are suppressed. This is documented and asserted by tests.

## 6. API

- `GET /api/v1/child-safety/reviewer/analytics?from=&to=&granularity=day|week|month` → `{ ok, report }`.
  View permission required. `from`/`to` are ISO dates; the range is validated + clamped (§8).
- `GET /api/v1/child-safety/reviewer/analytics/export?from=&to=&granularity=` → `text/csv` attachment.
  **Export permission (Owner/Administrator) required.** The CSV contains **aggregated metrics only** —
  never an incident id, user id, guardian, note, message, evidence, or storage key. Reviewer-workload rows
  use **opaque positional labels** (`reviewer_1`, `reviewer_2`, …), never the real reviewer id. Suppressed
  values are written as `suppressed`.

## 7. UI

`/dashboard/child-safety/reviewer/analytics` (linked from the reviewer console header). Sections: overview
cards, trend chart (bar + accessible multi-series table) with a day/week/month switcher, distribution
charts, response-performance medians, protection plans, guardian delivery, and reviewer workload.

- **Dark mode + responsive:** theme-aware CSS variables; grids collapse on small screens; wide tables
  scroll inside their own container.
- **Keyboard accessible:** the range/granularity control is a plain GET `<form>` (no client JS); charts
  are labelled figures (`role="img"` + `aria-label`, per-bar titles); the trend also has a tabular form.
- **i18n:** EN / SK / DE with identical key structure (asserted).
- **Export button** is rendered only when the role has `analytics_export`.

## 8. Query rules & performance

Every analytics query is **tenant-scoped**, **date-range bounded**, **validated**, **indexed**, and free
of raw-SQL interpolation (Prisma parameterized reads).

- **Bounded range:** `clampAnalyticsRange` defaults to the last 30 days, swaps a reversed range, caps the
  span at **366 days**, and never lets `to` exceed `now`. Bucket enumeration is capped accordingly, so a
  bad input can never enumerate unbounded buckets.
- **No N+1:** each canonical table is read **once** (a single bounded `findMany`/`count`), then aggregated
  in memory; there is no per-incident or per-reviewer follow-up query.
- **Indexes (§ migration):** the time-column composite indexes serve the range scans + time series.
- Local performance numbers are indicative only; production latency depends on real infrastructure and
  data volume.

## 9. Reviewer workload — explicitly not a ranking

Per-reviewer rows are ordered by a **stable reviewer id** (never by any metric) and each numeric is
k-anonymity suppressed. There is **no leaderboard, no score, no percentile, no "best/worst"**. The UI
carries an explicit "operational workload only — reviewers are never ranked or scored" note in every
locale. The purpose is load-balancing, not performance evaluation.

## 10. Migration

One forward-only migration `20260820090000_cs_analytics_indexes` adds tenant-scoped time-column indexes
(`child_safety_incidents (tenantId, createdAt)` + `(tenantId, closedAt)`,
`child_safety_escalations (tenantId, triggeredAt)`,
`child_safety_protection_plans (tenantId, createdAt)`). Index-only — **no column, constraint, GRANT, RLS
policy, or data change**, and these tables remain SYSTEM-scoped (already REVOKED from `tamanor_app`). No
accepted migration was modified; applied with `prisma migrate deploy` (never `migrate dev` / `db push`).

## 11. Tests

- **`child-safety-analytics:test`** (local DB, 56 checks): authorization (view O/A/R; Analyst/Viewer
  denied; export O/A only, Reviewer denied), overview counts, distributions + primary/secondary
  suppression, complete time-series buckets (day/week/month, missing == 0), median performance, reviewer
  workload (no ranking, suppressed small caseload), protection-plan + guardian-delivery analytics, tenant
  isolation, and the content-free CSV export (no ids/users/guardian/notes/messages/evidence/storage keys;
  opaque reviewer labels; suppressed → `suppressed`).
- **`child-safety-analytics-ui:test`** (pure, 66 checks): view-model + suppression display (a hidden value
  is always masked), core policy (suppression, secondary suppression, bucket enumeration, range clamp,
  median, CSV, permissions), EN/SK/DE parity, and source invariants (permission gating, export gating,
  accessible charts, no `window.confirm`, error boundary never renders the raw error, no raw-content
  references, no ranking vocabulary, safe API/CSV routes).

## 12. Known limitations / future work

- Suppression is a fixed k = 5 with single-order complementary suppression; a determined analyst with
  many overlapping custom ranges could still learn coarse bounds. Differential-privacy noise and
  range-query rate-limiting are future hardening, not V1.
- Time-series volumes and overview totals are not suppressed (documented, deliberate) — only categorical
  breakdowns and per-reviewer rows are.
- Medians are exact (not noised); other percentiles are not exposed in V1.
- No caching / materialization — every load recomputes from canonical tables (correct for R&D scale;
  revisit for very large tenants).
- The CSV is a flat aggregated table; no charts/graphics are exported.
