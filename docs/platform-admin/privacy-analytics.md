# Tamanor Privacy Analytics V1

First-party, **privacy-preserving** website analytics for Tamanor-owned pages and flows. It is Tamanor's own
server-stored analytics — **distinct** from the third-party provider bridge (GA4 / Meta Pixel) in
`packages/core/src/analytics.ts`. It stores **only** anonymous, low-cardinality, bounded signals.

## Event allowlist (server-controlled)

Clients can **never** submit a free-form event name. The allow-list (`ANALYTICS_EVENT_TYPES`):
`PAGE_VIEW`, `SESSION_START`, `SESSION_END`, `CTA_CLICK`, `REGISTRATION_STARTED`, `REGISTRATION_COMPLETED`,
`LOGIN_COMPLETED`, `CONTACT_FORM_STARTED`, `CONTACT_FORM_SUBMITTED`, `INTEGRATION_CONNECT_STARTED`,
`INTEGRATION_CONNECT_COMPLETED`, `PRICING_VIEWED`, `DOCS_VIEWED`, `ERROR_PAGE_VIEWED`.

Conversion events (`REGISTRATION_COMPLETED`, `LOGIN_COMPLETED`, `CONTACT_FORM_SUBMITTED`,
`INTEGRATION_CONNECT_COMPLETED`) are recorded **server-side** from successful domain actions and are **rejected**
if a browser tries to submit them.

## Prohibited data (never captured or stored)

Raw IP, precise geolocation (city/postal/lat/long/ASN/ISP), raw query strings, raw referrer URLs, long-term
raw user-agent, form fields, message content, email/name/phone, Child Safety data, tenant-private content,
cookies/session tokens, device fingerprints (canvas/webgl/fonts/screen/hardware/battery/plugins), advertising
identifiers (adid/gclid/fbclid/clickid), DOM/keystroke/mouse data, and arbitrary metadata JSON. Enforced by a
recursive prohibited-key guard (`analyticsContainsProhibitedKey`) and a strict field allow-list.

## Identifier rotation

Visitor and session identifiers are **server-derived, keyed (HMAC-SHA256), non-reversible pseudonyms**. The
keyed secret comes from `TAMANOR_ANALYTICS_HASH_KEY` (server-only; **never** exposed to the client). Raw
first-party tokens are hashed and **discarded** — never persisted. The **visitor** hash includes a **monthly**
salt, so it **rotates monthly** and is non-linkable across months. Sessions expire after 30 minutes of
inactivity. Identifiers are **never** shown in any admin API or UI.

## Transient IP processing

If an IP is available, it is processed **server-side only** for **coarse country** (and bot/security
classification) and **immediately discarded** — never persisted, never logged, never shown. Only a two-letter
`countryCode` is stored; if reliable country derivation is unavailable (e.g. locally) it is `UNKNOWN` and no
data is invented.

## URL & referrer normalization

- **Paths**: pathname only (query + fragment dropped); per-entity id / email / token / UUID / long-opaque
  segments collapsed to `:id`; length + segment count bounded; a final guard rewrites anything still
  resembling an email/token to `/:id`.
- **Referrers**: stored as a **category** only (`DIRECT`, `ORGANIC_SEARCH`, `SOCIAL`, `REFERRAL`, `EMAIL`,
  `PAID`, `INTERNAL`, `UNKNOWN`) derived from a validated host; the full referrer URL is never stored.
- **Campaign params**: bounded, allow-listed characters only (`[a-z0-9._-]`, ≤64 chars); click-ids and
  arbitrary query params are dropped.

## Device / browser / OS classification

Broad categories only, derived from the transient user-agent then discarded: device
(`DESKTOP/MOBILE/TABLET/BOT/UNKNOWN`), browser (`Chrome/Safari/Firefox/Edge/Other/Unknown`), OS
(`iOS/Android/macOS/Windows/Linux/Other/Unknown`). No fingerprinting inputs are ever read or stored.

## Consent

Integrates with the existing Consent Mode v2 framework (default **denied**). Collection modes: `ENABLED`,
`DISABLED`, `UNKNOWN`, `WITHDRAWN`.

- **Enabled**: first-party rotating visitor/session cookies (httpOnly, SameSite=Lax) → full analytics.
- **Disabled / Unknown**: **essential mode** — only aggregate `PAGE_VIEW` / `ERROR_PAGE_VIEWED` counting via a
  coarse **daily anonymous bucket** (no persistent visitor identification, no cross-day tracking). Non-essential
  events (CTA, campaigns, conversions linkage) are not persisted.
- **Withdrawn**: future non-essential collection stops and existing analytics cookies are **expired**; no
  identifier is silently reactivated.

> If no consent framework applied for a given user, analytics run conservatively (essential-only); this does
> not by itself establish legal compliance — see the privacy-policy note below.

## Bot handling

Bounded classification (`HUMAN_LIKELY`, `KNOWN_BOT`, `SUSPECTED_BOT`, `UNKNOWN`) from known server-side bot
signatures / missing browser characteristics — **no fingerprinting**. Bots are stored in the warehouse (as a
dimension) but **excluded by default** from the admin dashboard; they can be shown separately. Exact defensive
thresholds (rate limits, bot heuristics) are internal and never revealed in the UI or docs.

## Low-count suppression

Admin group-by reports **suppress groups below 5** and report the number of suppressed groups, so tiny cells
are never exposed.

## Retention

- **Raw events**: max **90 days** (`RAW_RETENTION_DAYS`). Deleted in bounded batches; conversion-idempotency
  guards beyond the window are expired too. Each run is recorded (auditable, content-free).
- **Daily aggregates**: retained up to **24 months** (`AGGREGATE_RETENTION_DAYS`); they contain **no raw
  identifiers**.

## Retention & aggregation execution

Deterministic + idempotent + concurrency-safe. Run locally / manually or from a production scheduler:
```
pnpm analytics:maintenance [--days 2]
```
This runs aggregation for a recent window then bounded retention. **This sprint changes no scheduler
configuration** — the command is the entry point a production scheduler should invoke. Analytics failures never
affect customer-facing requests.

## Analytics export controls

CSV export is a **separate capability** (`analytics.export`, owner/admin) distinct from `analytics.view`, and
every export is **audited**. Exports contain aggregated metrics only — no raw events, no identifiers.

## Privacy-policy update required before production activation

Before enabling this analytics in production, update the public privacy policy to describe first-party
analytics, the pseudonymous rotating identifiers, transient IP→country processing, retention windows, and the
consent model. Wire a real GeoIP (country-only) source and set `TAMANOR_ANALYTICS_HASH_KEY`. Do not activate
persistent identification without a lawful consent basis.
