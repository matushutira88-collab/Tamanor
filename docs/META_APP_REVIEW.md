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

Every row is derived from an actual code path in this repository. Access levels are **not** asserted — this
system cannot observe a Meta approval state, so approval must be read from the Meta App Dashboard.

| Permission | Tamanor feature | Code path | Why required | Reviewer action that demonstrates it | Login-time or later |
|---|---|---|---|---|---|
| `public_profile` | Facebook Login for the connect flow | `packages/connectors/src/meta/oauth.ts` (`buildMetaAuthUrl`), `apps/web/src/app/api/connectors/meta/callback/route.ts` | Base permission for Facebook Login; without it the OAuth dialog cannot complete. | Step 5–6: the Facebook dialog appears and returns to Tamanor. | Login |
| `pages_show_list` | Page discovery / asset selection | `packages/connectors/src/meta/discovery.ts` (`discoverMetaAccounts` → `/me/accounts`), classification in `apps/web/src/server/oauth/meta-callback-classify.ts` | Enumerates the Pages the person administers so they can choose which to connect. Declining it makes `/me/accounts` empty and the flow reports `missing_permission`. | Step 6: the Page selection screen lists the reviewer's Page. | Login |
| `pages_read_engagement` | Comment monitoring (read-only sync) | `packages/sync/src/index.ts` (`runReadOnlySync`), `packages/connectors/src/meta/content-transport.ts` | Reads public comments on the connected Page so they can be classified and shown in the inbox. | Step 11 (variant): open Comments and see synced Page comments. | Login |
| `pages_manage_engagement` | Comment moderation (hide) | `packages/ai/src/auto-protect.ts` (`FACEBOOK_HIDE_PERMISSION`), `packages/connectors/src/meta/facebook-hide.ts`, `packages/sync/src/meta-connector.ts` (`REQUIRED_PAGE_PERMISSION`) | The only live write action: hiding an abusive comment on the customer's own Page. Absence downgrades the account to `read_only` (`packages/db/src/dashboard-metrics.ts`). | Open an inbox item → the hide capability badge reads available; execute a hide if the operator enables live actions. | Login |
| `pages_manage_metadata` | Page-level `leadgen` webhook subscription | `packages/connectors/src/meta/leadgen-subscription.ts` (`POST /{page-id}/subscribed_apps`), `packages/sync/src/meta-leadgen-subscription.ts` | Subscribing a Page to the app for the `leadgen` field requires this permission. Without it Meta delivers no lead webhooks and the Lead Ads Testing Tool reports "Selected page has no app associated with it". | Step 8: the Page shows **Connected and Lead Ads ready**; Step 10 shows the Page as verified. | Login |
| `leads_retrieval` | Lead Ads ingestion | `packages/sync/src/meta-leads.ts` (`graphLeadFetcher` → `GET /{leadgen_id}`), `packages/sync/src/meta-leadgen-subscription.ts` (`LEADS_RETRIEVAL_PERMISSION`) | Reads the lead the customer's own form captured, so it appears in Contacts. Declining it leaves the Page connected for comments and the state reads `leads_permission_missing`. | Step 11: a test lead appears in Contacts. | Login (declinable — the flow degrades truthfully) |
| `instagram_basic` | Instagram account connection | `packages/sync/src/instagram-moderation.ts` (`IG_READ_PERM`), `packages/connectors/src/meta/discovery.ts` | Resolves the Instagram Professional account linked to the Page and reads its basic profile so it can be listed and connected. | Step 6: the linked Instagram account is offered as a selectable asset. | Login |
| `instagram_manage_comments` | Instagram comment moderation | `packages/sync/src/instagram-moderation.ts` (`IG_MODERATION_PERMS`) | Reads and moderates comments on the customer's own Instagram Professional account. | Open an Instagram account detail → the moderation capability state is shown truthfully. | Login |
| `business_management` | Business-asset discovery | `packages/connectors/src/meta/oauth.ts` (`META_READ_ONLY_SCOPES`) | Present in the read-only scope constant for Business-owned asset discovery. | See §9 — flagged for verification before submission. | Login |

**Requested vs. used.** `META_OAUTH_SCOPES` in Vercel Production is marked *Sensitive* and its value cannot be
read from the CLI or API. Before submission the operator must open the Meta App Dashboard / Vercel dashboard
and confirm the configured list matches `META_REQUIRED_SCOPES` in `packages/config/src/index.ts`. The
platform-admin readiness page (`/admin/meta-review`) reports per-scope configured booleans without printing the
value.

---

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
| `pages_read_engagement` | Page comments appear in the Comments inbox after the first sync. |
| `pages_manage_engagement` | The hide capability badge on the account reads available. |
| `pages_manage_metadata` | The Page reports *Lead Ads ready* / webhook verified on Connected platforms. |
| `leads_retrieval` | The test lead appears in Contacts. |
| `instagram_basic` | The linked Instagram account is offered and can be connected. |
| `instagram_manage_comments` | The Instagram account's moderation state renders truthfully. |

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
payload with the app secret, constant-time compare, algorithm pinned, `issued_at` freshness enforced) —
`packages/connectors/src/meta/signed-request.ts`. A forged, unsigned, malformed, stale or wrong-secret request
is rejected with `400` before any lookup or write.

**Deletion scope is exactly what the callback can prove.** The payload identifies an app-scoped user id whose
only authoritative mapping is the Facebook login link `OAuthAccount(provider="facebook", providerAccountId)`,
unique on that pair. That row is removed. Nothing else is:

- the Tamanor user account is **not** deleted (they may sign in by password or Google and may belong to a
  workspace shared with other people);
- no tenant, brand, membership, connected Page, Instagram account, credential or business contact is touched.

A connected Page records the Page, **not** which Meta user authorised it, so it can never be attributed to the
requester; deleting one on this signal would destroy an unrelated organisation's integration. This limit is
stated publicly on the deletion status page and enforced in
`packages/db/src/meta-identity-deletion.ts`.

Idempotency: the confirmation code is an HMAC of the identity, so a replayed callback returns the same code and
removes nothing further. Auditing is via ops events carrying a bounded outcome label only — no app-scoped user
id, e-mail, tenant or confirmation code.

**Reviewer credentials** are never stored in this repository. They are entered directly into the Meta App
Review form by the operator and rotated after review.

---

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
9. Decide whether `business_management` is genuinely required — see the blocker in §2/§10.
10. Provide reviewer credentials and the screencast; submit.

## 10. Open items flagged by the audit

- **`business_management`** appears only in the `META_READ_ONLY_SCOPES` constant
  (`packages/connectors/src/meta/oauth.ts`). No code path in this repository calls a Business-Manager-scoped
  endpoint that requires it. Meta rejects submissions for permissions without a demonstrable use, so either a
  concrete use must be demonstrated or the scope must be dropped from the request. **No scope was removed in
  this checkpoint** — this is reported, not acted on.
- The Production values of `META_APP_ID` and `META_OAUTH_SCOPES` are *Sensitive* in Vercel and could not be
  read programmatically; §9 items 1–2 remain operator verification steps.
