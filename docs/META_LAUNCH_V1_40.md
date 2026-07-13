# Tamanor V1.40 — Meta Launch Package & Verification Runbook

Internal runbook (not served/indexed). **Never paste secrets, tokens or PII here.** Evidence
records reference IDs only. Live states stay `verification_pending` until a real run supplies proof.

## Current configuration (from code/audit — no secret values)

| Item | Value |
|---|---|
| Graph API version | **v21.0** (`META_GRAPH_VERSION`) |
| OAuth redirect | `META_REDIRECT_URI` (set) — `…/api/connectors/meta/callback` |
| Default dev scopes | `public_profile, email` (minimal) |
| Read scope set | `pages_show_list, pages_read_engagement, instagram_basic, instagram_manage_comments, business_management` |
| Token encryption (dev) | `plaintext` (dev only) — **production requires `aes-gcm` + `TOKEN_ENCRYPTION_KEY`** |
| Flags (dev) | `META_LIVE_SYNC=true`, `META_WEBHOOK_SYNC=false`, `FACEBOOK_HIDE_ENABLED=true`, `INSTAGRAM_AUTO_HIDE_ENABLED=false` |
| App mode / App Review / Business verification | **unknown to the agent** — read on the Meta dashboard |

## Scope inventory & minimization (§C)

| Scope | Feature requiring it | App Review needed | Keep/remove |
|---|---|---|---|
| `pages_show_list` | Page discovery (`me/accounts`) | Yes | **Keep** |
| `pages_read_engagement` | Read Page/post comments | Yes | **Keep** |
| `instagram_basic` | Discover linked IG Professional account | Yes | **Keep** |
| `instagram_manage_comments` | Read IG comments | Yes | **Keep** |
| `pages_manage_engagement` | **Hide** Facebook comments (launch write) | Yes | **Add for write launch** (not in current read set) |
| `pages_manage_metadata` | Subscribe the Page to webhooks | Yes | **Add for webhooks** |
| `business_management` | Currently in read set | Yes | **Review — remove if IG discovery works via the Page's `instagram_business_account` field without it.** Do not request unless a live test proves it is required. |

Request the **minimum** set that the live tests prove necessary. Do not request write/webhook scopes until those features are being launched.

## App Review package (§C) — no fake evidence

- **Feature description:** Tamanor monitors comments on a business's own Facebook Page and linked Instagram Professional account, classifies risk (spam/scam/harassment), and lets an authorized human approve hiding a harmful comment. Read-only by default; no automatic execution.
- **Reviewer flow (screencast checklist):** connect via OAuth → grant scopes → select Page (no auto-pick) → see linked IG → run read sync → view classified comments → approve a hide on a **test** comment → show audit entry → disconnect (tokens removed).
- **User value:** protects a brand's reputation without watching every channel by hand.
- **Data use:** stores OAuth tokens (encrypted at rest) + public comments/reviews only; never passwords; never sold.
- **Deletion/disconnect:** disconnecting removes local tokens and blocks future sync; historical content retained per policy.
- **URLs:** privacy `https://tamanor.com/privacy`, terms `https://tamanor.com/terms`, data-deletion instructions `https://tamanor.com/privacy` (document the exact deletion path before submission).
- **Test credentials:** provide reviewer access to a **test** Page/IG via Meta's reviewer flow — never publish credentials in this repo.

## Business verification checklist (§D) — owner action

- [ ] Legal company name • [ ] public domain `tamanor.com` • [ ] business email • [ ] privacy + terms live
- [ ] Domain verified in Business Manager • [ ] Business Manager owns the App, Page and IG account
- [ ] Contact details complete. Mark any missing item a **blocker** — do not fabricate.

## Evidence manifest template (§Q) — populate only from a real run

| Check | Timestamp | Environment | Asset type | Evidence ID | Result | Notes |
|---|---|---|---|---|---|---|
| oauth | | test | page | (audit id) | pending | |
| page_discovery (FB) | | test | page | (audit id) | pending | |
| instagram_discovery | | test | ig | (audit id) | pending | |
| read_sync (FB) | | test | page | (SyncRun id) | pending | |
| read_sync (IG) | | test | ig | (SyncRun id) | pending | |
| webhook (page) | | test | page | (webhook event id) | pending | |
| webhook (instagram) | | test | ig | (webhook event id) | pending | |
| hide_write (FB) | | test | page | (PlatformActionExecution id) | pending | |
| permission_revoke | | test | page/ig | (audit id) | pending | |
| token_expiry / reconnect | | test | page | (audit id) | pending | |
| disconnect / reconnect | | test | page/ig | (audit id) | pending | |

Evidence IDs are internal (audit / SyncRun / webhook / execution). No tokens, no PII, no raw Graph bodies.

## Launch checklist (§R) — owner path from now → launch-ready

### Before App Review
- [ ] Domain verified; privacy/terms live; business verification done; reviewer test assets ready; scopes minimized; screencast recorded; reviewer instructions written.

### Before live read
- [ ] Live OAuth verified (state check, no auto-pick, encrypted token, no leak) → Page selected → IG linked → connector health verified → enable `META_LIVE_SYNC` (prod `aes-gcm` tokens only).

### Before webhooks
- [ ] Public HTTPS callback → verify challenge → Page + Instagram subscriptions → signature verified → replay tested → enable `META_WEBHOOK_SYNC` (requires app secret).

### Before provider write (hide)
- [ ] `pages_manage_engagement` approved → **test Page only** → manual approval required → auto-hide OFF → rollback ready → kill switch ready.

### Before first customer
- [ ] Provider-truth copy matches evidence → monitoring on → support contact live → reconnect + incident procedures documented → all launch flags default-safe.

## Automatic-hiding safety (§K)

Launch in phases: **Phase 1** observe/classify only → **Phase 2** proposals + human approval → **Phase 3** narrowly-scoped auto-hide for phishing/scam/explicit-threat at high confidence under an approved tenant policy, with dry-run/rate-limit/daily-cap/kill-switch/audit/rollback. **Never** auto-hide negative sentiment, low ratings, or refund/pricing/delivery complaints or legitimate criticism.

## Runtime production safety (§O) — enforced by `metaProductionSafety()`

Production is unsafe (live features must stay disabled / fail-closed) when any of:
`live_sync_without_oauth_config`, `webhook_sync_without_app_secret`, `e2e_test_mode_enabled_in_production`, `token_encryption_not_production_safe`, `hide_enabled_without_safe_tokens`. Verified by `meta-launch:test`.
