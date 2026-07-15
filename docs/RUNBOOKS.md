# Tamanor — Production Incident Runbooks (V1.46/47)

Operational runbooks for the on-call engineer. **Privacy first:** never paste tokens, encrypted token
envelopes, `Authorization` headers, app secrets, provider response bodies, raw webhook payloads, lead/user
PII, or customer content into tickets, chat, or logs. All diagnostic commands below return **counts,
statuses, and normalized classifications only** — never secrets or personal data.

**Signals** come from structured ops events (`emitOpsEvent`, catalog in `@guardora/core/observability`)
and the in-process metrics registry (`metrics`). **Health/readiness:** `GET /api/health` (liveness),
`GET /api/ready` (DB + RLS + runtime-config + token-encryption + session-config; **provider outage does
NOT fail readiness**).

Token lifecycle mode is **MODE B (monitor + controlled reconnect)** — Meta Page tokens cannot be
independently refreshed and the long-lived User token is not retained, so there is **no automatic
renewal**; expiring tokens are flagged for reconnect.

---

## 1. Meta token expiry / reconnect required
- **Detection:** ops `provider.token_expired` / `provider.token_expires_soon`; metrics `token_expired_total`,
  `reconnect_required_total`, gauge `accounts_reconnect_required`; account UI shows "Reconnect required".
- **Severity:** P2 isolated; **P1** if `accounts_reconnect_required` spikes across many tenants at once.
- **Containment:** none required — sync for the affected account is intentionally stopped (no silent outage).
- **Diagnostics (safe):** `GET /api/ready`; count reconnect-required accounts (status only, no tokens).
- **Recovery:** the tenant Owner/Admin re-runs the existing Meta OAuth reconnect flow; the token monitor's
  disconnect-guarded CAS ensures a stale monitor write cannot overwrite a successful reconnect.
- **Verification:** account health returns to `healthy`; `accounts_reconnect_required` drops.
- **Escalation:** if a mass spike correlates with a Meta app/permission change, notify platform owner.
- **Privacy:** never log/store the token, its expiry precision, or provider error bodies.

## 2. Meta rate-limit / provider outage
- **Detection:** ops `provider.rate_limited`; elevated `provider_call_duration`; sync failures for one platform.
- **Severity:** P2 (provider-scoped). **Readiness stays green** — provider outage degrades sync only.
- **Containment:** the connector already backs off; do not manually retry-storm.
- **Diagnostics:** `sync_failures_total{platform=...}`, `provider_call_duration` histogram.
- **Recovery:** wait out the provider window; sync resumes automatically on the next tick.
- **Verification:** `sync_failures_total` stops climbing; new `SyncRun` rows complete.
- **Escalation:** if sustained hours, check Meta platform status; notify product.
- **Privacy:** no request URLs with tokens; no provider bodies.

## 3. Webhook signature spike
- **Detection:** ops `webhook.signature_invalid`; metric `webhook_invalid_signature_total` climbing.
- **Severity:** P2; **P1** if the rate is sustained above threshold (possible forged-delivery / probing).
- **Containment:** invalid-signature events are **stored but never processed** — no action taken from them.
- **Diagnostics:** `webhook_invalid_signature_total` vs `webhook_received_total`.
- **Recovery:** verify `META_APP_SECRET` matches the app; a config drift causes valid deliveries to fail
  verification. Rotate/realign the secret if drifted.
- **Verification:** invalid rate returns to baseline.
- **Escalation:** if malicious volume, apply edge rate-limiting at the ingress.
- **Privacy:** never log the signature header, raw body, or payload.

## 4. Webhook backlog / processing failures
- **Detection:** ops `webhook.processing_failed`; gauge `pending_webhooks` rising; `sync.failed`.
- **Severity:** P2.
- **Diagnostics:** count unprocessed signature-valid rows; check `META_WEBHOOK_SYNC` flag.
- **Recovery:** the worker drains on each tick; ensure the worker is running (runbook 5). A minimized
  (payload-expired) row is terminally marked `payload_expired` and skipped — this is expected, not a bug.
- **Verification:** `pending_webhooks` falls; processed count rises.
- **Escalation:** if backlog grows unbounded, check worker health + DB load.
- **Privacy:** never log payloads.

## 5. Worker not running / maintenance failing
- **Detection:** ops `worker.fatal` / `worker.maintenance_failed`; no recent `tick.start`; backlogs rising.
- **Severity:** **P1** (maintenance, retention, token monitor, and deletion-resume all stop).
- **Containment:** restart the worker process; RLS preflight is fail-closed (it refuses to start on a
  superuser/BYPASSRLS role — check `APP_DATABASE_URL`).
- **Diagnostics:** `GET /api/ready` (DB/RLS); worker boot logs; `worker.preflight.*`.
- **Recovery:** fix the flagged config (RLS role / `APP_DATABASE_URL`) and restart.
- **Verification:** `tick.start`/`tick.done` resume; backlogs drain.
- **Escalation:** platform on-call if the process cannot start.
- **Privacy:** logs carry error **names/classes** only, never stacks with infra detail.

## 6. Tenant deletion stuck
- **Detection:** ops `tenant.deletion_failed`; gauge `pending_tenant_deletions` not draining; a tenant stuck `deleting`.
- **Severity:** **P1** (a workspace cannot complete deletion).
- **Containment:** the worker `resumePendingTenantDeletions` retries idempotently each tick (system context,
  no session) — confirm the worker is running (runbook 5).
- **Diagnostics:** count tenants in `deleting` older than the stale threshold; the `TenantDeletionReceipt`
  `failureClass` (normalized, no PII).
- **Recovery:** resolve the flagged failure class (provider/DB); the next resume tick completes it.
- **Verification:** the tenant row is gone; receipt `status = completed`.
- **Escalation:** platform on-call if a specific operation repeatedly fails.
- **Privacy:** receipts/logs carry opaque ids + counts only — no tenant name/PII.

## 7. Database / RLS readiness failure
- **Detection:** ops `rls.health_failed` / `db.unavailable`; `GET /api/ready` → 503; worker refuses to boot.
- **Severity:** **P1/P0** (tenant isolation + serving at risk).
- **Containment:** readiness is **fail-closed** — the app sheds traffic (503) rather than serve unsafely.
- **Diagnostics:** `GET /api/ready` `checks[]` (status strings only); confirm the runtime role is the
  non-superuser `tamanor_app` (RLS enforced), not the owner.
- **Recovery:** restore DB reachability / fix `APP_DATABASE_URL` to the RLS-enforcing role; re-check `/api/ready`.
- **Verification:** `/api/ready` → 200 `healthy`; `rls_runtime = healthy`.
- **Escalation:** DBA / platform owner.
- **Privacy:** readiness returns **no** DB URL, role, or credential.

## 8. Encryption configuration failure
- **Detection:** `/api/ready` `token_encryption = misconfigured` in production.
- **Severity:** **P1** (tokens must be encrypted at rest).
- **Containment:** do not connect new provider accounts until fixed (plaintext storage is rejected in prod).
- **Diagnostics:** `tokenStorageStatus()` via readiness (status only).
- **Recovery:** set a valid `TOKEN_ENCRYPTION_MODE` (aes-gcm/kms) + key; redeploy.
- **Verification:** `/api/ready` `token_encryption = healthy`.
- **Escalation:** security owner.
- **Privacy:** never print the encryption key or any token envelope.

## 9. Retention maintenance failure
- **Detection:** ops `webhook.retention_failed`; retention counters (`retention_minimized_total`,
  `retention_deleted_total`) flat while backlog grows.
- **Severity:** P2 (raw payloads may persist longer than intended).
- **Containment:** retention failures are isolated (they do **not** crash provider sync).
- **Diagnostics:** worker `webhook.retention.failed` (error **name** only); confirm the worker runs.
- **Recovery:** fix the flagged DB issue; the next tick resumes bounded `SKIP LOCKED` batches idempotently.
- **Verification:** `retention_minimized_total`/`retention_deleted_total` advance; old payloads null out.
- **Escalation:** if raw PII retention exceeds policy, notify privacy owner.
- **Privacy:** never log payloads or ids; counts only.

## 10. Lead / user erasure failure
- **Detection:** ops `lead.erasure_failed` / `user.erasure_failed`; an erasure operation returns an error.
- **Severity:** **P1** (a data-subject erasure may be incomplete).
- **Containment:** erasure is a single atomic transaction — a failure rolls back entirely (no partial state).
- **Diagnostics:** the erasure receipt (`LeadErasureReceipt` / `UserDeletionReceipt`) — operation id + count
  + mode only; a missing receipt means the operation did not commit.
- **Recovery:** re-run the authorized erasure (idempotent/convergent — a repeat matches 0 and is truthful).
- **Verification:** the target rows are gone; a receipt exists with the expected count.
- **Escalation:** privacy owner if a DSR SLA is at risk.
- **Privacy:** receipts/logs carry **no** email/name/company/message/notes and **no email hash**.

---

### Email verification & password reset (V1.50C)
- **Delivery:** set `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + a verified `EMAIL_FROM`, and
  `APP_BASE_URL` (one-time links). Unconfigured → flows report "temporarily unavailable" (never a
  fake success); email/password sign-up still creates the account (unverified).
- **Symptoms:** spike in `auth.email_delivery_failed` → the provider/key is misconfigured or the
  provider is down. Verification/reset links won't arrive. Fix env; users can resend.
- **Verification gate:** unverified email/password users are held on `/verify-email` (no dashboard);
  OAuth provider-verified users pass immediately. A password reset **revokes all sessions**.
- **Token cleanup:** the worker maintenance tick deletes expired/consumed verification + reset tokens
  in bounded batches; a failure emits `auth.token_cleanup_failed` and never blocks auth or sync.
- **Privacy:** no email, raw token, token hash, or reset/verification URL is ever logged or emitted.

### Integration point (production configuration required)
No external alerting vendor is wired. Ops events emit a safe structured log line by default; wire a
vendor sink at startup via `setOpsSink(...)` (payload already redacted). Alerting should **aggregate**
(threshold + cooldown) — e.g. page on a *spike* in `accounts_reconnect_required` /
`webhook_invalid_signature_total` / `pending_tenant_deletions`, not on each isolated event. Metrics are
in-process; a scrape/exporter reading `metrics.snapshot()` is a future integration point.
