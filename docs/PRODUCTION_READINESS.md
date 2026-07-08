# Guardora.ai — Production Readiness

This document tracks what is safe today, what a live read-only test looks like,
and what MUST be done before any action-enabled production launch.

## Operating modes

Guardora has three clearly-separated modes. Only the first two exist today.

### 1. Dev safe mode (default)

- `META_LIVE_SYNC=false`, no Meta credentials required.
- Connectors are placeholders / mock. "Run read-only sync" produces clearly
  labelled **MOCK** data.
- No OAuth, no external calls, no moderation actions.
- Use for local development and demos.

### 2. Live read-only mode (V1.4/V1.5)

- Real Meta App configured; `META_LIVE_SYNC=true`.
- Official OAuth → Page/IG selection → long-lived token → **read-only** Graph
  GET reads → ReputationItems (deduped).
- Token expiry monitor + reconnect flow + retry backoff.
- **Still no moderation actions.** The runtime hard-disables reply/hide/delete;
  approval workflow remains the gate; auto-execution stays off.
- Optional webhook-driven targeted read-only sync behind `META_WEBHOOK_SYNC`
  (default off) — never takes an action.

### 3. Future action-enabled mode (NOT built)

- Would allow executing approved hide/reply/delete against a platform.
- Requires, at minimum, everything in the TODO below plus a per-brand opt-in, an
  expanded approval audit, and a staged rollout. **Not enabled in any current
  version.**

## Safety invariants (all modes today)

- No scraping, no client passwords — official OAuth/API only.
- Tokens are never shown in the UI, never logged, never in the audit trail.
- `reply` / `hide` / `delete` always return `disabled` at the runtime.
- Auto-execution is off; every action would still require human approval.
- Unsupported / failed operations never present as success.

## Token storage modes (V1.9)

Token persistence goes through the seam in `@guardora/db`
(`encryptToken` / `decryptToken`), selected by `TOKEN_ENCRYPTION_MODE`:

| Mode | Use | Format | Production |
| --- | --- | --- | --- |
| `plaintext` | dev only | `plain:v1:…` | **BLOCKED** — `encryptToken` throws in `NODE_ENV=production` |
| `aes-gcm` | single-key prod | `aesgcm:v1:iv:tag:ct` | OK with `TOKEN_ENCRYPTION_KEY` (base64, 32 bytes) |
| `kms` | managed prod | `kms:v1:…` | Skeleton — throws until a KMS provider is wired |

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
The production checklist (`/dashboard/accounts/meta/test`) surfaces the current
mode and whether it is production-safe. Onboarding-session tokens should move to
the same seam before launch.

## Production TODO (before action-enabled launch)

- [x] **Encrypted token storage seam** — `aes-gcm` (AES-256-GCM) implemented;
      production rejects plaintext. **TODO:** wire a real **KMS provider**
      (AWS KMS / GCP KMS / Vault) behind the `kms` mode, add key rotation, and
      encrypt onboarding-session tokens too.
- [ ] **Meta App Review** — obtain approval for the exact read scopes in use
      (`pages_read_engagement`, `instagram_manage_comments`, …). Verify scopes
      against current official Meta documentation.
- [x] **Rate-limit classification** — `MetaGraphError.kind === "rate_limit"` →
      transient backoff (`nextRetryAt` / `syncAttempts`), `sync.rate_limited`
      audit, "Retry later" in the UI. **TODO:** global token budget + jitter.
- [ ] **Observability** — structured logging, metrics (sync durations, error
      rates, queue depth), tracing, and alerting on health degradation and
      `sync.failed` / `sync.token_expired` / `sync.permission_error` spikes.
- [ ] **Backups & retention** — automated Postgres backups, tested restores, and
      data retention / deletion policy for content and audit logs.
- [ ] **Incident response** — runbooks for token compromise (revoke + rotate),
      webhook signature failures, mass permission loss, and a kill-switch to
      disable live sync / connectors instantly.
- [ ] **Action-enable gating** — per-brand opt-in, expanded approval audit, and a
      staged rollout before any real hide/reply/delete is permitted.

## Related docs

- [META_SETUP.md](./META_SETUP.md) — connect a real Meta App (read-only).
- [SECURITY.md](./SECURITY.md) — security & compliance principles.
- [API_CONNECTORS.md](./API_CONNECTORS.md) — connector runtime & modes.
