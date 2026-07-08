# Guardora.ai — Connector Approach

Every platform is integrated through the same **`PlatformConnector`** interface
(`@guardora/connectors`). The worker and moderation pipeline never call a vendor
SDK directly — only this interface. This keeps platforms swappable and the core
logic platform-agnostic.

## Unified interface

```ts
interface PlatformConnector {
  readonly platform: Platform;
  connect(auth: ConnectorAuthContext): Promise<void>;
  syncComments(options?: SyncOptions): Promise<SyncResult>;
  syncReviews(options?: SyncOptions): Promise<SyncResult>;
  reply(input: ReplyInput): Promise<ActionResult>;
  hide(ref: ContentRef): Promise<ActionResult>;
  delete(ref: ContentRef): Promise<ActionResult>;
  markResolved(ref: ContentRef): Promise<ActionResult>;
}
```

### Rules for adapters
- **Official OAuth / APIs only.** No scraping, no password login, no unofficial
  endpoints.
- **Capability honesty.** If a platform API cannot perform an action, return
  `{ ok: false, unsupported: true }` — never fake success, never throw for an
  unsupported capability. Declared capabilities live in `PLATFORM_META`.
- **One account per instance.** An adapter instance is bound to a single
  `ConnectedAccount`.
- **No destructive default.** The base placeholder makes no network calls and
  takes no real action.

## Capability matrix

| Platform | Comments | Reviews | Reply | Hide (API) | Delete |
| --- | :---: | :---: | :---: | :---: | :---: |
| Facebook Page | ✅ | ✅ | ✅ | ✅ | ✅ |
| Instagram Business | ✅ | — | ✅ | ✅ | ✅ |
| YouTube | ✅ | — | ✅ | ✅¹ | ✅ |
| LinkedIn Company | ✅ | — | ✅ | ❌ | ✅ |
| TikTok | ✅ | — | ✅ | ✅ | ✅ |
| Google Business | — | ✅ | ✅ | ❌² | ✅³ |

¹ Via comment moderation status. ² Reviews can be replied to / reported, not
hidden via API. ³ Delete applies to the brand's own reply.

## Per-platform mapping (target implementation)

### Meta — Facebook Page + Instagram Business (`MetaConnector`)
- API: Meta Graph API (official OAuth).
- syncComments: `GET /{object-id}/comments`; syncReviews (FB): `GET
  /{page-id}/ratings`.
- reply: `POST /{comment-id}/comments`; hide: `POST /{comment-id}
  {is_hidden:true}`; delete: `DELETE /{comment-id}`.

### YouTube (`YouTubeConnector`)
- API: YouTube Data API v3.
- syncComments: `commentThreads.list` / `comments.list`; reply:
  `comments.insert`; hide: `comments.setModerationStatus`; delete:
  `comments.delete`.

### LinkedIn (`LinkedInConnector`)
- API: LinkedIn Marketing / Community Management.
- syncComments: `socialActions/{urn}/comments`; reply: `POST` same; delete:
  `DELETE .../comments/{id}`; hide: **unsupported**.

### TikTok (`TikTokConnector`)
- API: TikTok Business / Display API.
- Comment list / reply / hide / delete via the comment-management endpoints.

### Google Business (`GoogleBusinessConnector`)
- API: Google Business Profile API.
- syncReviews: `accounts.locations.reviews.list`; reply:
  `...reviews.updateReply`; delete: `...reviews.deleteReply` (own reply); hide:
  **unsupported**.

## OAuth & tokens

- Each connector has its own OAuth app credentials (see `.env.example`).
- Tokens are obtained through the platform's official OAuth flow and stored on
  `ConnectedAccount` (encrypt at rest in production). Refresh is handled before
  sync; failures set status `expired` and prompt reconnect.

## Adding a new platform

1. Add a value to `Platform` + `PLATFORM_META` (capabilities) in `core`.
2. Add the enum value to the Prisma `Platform` enum.
3. Implement an adapter extending `BasePlaceholderConnector`.
4. Register it in `createConnector()`.
5. Add OAuth credentials to config + `.env.example`.

## Connector runtime & modes (V1.2)

Callers never use a raw adapter directly for execution — they go through
`createConnectorRuntime(platform, mode)`, which wraps the adapter in a
`ConnectorRuntime` that enforces the account's `ConnectorMode`:

| Mode | Sync | Actions | Real? | Meaning |
| --- | :---: | :---: | :---: | --- |
| `placeholder` | mock | ❌ | no | Mock/dev only. Sync yields labelled MOCK data. |
| `oauth_ready` | ❌ | ❌ | no | OAuth app configured; not yet connected. |
| `read_only` | live¹ | ❌ | yes | Connected via OAuth. Reads only. |
| `action_disabled` | live¹ | ❌ | yes | Connected; actions explicitly off. |

¹ Live reads require `META_LIVE_SYNC=true` and a stored token. **No mode enables
moderation actions in V1.2** — the runtime returns `{ ok:false, disabled:true }`.

## Meta OAuth (read-only) — V1.2

- **Official OAuth only.** Scopes are read-only: `pages_show_list`,
  `pages_read_engagement`, `instagram_basic`, `instagram_manage_comments`,
  `business_management`. No publish/manage-action scopes are requested.
- **Flow (V1.3, end-to-end).** `GET /api/connectors/meta/start?brandId=…` →
  (permission + config checks) build the dialog URL with a CSRF `state` cookie →
  Meta → `GET /api/connectors/meta/callback` → exchange code → **discover**
  Pages + linked IG Business accounts (`/me/accounts`) → store discovery
  (incl. per-page tokens) in a short-lived `MetaOnboardingSession` → redirect to
  **`/dashboard/accounts/meta/select`**. The user picks a Page (and optionally
  its IG Business account); only on confirm is a `read_only` `ConnectedAccount`
  created. Distinct error states: `denied`, `config_missing`, `oauth_denied`,
  `invalid_state`, `token_exchange_failed`, `discovery_failed`, `no_pages`. The
  callback NEVER creates a fake connection on error.
- **Reconnect.** If a token expires or a live read fails, the account flips to
  `expired` / degraded health and the detail page shows *Reconnect with Meta*.
- **Read-only sync** (`@guardora/sync` → `runReadOnlySync`): fetch comments →
  classify (AI + brand rules) → persist `ReputationItem`s, deduped by
  `(connectedAccountId, externalId)` → record a `SyncRun` → audit `sync.*`.
- **Webhooks.** `GET /api/webhooks/meta` verifies the subscription;
  `POST /api/webhooks/meta` validates the signature and stores the raw event
  (`webhook_events`). No automatic actions.

## Env vars (Meta)

`META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`,
`META_WEBHOOK_VERIFY_TOKEN`, `META_LIVE_SYNC` (feature flag, default `false`).
See `.env.example`. Tokens are never logged; production storage must be
encrypted at rest (see [SECURITY.md](./SECURITY.md)).

> **Current status:** Meta has a real read-only OAuth + sync runtime (behind
> config + `META_LIVE_SYNC`). All moderation actions remain disabled. Other
> platforms are still placeholder adapters.
