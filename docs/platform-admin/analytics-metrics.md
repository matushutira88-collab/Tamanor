# Analytics Metric Definitions V1

Deterministic definitions for every metric in the platform analytics dashboard. Because identifiers are
**rotating and consent-limited**, visitor/session metrics are **approximate** — the UI labels them accordingly
(e.g. "Approximate unique visitors"). Never claim exact precision.

All metrics are computed from the **daily aggregate warehouse** (`website_analytics_daily_aggregates`), grouped
by a full dimension tuple per UTC day. Bots (`KNOWN_BOT` / `SUSPECTED_BOT`) are **excluded by default**.

| Metric | Definition |
| --- | --- |
| **Page views** | Count of `PAGE_VIEW` events. |
| **Sessions** | Distinct `sessionIdHash` values in the range. |
| **Approximate unique visitors** | Distinct `visitorIdHash` values (rotating monthly + consent-limited → an estimate, not exact). |
| **New vs returning** | A visitor whose first observed day in the window equals the current day is *new*; otherwise *returning*. Approximate (rotation resets identity monthly). |
| **Bounce rate** | Sessions with **≤ 1 event** ÷ sessions × 100. |
| **Engaged sessions** | Sessions with **≥ 2 events** (`ENGAGED_SESSION_MIN_EVENTS`). |
| **Average session-duration band** | Sessions are bucketed (not exact seconds) — durations are reported as bands, never a precise per-user timeline. |
| **Top pages** | Page views grouped by `normalizedPath`, descending, low-count-suppressed. |
| **Top landing pages** | The first `PAGE_VIEW` path per session (entry). |
| **Top exit pages** | The last `PAGE_VIEW` path per session (exit). |
| **Referrer categories (acquisition)** | Page views grouped by `referrerCategory`. |
| **Campaign performance** | Sessions/conversions grouped by bounded `campaignSource`. |
| **Device categories** | Grouped by `deviceCategory`. |
| **Browser families** | Grouped by `browserFamily`. |
| **Operating systems** | Grouped by `operatingSystemFamily`. |
| **Country distribution** | Grouped by `countryCode` (coarse; `UNKNOWN` when unavailable). |
| **Language distribution** | Grouped by primary language subtag. |
| **Conversion counts** | Count of events whose `conversionContext ≠ NONE`, by conversion event type. |
| **Conversion rate** | Conversions ÷ sessions × 100. |
| **Registration funnel** | `REGISTRATION_STARTED` (started) → `REGISTRATION_COMPLETED` (completed, server-recorded); completion = completed ÷ started × 100. |
| **Contact funnel** | `CONTACT_FORM_STARTED` → `CONTACT_FORM_SUBMITTED`. |
| **Integration-connect funnel** | `INTEGRATION_CONNECT_STARTED` → `INTEGRATION_CONNECT_COMPLETED`. |
| **Error-page views** | Count of `ERROR_PAGE_VIEWED`. |
| **Bot traffic** | Page views by `botClassification` (shown separately; excluded from the above by default). |

## Aggregation semantics

- One aggregate row per **(UTC date × full dimension tuple)**. Dimensions: `normalizedPath`, `eventType`,
  `referrerCategory`, `campaignSource`, `deviceCategory`, `browserFamily`, `operatingSystemFamily`,
  `countryCode`, `language`, `authenticatedUserState`, `botClassification`.
- Measures: `pageViews`, `sessions`, `approximateUniqueVisitors`, `conversions`, `bounces`, `engagedSessions`,
  `errorPageViews`.
- **Idempotent**: recomputing a day deletes and rebuilds that day's rows, so re-running yields identical
  results (safe to re-run; concurrency-safe).
- **Timezone**: aggregation buckets by **UTC day**.

## Approximate-visitor limitation

`approximateUniqueVisitors` counts distinct rotating `visitorIdHash` values. Because the visitor pseudonym
rotates **monthly** and consent-limited traffic uses a **shared daily anonymous bucket**, cross-month and
consent-limited counts undercount true uniques. Treat it as a trend estimate, not an exact user count.
