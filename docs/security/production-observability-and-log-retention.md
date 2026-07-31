# Production Observability & Log Retention — Operator Runbook

**Status: PREPARED, NOT ACTIVATED.** This runbook is for an authorized operator. Nothing here is configured by
the repository; no provider was changed. The 2026-07 download incident could not be timeline-correlated because
runtime logs had expired — this runbook closes that gap for the future. **No child content or secrets are ever
shipped to a log destination.**

## 1. What to centralize (least privilege, EU residency, redaction)

| Source | Signal | How |
|---|---|---|
| Vercel | Function/Edge/Build logs, static-export access | **Log Drain** (Observability → Log Drains) to a supported EU destination, or a self-hosted collector in an EU region. Prefer the JSON drain. |
| Vercel | Deployment / alias / domain / env-change events | Vercel **Audit Log** (Team settings) + deploy webhooks. |
| Supabase | Auth, API (PostgREST), Storage, Postgres logs | Supabase **Log Drains** / Logflare export to an EU destination. |
| GitHub | Workflow runs + **audit log** (deploys, secret changes, membership) | GitHub audit-log streaming (org) or periodic export. |
| Google / Meta / Turnstile | Config/tag-container change history | Provider-native change history; export monthly. |
| App | Structured ops events (`emitOpsEvent`) + safe diagnostics (`emitSafeLog`) already emitted to stdout | Captured by the Vercel drain — they are pre-redacted. |

All destinations must be **EU-resident**, **encrypted in transit + at rest**, and receive **redacted** payloads
only (the app already redacts; do not add raw-body logging). A **signed drain** (shared secret / signature
header) is required so forged log delivery is rejected.

## 2. Retention targets (proposal)

- **Operational/security searchable logs:** **≥ 30 days** (minimum for incident correlation).
- **Redacted security + deployment events** (auth, admin, deploy, alias, config change, provenance/readiness
  failures, WAF): **target 90 days**.
- **Immutable aggregates** (counts, no PII): longer only after privacy/legal approval.
- **Coverage:** capture **100%** of security/admin/deployment events where feasible; **controlled sampling** is
  acceptable only for high-volume performance logs (never for security/audit events).

## 3. Correlation & alerting

- A single **correlation id** (already minted by `newCorrelationId`/`resolveCorrelationId`) threads a request →
  its ops events. Ensure the drain preserves it.
- The release **commit SHA** is available at `/api/platform/release` and in `emitSafeLog` lines — pin each log
  batch to a deployed SHA for "what was running when" queries.
- Alerts (operator-configured, not in repo): auth-failure spikes, `release.provenance.invalid`,
  `cron.unauthorized`, readiness 503s, WAF blocks, any `attachment`/binary response from a public path, a new
  deployment/alias/env change outside the sanctioned workflow.

## 4. Operational guardrails

- **Signed drain delivery**, a **health check** on the drain, a **failure alert** if delivery stops, a **test
  receipt** after setup (send a synthetic event, confirm arrival redacted), **cost guardrails** (budget +
  sampling caps on performance logs), a documented **rollback** (disable drain, revert destination), and a
  **monthly access review** of who can read logs.
- **Never** log: raw request bodies/queries, Authorization/Cookie headers, tokens/secrets, DB URLs, child
  messages/evidence, email/phone/IP, or raw tenant/user ids (only pseudonymous forms where policy already
  requires). The app enforces this; the destination must not re-introduce it via ingest transforms.

## 5. Activation checklist (operator)

1. Provision an EU log destination; enable encryption + access control.
2. Configure the Vercel Log Drain (signed) + Supabase drain + GitHub audit streaming.
3. Send a test event; confirm it arrives **redacted**.
4. Set retention (30/90-day) + cost guardrails.
5. Configure the alerts in §3.
6. Record the drain endpoints (names only) in the access review; schedule the monthly review.
7. Mark observability **activated** only after the test receipt + alert test both pass.
