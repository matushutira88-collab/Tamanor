# Meta App Review — external-customer access evidence pack

Internal preparation document for submitting the Tamanor Business Meta integration for App Review and
Advanced Access. **Nothing in this document is submitted automatically** — submission is a manual action in the
Meta App Dashboard.

> **Contains no credentials.** No app secret, access token, verify token, app id value, Page id, tenant id,
> account id, reviewer password or personal data appears here or may ever be added. Reviewer credentials are
> shared out-of-band only (see §8) and must never be committed to Git, source, fixtures, logs or docs.

---

## 1. App and endpoint inventory

| Item | Value |
|---|---|
| Meta app ID | Stored as the `META_APP_ID` environment variable (Vercel Production, marked *Sensitive*). **Value not reproduced here.** |
| Production application URL | `https://tamanor.com` |
| OAuth redirect URL | `https://tamanor.com/api/connectors/meta/callback` |
| Webhook callback URL | `https://tamanor.com/api/webhooks/meta` |
| Privacy policy URL | `https://tamanor.com/privacy` |
| Terms of service URL | `https://tamanor.com/terms` (business: `/business-terms`, consumer: `/consumer-terms`) |
| User data deletion instructions URL | `https://tamanor.com/data-subject-rights` |
| Data deletion callback URL | `https://tamanor.com/api/meta/data-deletion` |
| Deauthorize callback URL | `https://tamanor.com/api/meta/deauthorize` |
| Deletion status URL (returned by the callback) | `https://tamanor.com/data-deletion?code=…` |

All public URLs above are outside the authentication middleware matcher (`/dashboard/:path*`) and render
without a session.

---

## 2. Permission-by-permission justification

Final justified scope set. Every row is backed by an actual Graph call in this repository. Access levels are
**not** asserted — this system cannot observe a Meta approval state.

| Permission | Tamanor feature | Code path | Exact endpoint | Reviewer action | When |
|---|---|---|---|---|---|
| `public_profile` | Facebook Login | `meta/oauth.ts`, `connectors/meta/callback` | OAuth dialog | Dialog completes and returns | Login |
| `pages_show_list` | Page discovery | `meta/discovery.ts` | `GET /me/accounts` | Reviewer's Page appears in selection | Login |
| `pages_read_engagement` | Page metadata + post reads | `meta/connector-transport.ts`, `adapters/meta-read-only-connector.ts` | `GET /{page-id}?fields=id,name`, `GET /{page-id}/feed` post fields | Account health reads as connected | Login |
| `pages_read_user_content` | Reading user comments on Page posts | `adapters/meta-read-only-connector.ts` | `GET /{page-id}/feed?fields=…comments{…,from{id,name}}` | Page comments appear in the inbox | Login |
| `pages_manage_engagement` | Comment moderation (hide) | `meta/facebook-hide.ts`, `ai/auto-protect.ts` | `POST /{comment-id}` `is_hidden=true` | Hide capability badge available | Login |
| `pages_manage_metadata` | Page `leadgen` webhook subscription | `meta/leadgen-subscription.ts` | `GET`/`POST /{page-id}/subscribed_apps` | Page shows Lead Ads ready | Login |
| `leads_retrieval` | Lead Ads ingestion | `sync/meta-leads.ts` | `GET /{leadgen_id}` | Test lead appears in Contacts | Login (declinable — degrades to comments-only) |
| `instagram_basic` | Instagram connection + comment reads | `meta/connector-transport.ts`, `meta/content-transport.ts` | `GET /{ig-user-id}?fields=id,username`, `GET /{ig-id}/media`, `GET /{media-id}/comments` | Linked Instagram account offered and connectable | Login |

**Not requested.** `business_management`, `pages_messaging` and `instagram_manage_comments` are deliberately
excluded — no shipped code path calls an endpoint requiring any of them. See §11 for the full reconciliation
and the production changes that follow from it.

## 3. Reviewer steps

1. Open `https://tamanor.com`.
2. Sign in with the reviewer credentials supplied out-of-band.
3. Enter the Business workspace prepared for review.
4. Open **Accounts** (`/dashboard/accounts`).
5. Press **Connect with Meta** → the Facebook dialog opens.
6. Approve the requested permissions and select the authorised Facebook Page (and, if present, its Instagram
   account).
7. Confirm the selection.
8. The Accounts page shows a **Meta connection result** summary with one line per outcome — for a fully
   granted Page: *Connected and Lead Ads ready*.
9. Open **Connected platforms** (`/dashboard/platforms`).
10. The Meta card shows *X of Y Facebook Pages ready* and one row per Page with its own state and last
    verification time. A Page whose webhook is not verified shows a **Connect Lead Ads webhook** button.
11. Submit a test lead from the Meta Lead Ads Testing Tool for that Page, then open **Contacts**
    (`/dashboard/contacts`) and confirm the lead appears.
12. Return to **Accounts** and press **Disconnect**. The account is removed locally and the Meta card returns
    to a not-connected state.

## 4. Screencast sequence

Record one continuous take, no cuts, screen only (never the credential entry itself):

1. `https://tamanor.com` landing → sign in.
2. Workspace selection → Business workspace dashboard.
3. `/dashboard/accounts` → **Connect with Meta**.
4. Facebook permission dialog — pause so each requested permission is legible.
5. Page/Instagram selection screen → confirm.
6. Accounts page → the per-Page connection result summary.
7. `/dashboard/platforms` → the *X of Y ready* summary and the per-Page rows.
8. Meta Lead Ads Testing Tool → create a test lead for the reviewer Page.
9. `/dashboard/contacts` → the test lead visible.
10. Open the contact detail → allow-listed fields only.
11. `/dashboard/accounts` → **Disconnect** → the connection is gone.

## 5. Expected visible result per permission

| Permission | What the reviewer must see |
|---|---|
| `public_profile` | The Facebook dialog completes and returns to Tamanor. |
| `pages_show_list` | The reviewer's Page appears in the selection list. |
| `pages_read_engagement` | The account health reads as connected after the first sync. |
| `pages_read_user_content` | User comments on Page posts appear in the Comments inbox. |
| `pages_manage_engagement` | The hide capability badge on the account reads available. |
| `pages_manage_metadata` | The Page reports *Lead Ads ready* / webhook verified on Connected platforms. |
| `leads_retrieval` | The test lead appears in Contacts. |
| `instagram_basic` | The linked Instagram account is offered and can be connected. |

---

## 6. Test-data preparation checklist

- [ ] A dedicated review tenant (Business workspace) containing **no production customer data**.
- [ ] A dedicated Facebook Page owned by Tamanor for review, plus a Lead Ads form on it.
- [ ] A linked Instagram Professional account on that Page, if Instagram permissions are in the submission.
- [ ] The reviewer user added to the review tenant with a role holding `connector:manage` and
      `business.platforms.manage` (Owner or Admin).
- [ ] `META_LEADS_APPROVED` and `META_WEBHOOK_SYNC` set appropriately in Production.
- [ ] Reviewer credentials generated fresh, shared **only** through the Meta App Review credential field, and
      rotated after the review closes.
- [ ] Verify at `/admin/meta-review` that every required scope shows as configured.

---

## 7. Data-handling evidence

**Lead data is tenant-isolated.** Leads are resolved from the trusted Page id to a tenant-scoped account, never
from the webhook payload: `packages/sync/src/meta-leads.ts` (`findMetaLeadAccountsByPageIds`, then
`ingestBusinessContact(account.tenantId, …)`). All tenant reads/writes go through `withTenantDb`, which sets
the Postgres RLS tenant context; the runtime connects as a non-superuser, non-`BYPASSRLS` role
(`APP_DATABASE_URL`). Cross-tenant targeting is rejected before any provider call — proven by
`packages/sync/scripts/meta-lead-multi-page-readiness.test.ts` and
`packages/sync/scripts/meta-lead-onboarding.test.ts`.

**Tokens are vault-only and server-only.** Connect/reconnect seals the Page token into the encrypted
`ProviderCredential` vault and verifies it decrypts before the account is considered usable
(`packages/sync/src/meta-connector.ts` → `writeMetaCredentialToVault`); it writes no legacy plaintext column.
Reads are vault-first and fail closed on a corrupt row (`packages/db/src/provider-credential-resolver.ts`). No
token is ever returned to the browser, placed in a URL, logged, or written to audit metadata — enforced by
`packages/db/scripts/vault-token-write-invariant.test.ts` and secret-hygiene assertions across the Meta suites.

**Arbitrary form answers are not stored.** `normalizeMetaLead` maps an explicit allow-list only — full name,
e-mail, phone, company, plus campaign/ad/form identifiers. Custom question answers are deliberately dropped and
no free-form message is persisted; consent is never inferred (`packages/sync/src/meta-leads.ts`). The requested
Graph field list is pinned by `packages/sync/scripts/meta-lead-detail-fields.test.ts`.

**Retention and deletion (as implemented today).**
- Webhook payloads are minimised/nulled by the retention job once past the maximum payload age
  (`packages/db/src/webhook-retention.ts`; the ingestion path handles `payload == null` terminally).
- Tenant deletion and user erasure paths exist (`packages/db/src/tenant-deletion.ts`,
  `packages/db/src/user-deletion.ts`).
- Disconnecting an account removes the whole local token-sharing cluster
  (`packages/sync/src/disconnect.ts`); Meta exposes no per-Page token revoke API, and the UI states this
  truthfully and links Facebook's own app-removal page.
- The Meta data-deletion callback removes the Facebook **login link** only — see §8.
- Contractual retention periods are stated in the published policies (`/data-retention`,
  `/data-subject-rights`); they are not restated here.

---

## 8. Data deletion and deauthorization callbacks

Both callbacks authenticate **solely** by verifying Meta's `signed_request` (HMAC-SHA256 over the encoded
payload with the app secret, constant-time compare, algorithm pinned, bounded parsing, `issued_at` freshness
enforced) — `packages/connectors/src/meta/signed-request.ts`. A forged, unsigned, malformed, stale or
wrong-secret request is rejected with `400` before any lookup or write.

**Credential authorization provenance.** `ProviderCredential.authorizingProviderUserId` records the Meta
app-scoped user id whose OAuth grant produced the credential **currently** stored for a Page or Instagram
account. It is resolved server-side during the OAuth callback (`GET /me?fields=id`), never submitted by the
browser, and rewritten on every store/rotate — so a reconnect by a different authorised person replaces it.
It holds no token and no ciphertext.

**What a callback does** (`revokeMetaAuthorization`, identical for deauthorize and data deletion):

1. revoke every **active** Meta credential whose current provenance is that identity;
2. mark the owning connected accounts `needs_reconnect` / `tokenHealth=revoked` /
   `requiresReconnectReason=provider_deauthorized`;
3. only **then** remove the Facebook login link, so a crash mid-way can never leave a usable credential behind.

After step 1 `resolveMetaAccessToken` fails closed for those accounts — a revoked vault row is never downgraded
to a legacy column read — so comment sync, moderation and Lead Ads fetching all stop. No provider HTTP is
required; the invalidation is local and immediate.

**Deliberately preserved**, because they are not the requester's data:

- the tenant's business contacts and leads (captured by the Page's own forms), comments, reputation items and
  audit history — claiming a Page-owned lead belongs to the authorising Facebook user would be false;
- the connected account rows themselves (kept but unusable until an authorised person reconnects);
- the Tamanor user account, memberships, tenants and brands;
- any credential whose provenance is a **different** Meta identity, including a Page whose credential was later
  replaced by another authorised person — a stale callback from the first person must not kill it.

**Known limit.** Credentials written before provenance existed carry `NULL` and are not attributable to any
identity; a callback never touches them. They can only be cleared by an in-product Disconnect. New and
reconnected credentials all carry provenance.

Idempotent and replay-safe: a repeat finds no active attributable credential and changes nothing. The
confirmation code is an HMAC of the identity, so a replay returns the same code. Auditing is ops events with a
bounded outcome label only — no app-scoped user id, e-mail, tenant, count or confirmation code.

**Reviewer credentials** are never stored in this repository. They are entered directly into the Meta App
Review form by the operator and rotated after review.

## 9. Remaining manual Meta dashboard actions

These cannot be performed or verified from this repository:

1. Confirm the Production `META_APP_ID` value matches the app being submitted (value is *Sensitive* in Vercel).
2. Confirm the Production `META_OAUTH_SCOPES` list matches `META_REQUIRED_SCOPES`.
3. Register the **Data Deletion Request URL** → `https://tamanor.com/api/meta/data-deletion`.
4. Register the **Deauthorize Callback URL** → `https://tamanor.com/api/meta/deauthorize`.
5. Confirm the **Privacy Policy URL**, **Terms of Service URL** and **User Data Deletion** instructions URL.
6. Confirm Webhooks → `Page` object → `leadgen` field is subscribed with the verified callback URL.
7. Complete **Business Verification** for the owning Business portfolio, then set
   `META_BUSINESS_VERIFICATION_ATTESTED=true`.
8. Request **Advanced Access** for each permission in §2, then set `META_ADVANCED_ACCESS_ATTESTED=true`.
9. **Remove `business_management` and `pages_messaging` from production `META_OAUTH_SCOPES`** — neither has a
   code path (see §11). Documented here only; Vercel was not modified.
10. Register the deletion/deauthorize URLs in the app's Facebook Login settings (items 3–4 above).
11. Provide reviewer credentials and the screencast; submit.

## 10. Open items

- Production `META_APP_ID` and `META_OAUTH_SCOPES` are marked *Sensitive* in Vercel and cannot be read
  programmatically. The production scope list in §11 is **operator-reported**, and items 1–2 of §9 remain
  operator verification steps.
- Pre-provenance credentials (`authorizingProviderUserId IS NULL`) are not attributable to a Meta identity and
  are therefore never invalidated by a callback — see the known limit in §8.

## 11. Scope reconciliation

Source of truth: `META_SCOPE_MATRIX` in `packages/config/src/index.ts`, asserted by
`meta-external-access:test`. "In code" means this repository's own `META_READ_ONLY_SCOPES` constant; the
production request is driven by `META_OAUTH_SCOPES`, so several genuinely-used scopes appear only there.

| Scope | In code | In production | Used by code | Exact endpoint / operation | Decision |
|---|---|---|---|---|---|
| `pages_show_list` | yes | yes | yes | `GET /me/accounts` — Page discovery | **keep** |
| `pages_read_engagement` | yes | yes | yes | `GET /{page-id}?fields=id,name`; `/{page-id}/feed` post metadata | **keep** |
| `pages_read_user_content` | yes (added) | yes | yes | `GET /{page-id}/feed?fields=…comments{…,from{id,name}}` — user-authored comments; `pages_read_engagement` alone covers only Page-owned content | **keep** |
| `pages_manage_engagement` | no | yes | yes | `POST /{comment-id}` `is_hidden=true` — the only live write | **keep** |
| `pages_manage_metadata` | no | yes | yes | `GET`/`POST /{page-id}/subscribed_apps` — leadgen subscription | **keep** |
| `leads_retrieval` | no | yes | yes | `GET /{leadgen_id}` — lead detail fetch | **keep** |
| `instagram_basic` | yes | yes | yes | `GET /{ig-user-id}?fields=id,username`; `/{ig-id}/media`; `/{media-id}/comments` | **keep** |
| `business_management` | **removed** | yes | **no** | No Business-Manager endpoint is called anywhere | **remove from production** |
| `pages_messaging` | no | yes | **no** | No conversation/message endpoint exists; Tamanor never reads or sends Page messages | **remove from production** |
| `instagram_manage_comments` | **removed** | no | **no** | Only a status reporter (`sync/instagram-moderation.ts`) plus a manual operator script — no shipped executor | **not requested** |

Reconciliation of the operator-reported production list against the required set:

- **Missing required:** none — all seven required scopes are present in production.
- **Unsupported extras:** `business_management`, `pages_messaging` → remove (manual dashboard action, §9 item 9).

Instagram comment **moderation** is not part of the submission. Instagram **reading** (`instagram_basic`) is.
