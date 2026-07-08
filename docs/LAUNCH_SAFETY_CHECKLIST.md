# Guardora.ai — Launch Safety Checklist

A gate before any public exposure. "Dev/demo ready" is met today; "Before public
launch" and the production sections are the remaining work. Nothing here enables
moderation actions — that is a separate, later phase (section E).

---

## A. Dev / demo ready ✅ (current state)

- [x] `pnpm -r typecheck` passes (8/8 packages).
- [x] `pnpm build` passes.
- [x] Landing, dashboard, inbox, accounts, insights, reports, case-studies render.
- [x] **Real Meta read-only sync verified** (Facebook Page → Graph API → Guardora
      → ReputationItem → Inbox; fetched 1 / created 1 / dedup works).
- [x] Moderation actions (reply/hide/delete) **disabled** at the runtime.
- [x] No fake claims (no "Meta approved", no fake partners/clients/KPIs).
- [x] No `[MOCK]` in customer-facing UI (internal seed marker only).
- [x] Demo data clearly labeled (sidebar **"Demo"** badge; case studies as
      **example scenarios**).
- [x] i18n: EN/SK/DE marketing renders; `pnpm i18n-check` PASS (dictionary key
      coverage, EN fallback).

### i18n QA before public launch

- [ ] Native review of SK and DE marketing copy (tone, terminology).
- [ ] DE (longer strings) verified across buttons/badges/nav on mobile.
- [ ] Trust pages (privacy/terms/security/about/contact/book-demo) translated or
      explicitly kept EN-only for launch.
- [ ] `hreflang` / locale metadata for SEO if marketing is multilingual at launch.

## B. Before public launch ⏳

- [ ] Production **domain** configured (`APP_URL` set to the real host).
- [ ] Real contact **emails** live: `hello@`, `security@`, `privacy@`.
- [ ] Final **privacy policy & terms** reviewed (remove draft notes).
- [ ] Automated **backups** (Postgres) with a tested restore.
- [ ] **Incident response** runbook (token compromise, mass permission loss,
      kill-switch to disable sync/connectors).
- [ ] **Monitoring / logs** (structured logging, sync durations, error rates).
- [ ] **Error reporting** (crash/exception capture).
- [ ] **Rate-limit handling** hardened (global budget + jitter on top of the
      existing `rate_limit` classification and backoff).
- [ ] **Production token storage** enabled (see section C).

## C. Token storage

- [ ] `plaintext` mode is **development only** (tagged `plain:v1:`).
- [ ] Production **must** use `aes-gcm` (with `TOKEN_ENCRYPTION_KEY`) or `kms` —
      `encryptToken` already **rejects plaintext when `NODE_ENV=production`**.
- [ ] Tokens are **never** written to the UI, logs, or audit.
- [ ] Key **rotation** plan in place.
- [ ] **Revoke / reconnect** flow works (expired/invalid token → reconnect
      prompt; no silent failures).

See [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) for the token-mode table.

## D. Meta production

- [ ] **Meta App Review** completed for the exact scopes in use.
- [ ] **Page read scopes** approved (e.g. `pages_show_list`,
      `pages_read_engagement`) — verify against current official Meta docs.
- [ ] **Webhook verification** configured (`META_WEBHOOK_VERIFY_TOKEN` matches).
- [ ] App switched from development to **live mode** as appropriate.
- [ ] **Privacy policy URL** set in the Meta app.
- [ ] **Data deletion callback** implemented if required by Meta.
- [ ] **Business verification** completed if required.

See [META_SETUP.md](./META_SETUP.md) and [LIVE_META_TEST.md](./LIVE_META_TEST.md).

## E. Moderation action enablement (LATER — not part of launch)

Moderation execution stays **disabled** until a dedicated action-enable phase:

- [ ] Separate **action-enable phase** (not bundled with launch).
- [ ] **Per-brand opt-in** required.
- [ ] **Approval required** before any execution.
- [ ] **Audit required** for every executed action.
- [ ] **Capability check** required (never fake success on unsupported actions).
- [ ] **Rollback / reversal** process defined where the platform allows it.
- [ ] **Rate-limit handling** for write calls.
- [ ] **Legal / safety review** signed off.

---

Related: [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) ·
[PRODUCT_STATUS.md](./PRODUCT_STATUS.md) ·
[PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) · [SECURITY.md](./SECURITY.md)
