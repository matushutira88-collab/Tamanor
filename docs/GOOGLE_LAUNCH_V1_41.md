# Tamanor V1.41 — Google Business Profile Launch Package & Verification Runbook

Internal runbook (not served/indexed). **Never paste secrets, tokens, authorization codes or PII.**
Evidence records reference IDs only. Live states stay `verification_pending` until a real run proves them.

## Current configuration (from code/audit — no secret values)

| Item | Value |
|---|---|
| OAuth scope | `https://www.googleapis.com/auth/business.manage` — **minimal, nothing broader** |
| Redirect | `GOOGLE_BUSINESS_REDIRECT_URI` — `…/api/connectors/google-business/callback` |
| Client ID / secret | via `GOOGLE_BUSINESS_CLIENT_ID` / `GOOGLE_BUSINESS_CLIENT_SECRET` (never printed) |
| API flag | `GOOGLE_BUSINESS_API_ENABLED` (a flag is **not** provider approval) |
| Token encryption | dev `plaintext`; **production requires `aes-gcm` + key** |
| Capability | review **READ only** — no reply, delete, or manipulation |
| Consent screen / API approval | **unknown to the agent** — read on the Google Cloud console |

## Google Cloud / OAuth readiness checklist (§C) — owner action

- [ ] Google Cloud project • [ ] OAuth consent screen (app name, support email, authorized domains)
- [ ] Privacy policy URL `https://tamanor.com/privacy` • terms `https://tamanor.com/terms`
- [ ] Authorized redirect URI matches `GOOGLE_BUSINESS_REDIRECT_URI` • [ ] domain verified
- [ ] Offline access (refresh token) enabled • [ ] test users added (test mode) → then publish
- [ ] Client ID + secret stored as deployment secrets (never in Git) • [ ] scope = `business.manage` only

## GBP API access readiness (§D) — owner action

- [ ] Enable the Google Business Profile API for the project
- [ ] Complete the **approved access** request (GBP API requires an access grant beyond enabling)
- [ ] Confirm quota + endpoints: account management, locations, reviews
Until approved: launch state stays `api_access_unconfirmed`, live review sync stays **disabled** (fail-closed).

## Approval package (§E)

- **Product:** Tamanor monitors a business's own Google reviews (reviewer, star rating, text) into one inbox with risk context.
- **Why GBP access:** to read the business's own location reviews for reputation monitoring.
- **Exact use case:** read-only review sync. **No** review deletion, **no** manipulation, **no** automated reply, **no** fake ratings.
- **Data minimization:** only reviewer display name (location-scoped), rating, text, timestamps, location/account IDs. No global reviewer identity; anonymous stays anonymous; rating-only stays rating-only.
- **Tenant isolation:** PostgreSQL RLS. **Token encryption:** refresh/access tokens encrypted at rest, never logged/shown/audited.
- **Disconnect:** removes local tokens, blocks future sync, retains history.
- **Reviewer flow (screencast):** connect → consent shows only `business.manage` → select account (no auto-pick) → select location (no auto-pick) → verified-location gate → run read sync → view reviews → disconnect.
- **URLs:** privacy, terms, data-deletion (document the exact deletion path before submission). No fabricated reviewer evidence.

## Verification status (evidence-driven — all pending)

| Capability | State | Evidence | Result |
|---|---|---|---|
| Live OAuth | verification_pending | none | pending |
| Account discovery | verification_pending | none | pending |
| Location discovery | verification_pending | none | pending |
| Verified-location gate | verification_pending (unit-verified via `isLocationSyncEligible`) | none live | pending |
| Live review sync | verification_pending | none | pending |
| Token refresh / expiry | verification_pending | none | pending |
| Disconnect | verification_pending | none | pending |
| Reconnect | verification_pending | none | pending |
| Rate-limit / error | verification_pending | none | pending |
| **launchReady** | **false** | 0 evidence | pending |

## Evidence manifest template (§R) — populate only from a real run

| Check | Timestamp | Environment | Google project | Account/location type | Evidence ID | Result | Notes |
|---|---|---|---|---|---|---|---|
| oauth | | test | | account | (audit id) | pending | |
| account_discovery | | test | | account | (audit id) | pending | |
| location_discovery | | test | | verified location | (audit id) | pending | |
| verified_location | | test | | verified location | (audit id) | pending | |
| live_review_sync | | test | | verified location | (SyncRun id) | pending | |
| refresh_token | | test | | account | (audit id) | pending | |
| disconnect | | test | | account | (audit id) | pending | |
| reconnect | | test | | account/location | (audit id) | pending | |
| rate_limit | | test | | location | (audit id) | pending | |

Evidence IDs are internal (audit / SyncRun / ConnectedAccount / ContentItem). No tokens, no PII, no raw review text/bodies.

## Owner runbook (§S) — current state → launch-ready

1. **Google Cloud setup:** project, OAuth consent, authorized domain, redirect URI, client credentials, test users, publish.
2. **GBP access:** enable API, request approved access, confirm quota + support process.
3. **Test asset:** a Google account with access to a real Business Profile with a **verified** location and ≥1 review.
4. **Live verification (record evidence per step):** OAuth → account selection (no auto-pick) → location selection (no auto-pick) → verified state → review sync → pagination → token refresh → disconnect → reconnect → rate-limit/error behavior.
5. **Launch:** enable flags one by one (`GOOGLE_BUSINESS_API_ENABLED`, then live sync); update the central provider truth from evidence; enable monitoring; document support + reconnect + incident procedures; complete the evidence manifest.

## Runtime production safety (§T) — enforced by `googleProductionSafety()`

Production is unsafe (live review sync must stay disabled / fail-closed) when any of:
`api_enabled_without_oauth_config`, `token_encryption_not_production_safe`, `e2e_test_mode_enabled_in_production`.
Plus per-connection gates: a location must be `verified` (`isLocationSyncEligible`) and an account/location must be explicitly selected — else no sync, truthful status, safe audit reason. Verified by `google-launch:test` + `google-business-connector:test`.

## SyncRun status + normalized reasons (§M — already implemented)

`success | partial_success | failed | skipped_locked | disconnected | permission_missing | rate_limited | api_unavailable`, with reasons
`google_business_api_access_unconfirmed | permission_missing | location_unverified | location_missing | rate_limited | token_expired | invalid_response | sync_failed`.
