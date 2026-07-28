# Family Notification Center V1 (Phase 4A) — in-app center, shell bell & safe actions

The first Family in-app Notification Center, built **over the existing shared `Notification` model and the already
verified Family notification services** (no second table, no second repository, no second recipient resolver). It
continues [Phase 3](./family-notification-center-v1.md) — Phases 3A–3C wired all 13 triggers, the durable outbox,
the deterministic expiry evaluators and the authenticated scheduler; Phase 4A surfaces those notifications to the
Family recipient.

## Route

`/family/notifications` — inside the Family console route group (`apps/web/src/app/family/(console)/notifications/`),
so the group layout's `requireFamilyConsole()` guard applies: authenticated, active FAMILY workspace + membership,
`force-dynamic` (never cached, never static). The tenant + user come ONLY from the session actor — never from the
client. **Allowed query params:** `view=all|unread` and `cursor=<opaque>` only; both are safely normalized (an
unknown `view` → `all`; an invalid/forged `cursor` → first page, never a throw). No tenantId/userId/source id is
ever read from the URL.

## Reused services (no new DB layer)

The web layer calls ONLY the verified services (`@guardora/db`): `listFamilyNotifications`,
`familyUnreadNotificationCount`, `markFamilyNotificationRead`, `markAllFamilyNotificationsRead`,
`dismissFamilyNotification`, and a new narrow `loadFamilyNotificationTypeForOpen` (own-recipient type load for the
safe-open handler). The web NEVER queries or mutates `Notification` directly. `listFamilyNotifications` gained an
additive `beforeId` so the keyset is `(createdAt, id)` — rows sharing a `createdAt` are never skipped/duplicated.

## Safe projection

The route maps the service `FamilyNotificationView` to a pure client view model (`family-notification-view.ts`)
exposing only: `id`, `severity` (info/attention/urgent, derived from the catalogue — never `row.severity`),
`severityLabel`, `iconKey`, localized `title`/`message`, `read`, `createdAtISO`, `dismissible`, `ctaHref` (or
null), `unavailable`. It NEVER surfaces dedupeKey, tenantId, recipient/membership id, profileId, incident/signal/
delivery/invitation/consent/plan/outbox id, raw metadata, a raw type/enum, a raw reason code, or a metadata-derived
href. A malformed/unknown row degrades to a generic safe fallback.

## Pagination & filters

Bounded keyset: page size 20 (hard cap ≤50; the service also clamps), `ORDER BY createdAt DESC, id DESC`, opaque
base64url cursor `(createdAtMs, id)` with strict decode (any malformation → first page). Dismissed rows excluded;
own current-tenant Family rows only. Initial page is server-rendered; "Load more" appends via a bounded server
action (`fetchMoreFamilyNotificationsAction`) returning safe view models + the next cursor. No polling.
**Filters:** All (read + unread, excluding dismissed) / Unread (readAt IS NULL, excluding dismissed); a filter
change resets the cursor; the unread badge is the exact own-unread Family count. Selected state uses
`aria-current="page"` + underline/weight (never colour alone).

## Read / mark-all / dismiss / open

- **Mark one read** — `markFamilyNotificationRead`; the client submits only `notificationId`; own-recipient +
  tenant + Family-type + not-dismissed re-checked in the service; idempotent; cross-user/tenant/non-Family fail
  closed without enumeration; bounded result; center + bell revalidated; aria-live announced.
- **Mark all read** — `markAllFamilyNotificationsRead`; current user + tenant + Family types only, excludes
  dismissed; idempotent; hidden when unread is 0; Business/Cyberbullying/generic rows untouched.
- **Dismiss** — `dismissFamilyNotification`; own-recipient + tenant + a **dismissible** Family type only; soft
  (`dismissedAt`, never a hard delete); idempotent; removed from All + Unread; unread count updates; urgent/
  non-dismissible rejected **server-side** (the service is the dismissibility authority); no free-text reason; no
  source-domain mutation.
- **Urgent rule:** urgent, non-dismissible types (`family_urgent_signal`, `family_incident_created`,
  `family_incident_escalated`, `family_delivery_available`) never show or accept a dismiss control.

## Bell & 99+

The Family shell bell (`family-notification-bell.tsx`) is mounted only inside the Family console layout, uses
`familyUnreadNotificationCount(actor)`, and shows: 0 → no numeric badge; 1..99 → exact; ≥100 → "99+". The
aria-label + badge are computed **server-side** in the layout and passed as plain props; an unread-count failure
degrades to a no-badge bell (the shell never crashes, never leaks an error). Accessible label, keyboard/touch
reachable (desktop sidebar + mobile top bar), links to the center. **No** websocket/SSE/polling and **no**
auto-mark-read on open; the count refreshes on navigation/mutation (force-dynamic). No recent-notification popover
was added (no pre-existing safe reusable overlay pattern was reused) — a simple bell link is used.

## Safe CTA + current-access recheck

All 13 catalogue CTA routes are one of four **already-implemented** Family list pages
(`/family/signals|deliveries|invitations|authorizations`) — never an incident/protection-plan detail route (out of
scope) and never an entity id or query param. The client submits ONLY `notificationId`; the `openFamilyNotification`
server action narrow-loads the OWN notification's TYPE, derives the destination from the catalogue (never client
input / metadata href), re-validates it against the `IMPLEMENTED_FAMILY_CTA_ROUTES` allow-list, marks the row read
(documented policy: an explicit open is an acknowledgement), and redirects to the internal list page; any
unavailable/unauthorized/non-allow-listed destination falls back to the center with a bounded status. `javascript:`
/ `data:` / external / protocol-relative schemes can never reach a CTA (the route is catalogue-derived +
allow-listed).

## i18n

SK / EN / DE, co-located in `family-notifications-i18n.ts` (all 13 type titles/bodies + center/bell/severity
strings, plus the Phase 4A additions: `open`, `loadMore`, `viewAll`, `routeUnavailable`, `openFailed`). Parity +
content-free copy (no name/age/email/id/content) asserted by `family-notifications-i18n:test`.

## Accessibility & responsive

One `h1` (via `PageHeader`), a semantic `<ul>/<li>` list, `<time datetime>`, unread + severity communicated in
text + shape/icon (not colour alone), `aria-live="polite"` result region, real disabled states, explicit
`type="button"`/`type="submit"`, visible focus (`FAMILY_FOCUS`), focus moved to the first newly-appended item on
"Load more". Single-column cards, wrapping actions, no horizontal scroll, no dense admin table; the bell is
reachable on mobile. Accessible `loading.tsx` and `error.tsx` boundaries; the error boundary renders only a bounded
localized string (never the raw error / stack / Prisma / SQL).

## Privacy

No id/raw-metadata/content ever reaches the client; the view model is the sole projection. Bounded action
audit/ops events only where the shell convention emits them; list/bell views are not audited; no tenant/user/
profile/source id/email/route is logged.

## Tests

- `family-notification-center:test` (46 DB/action) — list/count/mark/mark-all/dismiss/open own-recipient +
  tenant + Family scoping, idempotency, cross-user/tenant/non-Family fail-closed, dismissed-not-revived,
  urgent-rejected, source-unchanged, and the safe projection (no dedupeKey/tenant/recipient/source ids/raw
  metadata).
- `family-notification-center-ui:test` (59 UI/source) — view-model/cursor/badge units + static invariants for the
  route/actions/center/bell/CTA/i18n/security.
- `family-notifications-source:test` extended to 93 (Phase 4A web-boundary section: no 2nd table/repo/resolver,
  services-only, no direct Notification mutation, no systemDb/outbox/scheduler/expiry in the UI, no incident/plan
  route, no preferences/email/push/SMS/webhook, no websocket/polling, no hard delete, service-enforced
  dismissibility, safe boundaries, Family-scoped bell).

Full gate green (all Family notification + child-safety + Business `notifications`/`notification-repo` +
Cyberbullying `cyberbullying-notifications-sla` suites). **No migration** was required — the existing
`notifications (tenantId, userId, dismissedAt, readAt, createdAt, id)` index already supports the own-recipient
keyset; typecheck/lint/build all rc=0 (the Next.js build compiled the center route, boundaries, actions, bell and
i18n).

## Non-goals (NOT built)

Notification preferences, email/push/SMS/webhook/external-messenger delivery, connected-account linking, new
Family incident/protection-plan detail routes, WebSocket/SSE/polling, a second notification table/repository/
resolver, and a recent-notification popover.

## Deployment status

**Committed + pushed; NOT deployed.** The production route, its authenticated tenant/workspace behaviour, and the
production bell/center have NOT been observed in a deployed environment (no browser automation was run locally —
verification is DB/action + source/UI static + `pnpm build` compilation). The Phase 3C scheduler's production
activation is likewise unchanged/unverified.
