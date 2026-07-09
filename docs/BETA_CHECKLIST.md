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

## Auto-Protect (shadow mode) — V1.18/V1.19

- [ ] Dashboard **Auto-Protect value**: protected in shadow / would auto-hide /
      sent to approval / normal criticism preserved / **Live actions executed = 0**
- [ ] Reports **Auto-Protect report**: category breakdown, "What Guardora did not
      hide", recent would-auto-hide, **"No live action executed"** banner
- [ ] Inbox **Auto-Protect filters** (would auto-hide / requires approval /
      monitored / normal criticism preserved / blocked by safety) filter the list
- [ ] Inbox detail **Auto-Protect decision** card: category, mode, decision,
      confidence, reason, **"Live action executed: No"**
- [ ] Rules **Auto-Protect settings**: per-category mode; `normal_criticism`
      cannot be set to auto-hide; reserved live mode not selectable
- [ ] Shadow-mode wording clear; **no fake "live auto-hide"**; criticism preserved

## Brand Risk Memory + Multilingual intelligence — V1.15/V1.17

- [ ] Inbox detail **Language & translation** card (detected language, original
      text preserved, "translation unavailable" when no provider — never faked)
- [ ] Inbox detail **Why this was flagged** (matched terms, signals, recommendation)
- [ ] Inbox detail **Improve Guardora for this brand** feedback + add phrase
- [ ] Rules **Brand Risk Memory** list + active toggle (brand-scoped, not global)
- [ ] Provider status clear: **"Rules only" / "Classified by rules"** (no external AI)

## Real Meta read-only

- [ ] Real Meta account connected (OAuth + Page selection)
- [ ] Run read-only sync — item appears in Inbox
- [ ] Dedup on second sync — no duplicate item
- [ ] No moderation action executed (nothing hidden/replied/deleted)

## Mobile

- [ ] Mobile homepage (hero, CTAs, language switcher)
- [ ] Mobile dashboard + off-canvas sidebar
- [ ] Mobile inbox list + inbox detail cards
- [ ] Mobile Reports Auto-Protect section (breakdown/lists scroll, no page overflow)
- [ ] Mobile Rules Auto-Protect settings table (horizontal scroll inside card)
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
- [ ] Dashboard i18n smoke SK/DE (`apps/web/scripts/dashboard-i18n-smoke.sh`)
- [ ] `pnpm risk:test` · `pnpm intel:test` · `pnpm providers:test`
- [ ] `pnpm memory:test` · `pnpm autoprotect:test` · `pnpm autoprotect:value-test`
- [ ] `pnpm memory:db-test` · `pnpm autoprotect:db-test`
- [ ] Token leak none · hide/reply/delete disabled · live actions = 0
- [ ] Run `docs/DEMO_ENVIRONMENT_CHECK.md` before any beta/demo session

---

Related: [BETA_TEST_GUIDE.md](./BETA_TEST_GUIDE.md) ·
[TEST_RESULTS.md](./TEST_RESULTS.md)
