# Guardora.ai — Beta Checklist

Run through this per test session. Tick each item; log anything that fails with
[BUG_REPORT_TEMPLATE.md](./BUG_REPORT_TEMPLATE.md).

## Marketing

- [ ] Landing renders — EN (`/`)
- [ ] Landing renders — SK (`/sk`)
- [ ] Landing renders — DE (`/de`)
- [ ] Case studies render — EN (`/case-studies`)
- [ ] Case studies render — SK (`/sk/case-studies`)
- [ ] Case studies render — DE (`/de/case-studies`)
- [ ] Language switcher changes locale and persists (cookie)

## Auth

- [ ] Login page loads and dev sign-in works

## Dashboard (per language: EN / SK / DE)

- [ ] Dashboard renders with KPIs, trend, breakdowns, sync health, incidents
- [ ] Sidebar labels + trial card translate (Demo badge visible)
- [ ] Inbox list — tabs, filters, table headers, badges
- [ ] Inbox detail — AI risk assessment, triage, "No platform action executed"
- [ ] Accounts — platform cards, health, permissions, developer diagnostics collapsed
- [ ] Approvals — proposals queue + statuses
- [ ] Rules — categories + create/enable/disable
- [ ] Insights — sentiment, emotions, topics, posts, platform breakdown
- [ ] Reports — weekly summary, breakdowns, sync monitoring
- [ ] Billing page — plans + usage (checkout NOT enabled)
- [ ] Team page — members + roles
- [ ] Settings — Language switcher changes dashboard language

## Real Meta read-only

- [ ] Real Meta account connected (OAuth + Page selection)
- [ ] Run read-only sync — item appears in Inbox
- [ ] Dedup on second sync — no duplicate item
- [ ] No moderation action executed (nothing hidden/replied/deleted)

## Mobile

- [ ] Mobile homepage (hero, CTAs, language switcher)
- [ ] Mobile dashboard + off-canvas sidebar
- [ ] SK diacritics / long DE strings don't break layout

## Safety / integrity

- [ ] No token leak (no `plain:v1:` / `aesgcm:v1:` in any rendered page)
- [ ] No `[MOCK]` visible in customer-facing UI
- [ ] No moderation action executed anywhere
- [ ] No fake claims / no "Meta approved" / no fake clients

## Automated gates (developer)

- [ ] `pnpm -r typecheck`
- [ ] `pnpm build`
- [ ] `pnpm i18n-check` (dictionary coverage)
- [ ] `pnpm db:reconnect-check` (reconnect regression)
- [ ] Dashboard i18n smoke SK/DE (`apps/web/scripts/dashboard-i18n-smoke.sh`)

---

Related: [BETA_TEST_GUIDE.md](./BETA_TEST_GUIDE.md) ·
[TEST_RESULTS.md](./TEST_RESULTS.md)
