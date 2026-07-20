# Tamanor — Security Suite: Architecture & Roadmap (R&D proposal)

> **Status:** Proposal for review. No implementation started.
> **Scope:** Extends Guardora/Tamanor from an *AI Reputation Firewall* (inbound
> comment/review moderation) into a **reputation-protection + social-account
> security platform**. Adds five modules: **Security Center · Security Score ·
> Account Takeover Detection · Brand Protection · Incident Center**.
> **Constraint:** R&D lab (`Desktop/Tamanor`) only. Preserve existing
> architecture, design, data model, and invariants. Local only — never
> push/deploy. Do not rewrite working modules.

---

## 1. What Tamanor is today (analysis baseline)

A mature (~V1.21+) pnpm monorepo. The scaffold docs undersell it — the real
codebase already carries production-grade security machinery we can build on.

**Monorepo shape**

| Layer | Package/App | Role |
| --- | --- | --- |
| Domain | `@guardora/core` | Enums + types = single source of truth (platforms, risk, moderation, rules, audit, **permissions**, **entitlements**, **capabilities**, **protection-score**, **hibp**, **password-policy**). No runtime deps. |
| AI | `@guardora/ai` | `RiskEngine` + deterministic `RiskClassifier` (multilingual rules) + pluggable `AiRiskProvider` (real OpenAI, provider-agnostic) + hybrid pipeline (rules are a safety floor; AI never lowers risk). |
| Connectors | `@guardora/connectors` | `PlatformConnector` interface + placeholder adapters + **one real** `MetaReadOnlyConnector` (Graph GET only). `ConnectorRuntime` hard-disables all mutations. |
| Sync | `@guardora/sync` | Lease-guarded, RLS-scoped read-only ingest → classify → shadow triage. Fail-closed everywhere. |
| DB | `@guardora/db` | Prisma + Postgres **RLS** (`tamanor_app` non-superuser role, `app.tenant_id` GUC via `withTenant`), Stripe billing, usage metering, sessions, incidents, control policies. |
| Config | `@guardora/config` | Zod env validation, placeholder-friendly. |
| Web | `apps/web` | Next.js 15.5 App Router, React 19, Tailwind v4. Server Actions for all mutations, DB-backed opaque sessions, RBAC + plan entitlements. Trilingual EN/SK/DE (compile-enforced dictionaries). |
| Worker | `apps/worker` | Long-running process, two adaptive self-scheduling loops (maintenance + auto-sync). Proposes only; `AUTO_EXECUTION_ENABLED = false`. |

**Security primitives already present (reuse, do not rebuild):**

- **Tenant isolation:** every row `tenantId`-scoped; Postgres RLS + `withTenant`;
  composite `(id, tenantId)` FKs make cross-tenant references structurally
  impossible. (`packages/db/src/tenant-db.ts`, RLS migrations.)
- **RBAC:** `Role` (Owner/Admin/Analyst/Reviewer/Viewer) + `Permission` enum +
  `ROLE_PERMISSIONS` + `can()/assertCan()` + `requirePermission()`. Fine-grained
  `canApproveDecision`. (`packages/core/src/permissions.ts`, `src/server/auth.ts`.)
- **Plan gating:** `getTenantEntitlements` + `hasEntitlement` +
  `requireDashboardCapability` → truthful `CapabilityLockedState` UI. `enterprise`
  plan tier exists.
- **Audit:** append-only `AuditLog`, dot-namespaced events, `writeAudit()` inside
  the tenant transaction, surfaced at `dashboard/audit`.
- **Account/session security:** DB-backed `UserSession` (rotation, absolute
  expiry, `userAgentSummary`, `lastSeenAt`, revoke), Argon2id, HIBP
  (`core/hibp.ts`), password policy, Turnstile, email-verification/reset tokens.
- **Connector security:** `ConnectedAccount` carries `status`/`mode`/`health`,
  `scopes[]`, `grantedPermissions[]`, token health, `killSwitch`, encrypted-token
  seam (`token-crypto.ts`); `token-monitor.ts` + `meta-health.ts` worker jobs.
- **Reputation-side seeds:** `Incident` + `IncidentRelatedItem` (+ `dashboard/incidents`),
  `ControlPolicy` + `ActionQueueItem` (Control Center), `Actor Risk` page +
  `actor.ts`, `protection-score.ts` (+ `ProtectionScore` ring gauge), Auto-Protect
  shadow engine, `PlatformActionExecution` (fail-closed hide, default OFF),
  `WebhookEvent` signature verification, `ProviderCall` observability.

**Design system:** Tailwind v4 CSS tokens (`globals.css` `@theme`), `.gu-card`
containers, `.gu-display` headings, hand-authored inline SVG icons, shared kit in
`components/dashboard/ui.tsx` (`PageHeader`, `Card`, `Badge`, `StatCard`,
`EmptyState`, `Tabs`, form controls) + `KpiCard`, `ProtectionScore` (ring gauge),
`accounts-table` (responsive table), `CapabilityLockedState`. Single light theme;
dark = scoped token overrides (`.gu-sidebar`, `.gu-dark`). New modules reuse these
verbatim.

---

## 2. Strategic framing

Today Tamanor answers *"what are people saying about my brand, and is it safe?"*
The Security Suite adds *"are my brand's accounts and identity themselves safe,
and can I prove I responded when they weren't?"*

Two distinct security surfaces — keep them explicitly separated:

1. **Tenant/workspace security** — the Guardora *customer's own* Tamanor accounts:
   users, sessions, MFA, RBAC hygiene, password/breach exposure.
2. **Protected-asset security** — the *connected social accounts & brand identity*:
   token/permission drift, suspicious platform-side activity we can observe via
   official APIs, impersonation and brand abuse.

The five modules map onto these surfaces:

| Module | Primary surface | One-liner |
| --- | --- | --- |
| **Security Center** | both (hub) | Single pane aggregating score, detections, incidents, posture, recommendations. |
| **Security Score** | both | Composite 0–100 posture score, per tenant / brand / account, with history. |
| **Account Takeover Detection** | both | Detect signs a Tamanor user *or* a connected social account is compromised. |
| **Brand Protection** | protected-asset | Track impersonation, handle-squatting, counterfeit/phishing abuse of the brand. |
| **Incident Center** | both | Full security-incident lifecycle (elevates the existing reputation `Incident`). |

**Invariants inherited (never regress — from `SECURITY.md`):** no scraping;
official OAuth/API only; every automated action audited; no destructive default;
tenant isolation via RLS; secrets never in UI/logs/audit; fail *safe* on
uncertainty (detect & surface, never auto-act). The Security Suite is
**detection & response only** — it raises signals and drives human workflow; it
never gains new platform-mutation powers.

---

## 3. Module architecture

For each module: how it fits existing surfaces, new data model (mirrored
`core` ↔ Prisma enums), signal sources, permissions/gating, UI, worker, audit.

### 3.1 Security Center (the hub)

**Purpose:** a composed dashboard, not a new engine. Aggregates Security Score,
open detections, open incidents, connector posture, and access-security summary
into one page with prioritized recommendations.

- **New nav group `"Security"`** in `src/lib/nav.ts` with items: *Security Center*,
  *Security Score* (or folded in), *Detections*, *Brand Protection*,
  *Incidents* (move existing here / cross-link). Add shield/lock glyphs to
  `nav-icons.tsx` (seeds already exist: `IconShield`, `approvals` shield, lock SVG).
- **Page:** `dashboard/security/page.tsx` — reuse Overview composition: `PageHeader`
  (eyebrow "Security") → `ProtectionScore`/Security Score ring → `KpiCard` grid
  (open detections, open incidents, at-risk accounts, MFA coverage) → sections
  listing top detections/incidents via the `accounts-table` responsive pattern →
  recommendations card (`EmptyState`-style tiles).
- **Data:** pure read/aggregate over the other modules' tables. No new model.
- **Gating:** `requireDashboardCapability("security_suite")` (new entitlement,
  Enterprise plan) → `CapabilityLockedState` for lower tiers.
- **Permission:** `security:view`.

### 3.2 Security Score

**Purpose:** generalize the existing reputation `protection-score.ts` into a
composite **security posture** score. Keep the reputation ProtectionScore intact;
Security Score is a *superset* that includes it as one dimension.

- **Dimensions (subscores, each 0–100, weighted):**
  1. **Access security** — MFA adoption, stale/over-privileged sessions, password
     age, HIBP breach hits, owner/admin count sanity.
  2. **Connector security** — token freshness, minimal scopes, monitoring enabled,
     no permission drift, healthy status.
  3. **Protection coverage** — existing reputation ProtectionScore (auto-protect
     policies configured, platforms covered, rule sets present).
  4. **Response readiness** — open incidents age, unresolved high/critical items,
     unacknowledged detections.
  5. **Compliance** — audit completeness, encryption-at-rest in prod, retention
     configured.
- **New model `SecurityScoreSnapshot`** (append-only, like `ReportSnapshot`):
  `id`, `tenantId`, `brandId?`, `scope` (`tenant`/`brand`/`account`), `score Int`,
  `subscores Json`, `inputs Json` (evidence for explainability), `computedAt`.
  `@@unique([id, tenantId])`; index `[tenantId, scope, computedAt]`.
- **Compute:** a pure `computeSecurityScore(...)` in `core/security-score.ts`
  (deterministic, no network) fed by repo aggregates. Live compute for display;
  worker persists periodic snapshots for history/trend (reuse `AreaTrend`).
- **UI:** reuse `ProtectionScore` ring verbatim (`score`, `checks[]` with
  `ok|partial|off`, `ringColor` by `>=80 ok / >=50 warn / else danger`) + a
  subscore breakdown card + trend chart.
- **Permission:** `security:view`.

### 3.3 Account Takeover Detection (ATO)

**Purpose:** detect signals that a Tamanor user account **or** a connected social
account is compromised. Detection & alerting only — no lockouts auto-executed in
phase 1 (surface + recommend; optional guarded auto-response later).

- **Two detector families:**
  - **Workspace-user ATO** (from data we own): new-device/new-geo session,
    impossible travel (needs coarse IP geo — see decisions), burst of failed
    logins / password-reset requests, MFA disabled, HIBP breach match on the
    account email, privilege escalation (role change to owner/admin), session
    anomalies (`UserSession.userAgentSummary`/`lastSeenAt`).
  - **Connected-account ATO** (from official API signals only): token unexpectedly
    revoked/invalidated, `grantedPermissions`/`scopes` drift, `externalName`
    change, connector health flip to error. Extend existing `token-monitor.ts` +
    `meta-health.ts` to *emit detections* instead of only updating health.
- **New model `SecurityDetection`** (the shared detection ledger for ATO + brand):
  `id`, `tenantId`, `brandId?`, `subjectType` (`user`/`connected_account`/`brand`),
  `subjectId`, `kind` (enum `SecurityDetectionKind`: `new_device`,
  `impossible_travel`, `credential_stuffing`, `mfa_disabled`, `breach_exposure`,
  `privilege_escalation`, `token_revoked`, `permission_drift`,
  `account_name_change`, `impersonation`, `handle_squat`, `phishing_abuse`, …),
  `severity` (reuse `RiskLevel`), `status` (`open`/`acknowledged`/`dismissed`/
  `confirmed`/`resolved`), `evidence Json` (PII-minimal), `detectedByEngine`,
  `detectedAt`, `resolvedAt?`. `@@unique([id, tenantId])`; indexes on
  `[tenantId, status, detectedAt]`, `[tenantId, subjectType, subjectId]`.
- **Actions (Server Actions, audited):** acknowledge, dismiss (with reason),
  confirm → escalate to Incident, "secure account" recommendation (revoke
  sessions / force reconnect — reuse existing `session-mgmt` + connector
  reconnect; user-triggered, never silent).
- **UI:** `dashboard/security/detections/page.tsx` — `Tabs` (open/all), responsive
  detection table with `Badge` severity, detail drawer (follow `dashboard-shell`
  drawer pattern). Detection count badge on nav.
- **Permission:** `security:view` (read), `security:manage` (ack/dismiss/confirm).
- **Safety:** fail-closed — a detector error surfaces nothing rather than a false
  "all clear"; no auto-lockout in phase 1; every state change audited
  (`security.detection.*`).

### 3.4 Brand Protection

**Purpose:** track and respond to abuse of the brand *identity*: impersonation
profiles, handle-squatting, counterfeit/phishing pages, and brand-attack content.
**Honest constraint:** no scraping. External discovery of impersonators is
limited to what official APIs expose + inbound content signals + manual reporting.
Do not present speculative discovery as live.

- **Signal sources (all sanctioned):**
  1. **Inbound content** already classified `RiskCategory.Scam` / `BrandAttack` /
     `Misinformation` → auto-open brand-protection candidates (scam comments
     impersonating the brand are already detected today).
  2. **Manual reporting** — team members register a suspected impersonator
     (URL/handle/platform/evidence).
  3. **Watchlist register** — known impersonators / cleared look-alikes.
  4. **API-derived** (where a platform offers an official brand-rights / search
     endpoint) — placeholder adapter documenting the endpoint, off by default,
     honest "not connected" state (mirrors the connector philosophy).
- **New model `BrandProtectionCase`:** `id`, `tenantId`, `brandId`, `kind`
  (`impersonation`/`handle_squat`/`counterfeit`/`phishing`/`brand_attack`),
  `platform Platform?`, `subjectHandle?`, `evidenceUrl?`, `evidence Json?`,
  `source` (`detected`/`user_reported`/`api`), `severity RiskLevel`, `status`
  (`open`/`investigating`/`reported_to_platform`/`resolved`/`dismissed`),
  `linkedDetectionId?`, `linkedIncidentId?`. `@@unique([id, tenantId])`.
- **Workflow:** open → investigate → (record) report-to-platform → resolve;
  escalate to Incident. All audited (`brand_protection.case.*`).
- **UI:** `dashboard/security/brand-protection/page.tsx` — case table + "report
  impersonator" form (`Field`/`Input`/`Select`) + status pills.
- **Permission:** `security:view` / `security:manage`.

### 3.5 Incident Center

**Purpose:** elevate the existing reputation-only `Incident` into a full
**security incident lifecycle** that unifies ATO, brand-abuse, coordinated-attack,
and reputation incidents. Extend — do not replace — the current `Incident` model
and `dashboard/incidents` page.

- **Extend `Incident`** (additive columns, no breaking change):
  `category` (enum `IncidentCategory`: `reputation`, `account_takeover`,
  `brand_abuse`, `coordinated_attack`, `connector_compromise`, `data_exposure`),
  `severity RiskLevel`, `lifecycleStatus` (`open`/`investigating`/`contained`/
  `resolved`/`post_mortem`), `assignedToUserId?`, `detectedAt`, `containedAt?`,
  `resolvedAt?`, `summary?`, `playbookKey?`. Keep existing fields/relations.
- **Link everything:** `SecurityDetection.linkedIncidentId`,
  `BrandProtectionCase.linkedIncidentId`, existing `IncidentRelatedItem`
  (reputation items). One incident aggregates its evidence timeline.
- **Response playbooks:** static, versioned checklists per category
  (`core/incident-playbooks.ts`) rendered as a checklist (reuse `ProtectionScore`
  check-row / `EmptyState` tiles). No auto-remediation.
- **UI:** extend `dashboard/incidents/page.tsx` — filters by category/severity/
  status, incident detail with unified timeline + playbook + assignee editor
  (reuse `assignee-editor.tsx`), lifecycle transitions (Server Actions, audited
  `incident.*`).
- **Permissions:** `incident:view` / `incident:manage`.

---

## 4. Cross-cutting implementation contract

Every module obeys the existing conventions — this is what "fits naturally" means.

- **Enums mirrored in both places:** add each new enum to `packages/core/src/*`
  (PascalCase members → snake_case string values) **and** re-declare in
  `packages/db/prisma/schema.prisma`. They are not auto-generated; mirroring is by
  convention.
- **Every new table is tenant-scoped + RLS:** `tenantId` column, Cascade FK to
  `Tenant`, added to the `tenant_isolation` strict-table `DO` loop in a **raw-SQL
  migration**, `FORCE ROW LEVEL SECURITY`, granted to `tamanor_app`. Composite
  `(id, tenantId)` unique for any cross-referenced row. (Prisma can't express RLS.)
- **All queries via `withTenant(session.tenantId, db => …)`.** `systemDb` only for
  legitimate cross-tenant worker discovery, audited by grep.
- **All mutations are Server Actions:** `requireVerifiedSession()` →
  `assertCan(role, Permission.X)` → `withTenant(... writeAudit(...) ...)` →
  `revalidatePath` + notice. No new REST CRUD API.
- **RBAC additions:** extend `Permission` enum + `ROLE_PERMISSIONS` in
  `permissions.ts` (`security:view/manage`, `incident:view/manage`). Read →
  Analyst+; manage → Admin+/Owner (finalize in decisions).
- **Plan gating:** one new entitlement `security_suite` (Enterprise) via
  `entitlements.ts` + `requireDashboardCapability`; `CapabilityLockedState` for
  lower tiers.
- **Audit events:** `security.score.snapshot`, `security.detection.opened|acknowledged|dismissed|confirmed`,
  `brand_protection.case.*`, `incident.opened|status_changed|resolved`.
- **Worker jobs (additive to the maintenance loop, fail-closed, try/caught):**
  `runSecurityScoreSnapshot`, `runAtoDetectionSweep` (extends token-monitor +
  meta-health + session anomaly), `runBrandProtectionScan` (placeholder). Emit
  `emitOpsEvent` observability; no platform mutation.
- **i18n:** add keys to all three dictionaries (`en/sk/de`) — compile enforces
  coverage. New `dashboardNav` labels + page headers + empty states.
- **Design:** token-only colors, `.gu-card`, `.gu-display`, inline SVG icons,
  reuse `ProtectionScore`/`KpiCard`/`Badge`/`accounts-table`/`CapabilityLockedState`.
- **Safety:** detection & response only. No new mutation capability. Fail safe:
  on detector uncertainty, surface for human review; never emit a false "secure".

---

## 5. Phased roadmap (each phase shippable, non-regressing)

Prefixed **S** (Security) to sit alongside the existing V-roadmap. Aligns with
existing V3/V4 Enterprise themes (RBAC depth, reporting, notifications, SSO).

### S0 — Foundations (schema + RBAC + gated shell)
Enums + models (`SecurityScoreSnapshot`, `SecurityDetection`, `BrandProtectionCase`,
`Incident` additive columns) with RLS migration; new `Permission`s +
`security_suite` entitlement; `"Security"` nav group + icons; Security Center page
**shell** with real empty states. No detectors yet.
**Exit:** Security Center renders, correctly gated and audited; zero behavior
change to existing modules; typecheck/build/i18n-check green.

### S1 — Security Score
`core/security-score.ts` compute + live gauge on Security Center + per-account
score; worker snapshot job + trend. Reuses `ProtectionScore`.
**Exit:** composite score visible with explainable subscores + history.

### S2 — Account Takeover Detection
`SecurityDetection` wired; workspace-user detectors (new-device, breach, MFA-off,
privilege-escalation) + connected-account detectors (token/permission drift) by
extending `token-monitor`/`meta-health`; detections list + ack/dismiss/confirm.
**Exit:** real detections from real signals, audited, no auto-action.

### S3 — Incident Center
Elevate `Incident` (category/severity/lifecycle/assignee/playbook); link
detections + related items; response workflow on the existing incidents page.
**Exit:** full incident lifecycle; detections escalate into incidents.

### S4 — Brand Protection
`BrandProtectionCase` register; auto-candidates from `Scam`/`BrandAttack` content;
manual reporting + watchlist; honest placeholder API detectors.
**Exit:** brand-abuse cases tracked and escalatable to incidents.

### S5 — Enterprise hardening
Security notifications (email/webhook) for high-severity detections/incidents;
MFA-enforcement policy; security/compliance export reports; SSO/SAML hooks
(joins V4). Optional *guarded, opt-in, audited* auto-response (e.g. auto-revoke
sessions on confirmed ATO) behind fail-closed env gates — same pattern as the
Facebook-hide seam.
**Exit:** enterprise-ready detection→notification→response loop.

---

## 6. Decisions (resolved 2026-07-20)

1. **Security Score scope** — ✅ **Composite** (access + connector + coverage +
   response + compliance). The existing reputation ProtectionScore becomes one
   dimension.
2. **ATO scope & sequencing** — ✅ **Workspace users first** (S2a): signals from
   data we already own — new-device session, HIBP breach, MFA disabled, privilege
   escalation, credential/session security events. Then connected-account drift
   (S2b) by extending `token-monitor`/`meta-health`.
3. **Impossible-travel / geo** — ✅ **Defer.** No IP-geolocation service, no new
   external dependency, no exact-location storage, no privacy changes for geo now.
   S2 is built on owned signals only. **Architect the signal layer so a coarse-geo
   provider can plug in later as an optional signal source** (a
   `GeoSignalProvider`-style seam that is absent/`none` today), without touching
   the rest.
4. **ATO wording invariant** — ✅ A detection **must never assert a confirmed
   compromise.** It carries a `RiskLevel` and is phrased as *"possible account
   takeover."* Only a human review can move a detection to a `confirmed` state;
   detectors themselves emit `open` at a risk level and never `confirmed`.
5. **Incident Center** — ✅ **Extend** the existing `Incident` model + incidents
   page (additive columns), do not build a parallel surface.
6. **Brand Protection discovery** — ✅ Accept the honest limitation: official
   signals + inbound content + manual reporting only, **no scraping**, for v1.
7. **RBAC mapping** — read (`security:view` / `incident:view`) = Analyst+; manage
   (`security:manage` / `incident:manage`) = Admin+ / Owner.

**Approved to start: S0 foundations** (schema, RBAC, gated shell — no detectors,
no change to existing modules).

---

---

## 7. Implementation log

### S0 — Foundations ✅ code-complete (migration NOT applied)

Landed (typecheck + lint + i18n-check all green):

- **core:** `packages/core/src/security.ts` (new) — `SecurityScoreScope`,
  `SecurityScoreDimension`, `SecurityDetectionSubjectType`,
  `SecurityDetectionKind`, `SecurityDetectionStatus`, `BrandProtectionKind/Source/Status`,
  `IncidentCategory`, `IncidentLifecycleStatus`, audit-event names; exported from
  `index.ts`. Permissions `security:view/manage`, `incident:view/manage` in
  `permissions.ts` (read = Analyst+, manage = Admin+/Owner). `securitySuite`
  entitlement in `entitlements.ts` (growth+ = true, same tier as `incidents`).
- **db:** three tenant-scoped models — `SecurityScoreSnapshot`,
  `SecurityDetection`, `BrandProtectionCase` — with composite `(id, tenantId)`,
  Tenant/Brand cascade relations, reused `RiskLevel`/`Platform` enums. Migration
  `20260729090000_s0_security_suite` (tables + FKs + indexes generated offline via
  `prisma migrate diff`, then the RLS strict-table `tenant_isolation` block
  appended by hand + `tamanor_app` grant). `prisma generate` OK.
- **web:** `"Security"` nav group + `Security Center` item (`src/lib/nav.ts`),
  `security` shield glyph (`nav-icons.tsx`), gated shell
  `src/app/dashboard/security/page.tsx` (`requireDashboardCapability("securitySuite")`
  → `CapabilityLockedState`; honest placeholders, queries none of the S2–S4
  tables). `securitySuite` label in `capability-locked.tsx`. i18n keys
  (`dashboardNav.securityCenter`, `dashHeaders.security`, plus inline page COPY)
  across en/sk/de.
- Incident model deliberately untouched (its additive columns land in S3).

### Local database & S0 end-to-end test (applied locally only)

The workspace `.env` `DATABASE_URL`/`APP_DATABASE_URL` point to a **remote Supabase
instance** — never used here. A **local-only Postgres** was set up instead:

- `docker-compose.local.yml` (root) — `postgres:16-alpine`, host port **5433**, DB
  **`tamanor`**, superuser `postgres` (schema owner / migrations), runtime role
  `tamanor_app` (NOSUPERUSER/NOBYPASSRLS, created by the RLS migration).
- Local URLs live in the git-ignored `.env.local`:
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/tamanor?schema=public`,
  `APP_DATABASE_URL=postgresql://tamanor_app:tamanor_app@localhost:5433/tamanor?schema=public`.
- db-package commands are run local-first:
  `pnpm --filter @guardora/db exec dotenv -e ../../.env.local -e ../../.env -- <prisma…>`
  (so the remote `.env` never wins). **No migration was ever run against the remote
  DB.**

Applied locally: all 52 migrations (incl. `20260729090000_s0_security_suite`) via
`prisma migrate deploy`, `prisma generate`, minimal seed (tenant `dev`, user
`dev@guardora.ai` owner).

**Verified (all green):** typecheck (8/8), lint, i18n-check (1983 keys). New tables
exist with **RLS ENABLED + FORCE** and the strict `tenant_isolation` policy;
`tamanor_app` is NOSUPERUSER/NOBYPASSRLS. Empirical isolation: context A→own rows,
context B→own rows, no-context→0 (fail-closed), cross-tenant INSERT→blocked. RBAC
runtime: owner/admin/analyst/reviewer see `/dashboard/security`; **viewer denied**
(`Forbidden: role "viewer" lacks "security:view"`). Entitlement runtime:
growth/agency/enterprise→unlocked shell, starter/free_trial→`CapabilityLockedState`.
EN/SK/DE localized. 9 existing dashboard routes still 200 (no regression). Project
suites on local DB: `entitlements`, `entitlement-limits`, `rls-isolation`,
`rls-runtime`, `web-rls`, `worker-rls`, `referential-integrity`, `protection-score`,
and `rls-security` (37/37 on a throwaway DB — its dynamic invariant *"every
app-granted tenantId table has RLS ENABLED + FORCED"* now covers the 3 new tables).
Production build OK (`/dashboard/security` compiled).

To preview the unlocked shell, set the active tenant's plan to growth+ (the seed
`dev` plan → truthful locked state, the intended default S0 behavior).

**Start/stop local DB:** `docker compose -f docker-compose.local.yml up -d` /
`… down` (add `-v` to wipe).

---

*Prepared in the Tamanor R&D lab. No production (Guardora) code touched.*
