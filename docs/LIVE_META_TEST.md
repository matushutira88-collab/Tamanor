# Live Meta read-only test — runbook & results

This is the step-by-step for validating Guardora against a **real Meta App**, in
**read-only** mode, plus a place to record the outcome. No moderation actions are
performed at any point; the runtime keeps reply/hide/delete disabled and the
approval workflow remains the gate.

## Prerequisites

- A Meta App (Business) with **Facebook Login**, and a Facebook Page you admin
  (optionally linked to an Instagram Business account). See
  [META_SETUP.md](./META_SETUP.md).
- App Review for the read scopes in use (verify against current Meta docs).
- Env configured (no secrets in this doc):
  - `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`,
    `META_WEBHOOK_VERIFY_TOKEN`, `APP_URL`
  - `META_LIVE_SYNC=true`
  - `TOKEN_ENCRYPTION_MODE=aes-gcm` + `TOKEN_ENCRYPTION_KEY` (do **not** use
    plaintext outside local dev)

## Procedure

1. Open **Dashboard → Accounts → Meta live test checklist**
   (`/dashboard/accounts/meta/test`). Confirm **Environment**, **Runtime
   readiness**, and **Production readiness** are green (token storage mode must
   be production-safe).
2. **Connect with Meta** on a brand → complete OAuth → **select the Page**
   (and optionally its IG Business account) → confirm.
3. Post a **test comment** on a recent Page post (and/or an IG media comment).
4. Open the connected account detail → **Run read-only sync**. Expect the run row
   to show the **live** badge (not mock).
5. Confirm the comment appears in the **Reputation Inbox** with an AI risk
   assessment. Verify **no** moderation action was taken and the token is not
   visible anywhere.
6. (Optional) Configure the webhook in the Meta App dashboard and confirm the
   verification succeeds and inbound events are stored (no actions taken).

## Result

- **Status:** ⏳ Not yet executed against a real Meta App. Blocked on Meta App
  registration + App Review. All read-only plumbing is implemented and verified
  with the mock fallback and safe-failure paths.
- Record here once run: date, App ID (last 4), Page connected (id last 4),
  fetched/created/deduped counts, and any issues.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Redirect error at Meta | `META_REDIRECT_URI` must EXACTLY match a Valid OAuth Redirect URI. |
| `?meta=config_missing` | One of app id / secret / redirect URI is unset. |
| `?meta=invalid_state` | CSRF state cookie missing/expired — restart the flow. |
| `?meta=token_exchange_failed` | Wrong app id/secret, or code/redirect mismatch. |
| `?meta=discovery_failed` | Missing permission grants or App Review for the scope. |
| `sync.token_expired` / Reconnect required | Long-lived token expired — click **Reconnect with Meta**. |
| `sync.permission_error` | A required scope wasn't granted/approved — reconnect and re-grant. |
| `sync.rate_limited` / "Retry later" | Transient Graph rate limit — the worker retries after backoff; no action needed. |
| Webhook verify fails (403) | `META_WEBHOOK_VERIFY_TOKEN` must match the token set in Meta → Webhooks. |
| Token storage check fails in prod | `TOKEN_ENCRYPTION_MODE=plaintext` is blocked in production — switch to `aes-gcm` (+ key) or `kms`. |

> Scopes, API versions, and App Review requirements change — always verify
> against the current official Meta documentation before going live.
