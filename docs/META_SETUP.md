# Meta (Facebook + Instagram) setup — read-only

This guide connects a **Facebook Page** (and its linked **Instagram Business**
account) to a Guardora brand using official Meta OAuth, **read-only**. No
moderation actions are performed; the approval workflow remains the security
gate and actions stay disabled.

> ⚠️ **Scopes & product access change.** The exact permissions, API versions, and
> App Review requirements below MUST be verified against the current official
> Meta documentation before going live. Treat this file as a checklist, not a
> source of truth for Meta's policies.

## What you need

- A Meta App (type: Business) from <https://developers.facebook.com/apps>.
- The **Facebook Login** product added to the app.
- A Facebook Page you administer, optionally linked to an Instagram Business
  account.

## Permissions / scopes (verify against Meta docs)

Guardora requests only read-oriented scopes, and **which** scopes are requested
is controlled by the `META_OAUTH_SCOPES` env var (comma-separated). If unset, a
**safe minimal dev scope** is used so a first OAuth test always works without any
Page/Instagram/business permissions or App Review.

Request scopes your app is actually allowed to use — otherwise Meta rejects the
login with **"Invalid Scopes"**. Add them in three tiers:

| Tier | `META_OAUTH_SCOPES` | Needs |
| --- | --- | --- |
| **Local OAuth smoke test** (default) | *(unset)* → `public_profile,email` | nothing |
| **Page read-only test** | `public_profile,email,pages_show_list,pages_read_engagement` | those Page permissions on the app |
| **Instagram comments** | add `instagram_basic,instagram_manage_comments,business_management` | permissions + App Review per current Meta docs |

| Scope | Why |
| --- | --- |
| `public_profile`, `email` | Minimal login — proves the OAuth round-trip works. |
| `pages_show_list` | List the Pages the user manages (discovery). |
| `pages_read_engagement` | Read Page posts and comments. |
| `instagram_basic` | Read basic IG Business account info. |
| `instagram_manage_comments` | Read IG comments (read-only). |
| `business_management` | Resolve Page ↔ IG Business links. |

No publish/hide/delete scopes are ever requested. The current requested scopes
are shown on the setup checklist (`/dashboard/accounts/meta/test`).

## Checklist

1. **Create a Meta App** (Business type) and add **Facebook Login**.
2. **Set the redirect URI** in Facebook Login → Settings → *Valid OAuth Redirect
   URIs*:
   ```
   http://localhost:3000/api/connectors/meta/callback
   ```
   (use your real domain in production).
3. **Fill env** (`.env`), then restart the app:
   ```bash
   META_APP_ID=<your app id>
   META_APP_SECRET=<your app secret>
   META_REDIRECT_URI=http://localhost:3000/api/connectors/meta/callback
   META_WEBHOOK_VERIFY_TOKEN=<any random string you also set in Meta>
   META_LIVE_SYNC=false   # keep false until you're ready for live reads
   # Leave unset for the first smoke test (uses public_profile,email).
   # For a Page read-only test:
   # META_OAUTH_SCOPES=public_profile,email,pages_show_list,pages_read_engagement
   ```
4. **Start the app**: `pnpm dev` (and `pnpm dev:worker` if you want background sync).
5. **Sign in** at <http://localhost:3000/login>.
6. **Connect Meta**: Dashboard → Connected Accounts → *Connect with Meta* on a
   brand (create a brand first if you have none).
7. **Select a Page**: on `/dashboard/accounts/meta/select`, pick a Page and
   optionally its Instagram Business account, then confirm.
8. **Run read-only sync**: open the account detail and click *Run read-only
   sync*. With `META_LIVE_SYNC=false` this uses a clearly-labelled **MOCK**
   fallback; set `META_LIVE_SYNC=true` for live Graph reads.

## Webhooks (optional)

Configure in Meta App → Webhooks:

- **Callback URL**: `https://<your-domain>/api/webhooks/meta`
- **Verify token**: the same value as `META_WEBHOOK_VERIFY_TOKEN`

Guardora verifies the subscription (`GET`), validates the
`X-Hub-Signature-256` signature (`POST`) using the app secret, and stores raw
events in `webhook_events`. **No automatic moderation action is taken** from
webhooks. The account detail page shows the current webhook configuration status.

## Enabling live read-only sync

Once a real Page is connected:

1. Set `META_LIVE_SYNC=true` in `.env` and restart the app.
2. Open the connected account → **Run read-only sync**.
3. The **live** badge appears on the run row (vs. **mock**). Guardora fetches
   recent Page/IG comments via Graph GET reads only, maps them to
   `ReputationItem`s, and dedups by `(connectedAccountId, externalId)`.
4. High-risk items are routed into the approval queue. **No** hide/reply/delete
   is ever executed — the runtime keeps actions disabled.

With `META_LIVE_SYNC=false` (default), *Run read-only sync* uses a clearly
labelled **MOCK** fallback so the flow is testable without live credentials.

### Doing a real Page test

1. Complete the checklist above with a real Meta App + a Page you administer.
2. Post a test comment on a recent Page post (and/or an IG media comment).
3. `META_LIVE_SYNC=true`, restart, run the sync, and confirm the comment shows
   up in the Reputation Inbox with an AI risk assessment.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Redirect error at Meta | `META_REDIRECT_URI` must EXACTLY match a *Valid OAuth Redirect URI* in Facebook Login settings (scheme, host, port, path). The setup checklist flags it as **invalid** if the path/origin is wrong. |
| `?meta=config_missing` | One of `META_APP_ID` / `META_APP_SECRET` / `META_REDIRECT_URI` is unset. See the checklist. |
| `?meta=invalid_state` | CSRF state cookie missing/expired — restart the flow (don't reuse an old callback URL). |
| `?meta=token_exchange_failed` | App id/secret wrong, or the code/redirect mismatch. No account is created. |
| `?meta=discovery_failed` | Graph read of Pages failed — usually missing permission grants or App Review. |
| `?meta=no_pages` | The Meta account manages no Pages, or none were granted. |
| No Instagram Business linked | The selected Page has no linked IG Business account — the flow still works for Facebook; the selection UI shows "No Instagram Business account linked". |
| `sync.token_expired` / "Reconnect required" | Long-lived token expired or was invalidated. Click **Reconnect with Meta**. |
| `sync.permission_error` | A required scope wasn't granted / approved. Reconnect and re-grant, and check App Review status for the scope. |
| Webhook verify fails | `META_WEBHOOK_VERIFY_TOKEN` in `.env` must match the verify token entered in Meta → Webhooks. The `GET` echoes the challenge only on an exact match (otherwise 403). |

## Reconnect & token expiry

Long-lived Page/user tokens eventually expire. Guardora handles this proactively:

- A worker **token expiry monitor** runs each tick:
  - **≤ 7 days to expiry** → account health becomes *degraded*, `lastError` is set
    to `Reconnect recommended`, and `token.reconnect_recommended` is audited.
  - **already expired** → account status becomes *expired*, health *degraded*,
    `lastError` = `Reconnect required`, and `token.expired` is audited.
- The account detail page shows a **Reconnect required** banner with a
  **Reconnect with Meta** button. Reconnecting re-runs OAuth for the same brand
  and **updates the existing account** (no duplicate is created — accounts are
  unique per `brand + platform + external id`).
- A failed live sync also flags the account for reconnect and records a
  conservative retry backoff (`syncAttempts`, `nextRetryAt`) — the worker skips
  the account until then. Tokens are never logged during any of this.

The **live test checklist** at `/dashboard/accounts/meta/test` summarizes env,
brand, connected accounts, token health, and last sync — all without showing
any secret values.

## Security notes

- Tokens are stored **server-side only** and are never shown in the UI, logged,
  or written to the audit trail.
- In development tokens are stored in plaintext for convenience. **In production
  they MUST be encrypted at rest** (KMS / envelope encryption). See
  [SECURITY.md](./SECURITY.md).
- If a token expires or a live read fails, the account is flagged
  **reconnect required** and the dashboard shows a *Reconnect with Meta* button.
- No scraping, no password flows — official OAuth/API only.
