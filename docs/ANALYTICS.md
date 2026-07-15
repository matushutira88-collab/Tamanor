# Tamanor — Analytics Foundation (V1.53)

Privacy-safe, GDPR-ready, **Consent Mode v2** product analytics. The infrastructure is fully wired but
**dormant** until production provider IDs are pasted into environment variables. No advertising,
remarketing, or personalized ads are implemented — only the secure foundation for future GA4 / Meta
Pixel / Google Ads.

## What ships today
- **Nothing loads or tracks** until (a) `NEXT_PUBLIC_VERCEL_ENV=production` (or `NODE_ENV=production`
  off Vercel) **and** (b) a provider ID is set **and** (c) the visitor grants consent.
- Preview deployments and local dev **never** track.
- A single client API: `track("event_name", { safe: "labels" })`.
- Consent Mode v2: all signals default to **denied**; the cookie banner becomes a real Accept/Decline
  consent gate the moment an analytics ID is configured.

## Environment variables (paste at launch — no code change)
| Var | Provider | Format | Effect when unset |
|---|---|---|---|
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Google Analytics 4 | `G-XXXXXXXXXX` | GA4 not loaded |
| `NEXT_PUBLIC_META_PIXEL_ID` | Meta Pixel | numeric, e.g. `123456789012345` | Pixel not loaded |
| `NEXT_PUBLIC_GOOGLE_ADS_ID` | Google Ads (conversions) | `AW-XXXXXXXXX` | Ads/gtag not loaded |
| `NEXT_PUBLIC_VERCEL_ENV` | (auto-set by Vercel) | `production`/`preview`/`development` | falls back to `NODE_ENV` |

All are **public** (`NEXT_PUBLIC_`), safe in the browser bundle — they are IDs, not secrets. A
malformed value is ignored (treated as "not configured"), so a bad paste can never break the page.

### How to add a GA4 ID
1. In GA4 → Admin → Data Streams → your web stream → copy the **Measurement ID** (`G-…`).
2. Vercel → Project → Settings → Environment Variables → add `NEXT_PUBLIC_GA_MEASUREMENT_ID`,
   scope **Production**. Redeploy.

### How to add a Meta Pixel
1. Meta Events Manager → your Pixel → copy the numeric **Pixel ID**.
2. Add `NEXT_PUBLIC_META_PIXEL_ID` (Production). Redeploy.

### How to add Google Ads
1. Google Ads → Tools → Conversions → your conversion → copy the **Conversion ID** (`AW-…`) and the
   per-conversion **label**.
2. Add `NEXT_PUBLIC_GOOGLE_ADS_ID` (Production). Redeploy.
3. Fire a conversion **only** from an explicit call site: `trackConversion("<conversion-label>")`.
   Nothing fires automatically.

### How to enable production tracking
Tracking is on when: env is production **and** at least one ID is set **and** the visitor clicks
**Accept** in the consent banner. Until then everything is a no-op.

## Consent Mode v2
Defaults (set in the head before `gtag('config')`, via the dataLayer queue):
```
analytics_storage = denied
ad_storage        = denied
ad_user_data      = denied
ad_personalization = denied
```
On **Accept** the state is updated to `granted` (persisted in `localStorage` under
`tamanor_analytics_consent`) and pushed to both gtag (`consent update`) and the Meta Pixel
(`fbq('consent','grant')`). On **Decline** it stays denied. The choice is re-applied on every load.

## Using the API
```ts
import { track } from "@/lib/analytics/track";

track("registration_started");
track("checkout_started", { plan: "growth", interval: "monthly" });   // safe labels only
```
`page_view` is automatic (initial load + every SPA route change) via `AnalyticsProvider`.
For a "viewed" event on a server page, drop in the mount tracker:
```tsx
import { TrackView } from "@/components/analytics/track-view";
<TrackView event="pricing_viewed" />
```
For submit intent on a form button:
```tsx
<SubmitButton trackEvent="checkout_started">Subscribe</SubmitButton>
```

## Supported events (catalogue)
Type-safe in `@guardora/core` (`AnalyticsEventName`). Wired live today: `dashboard_opened`,
`pricing_viewed`, plus automatic `page_view`. The rest are callable via `track("<name>")` at their
natural call site.

- **Auth:** `registration_started`, `registration_completed`, `login`, `logout`, `password_reset`
- **Onboarding:** `workspace_created`, `brand_created`, `team_member_added`
- **Meta:** `meta_connect_started`, `meta_connect_completed`, `facebook_page_connected`, `instagram_connected`
- **Billing:** `checkout_started`, `checkout_completed`, `subscription_started`, `subscription_upgraded`, `subscription_cancelled`
- **Product:** `dashboard_opened`, `comment_reviewed`, `comment_replied`, `bulk_action_used`, `approval_completed`
- **Marketing:** `contact_form_sent`, `book_demo`, `pricing_viewed`

Meta Pixel standard-event mapping (internal): `registration_completed → CompleteRegistration`,
`checkout_started → InitiateCheckout`, `checkout_completed → Purchase`, `subscription_started →
Subscribe`, `book_demo`/`contact_form_sent → Lead`, `meta_connect_completed → Contact`. Others are
sent as custom events.

## How to verify events
1. Set the GA4 ID in a **production** deployment, accept consent.
2. GA4 → Admin → **DebugView** (or the Realtime report) shows `page_view` and each `track()` event.
3. Meta Pixel: install the **Meta Pixel Helper** browser extension → it lists PageView + events.
4. Google Ads: use **Tag Assistant** to confirm the `AW-…` tag and any fired conversion.
5. Network tab: requests to `www.google-analytics.com/g/collect` (GA4) and `facebook.com/tr` (Pixel)
   appear **only after** Accept.

## Privacy (hard guarantees)
`sanitizeAnalyticsParams` (in `@guardora/core`) runs on **every** event and drops:
- forbidden keys (anything containing `email`, `token`, `user`, `tenant`, `session`, `auth`,
  `password`, `secret`, `jwt`, `cookie`, `comment`, `message`, `content`, `text`, `name`, `refresh`,
  `access`, `bearer`, `credential`, `key`, `ip`, `phone`, `address`, …),
- PII/secret-shaped values (emails, JWTs, bearer tokens, `postgres://` URLs, Stripe keys, long hex),
- non-primitive values, and strings > 64 chars.

**Never sent:** email, access/refresh token, JWT, `tenantId`, `userId`, comment/message text,
cookies, authorization headers. Only anonymous, low-cardinality labels reach a provider.

## Architecture
- `packages/core/src/analytics.ts` — pure, shared: the event catalogue (`AnalyticsEventName`),
  Consent Mode v2 constants, the Meta standard-event map, and the privacy filter. No browser deps.
- `apps/web/src/lib/analytics/` — client runtime: `config.ts` (env/gating), `consent.ts` (Consent Mode
  v2 + persistence), `track.ts` (the single `track()` / `trackConversion()` / `trackPageView()` API),
  `types.ts` (typed `gtag`/`fbq`).
- `apps/web/src/components/analytics/` — `analytics-provider.tsx` (loads providers + SPA page_view),
  `track-view.tsx` (mount tracker).
- `apps/web/src/components/cookie-consent.tsx` — adaptive informational-notice ↔ consent gate.
- CSP (`apps/web/next.config.mjs`) allowlists the GA/Meta script + connect origins; no eval, no
  third-party frames.
