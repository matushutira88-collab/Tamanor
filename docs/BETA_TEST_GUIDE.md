# Guardora.ai — Beta Test Guide

A practical guide for controlled beta testing. Read this once before you start.
Keep it honest: some things are really live, most is demo data, and moderation
actions are intentionally off.

---

## What Guardora is

Guardora is an **AI Reputation Firewall for modern brands**. It monitors
comments, reviews and public feedback across platforms, scores each item for
risk with AI, and keeps humans in control of any sensitive action.

Core principles: **read-only by default · human approval for sensitive actions ·
official OAuth/API connectors only · no scraping · no shared passwords.**

## Goal of the beta

Validate that the product is **clear, trustworthy, and usable** in EN/SK/DE —
before any paid test or public launch. We want feedback on comprehension
(dashboard, inbox, approval workflow), language quality (SK/DE), and whether the
difference between **demo data** and **real read-only sync** is obvious.

## What is really live

- **Real Meta read-only sync** was verified end-to-end: a real Facebook Page
  connected via official OAuth → live Graph read → item appears in the Inbox,
  with dedup on a second sync. Reads only — no action performed.
- The **AI risk assessment** (risk level, sentiment, priority, categories).
- **EN/SK/DE localization** across marketing + dashboard UI.

## What is demo data

- The seeded **Demo Workspace** (sidebar shows a **"Demo"** badge).
- Two example brands (**Aurora Fitness**, **Northwind Coffee**), ~200
  clearly-internal `[MOCK]` reputation items spanning 30 days, plus mock
  connected accounts and sync history.
- **Case studies** are labeled **"Example scenarios — not real customers."**

## What is intentionally disabled

- **Moderation actions: reply / hide / delete are OFF** at the connector runtime.
  Even after human approval, execution is gated off until a separate action-enable
  phase.
- **Billing checkout** (no payment is processed).
- **Team invites** (if shown, they do not send).

See [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) for the full list.

## How to run locally

```bash
# 1) Postgres (Docker) must be running (guardora_postgres, port 5460)
# 2) from the repo root:
pnpm install
pnpm db:migrate        # apply Prisma migrations
pnpm db:seed           # seed the Demo Workspace
pnpm dev               # web app
pnpm dev:worker        # optional: background read-only sync / token monitor
```

Open <http://localhost:3000>.

## How to sign in

Use the dev login at <http://localhost:3000/login> with the seeded dev user
(`dev@guardora.ai`). This drops you into the **Demo Workspace** as Owner.

## How to switch EN / SK / DE

- **Marketing**: use the language switcher in the site header. EN = `/`,
  Slovak = `/sk`, German = `/de` (and `/case-studies`, `/sk/case-studies`,
  `/de/case-studies`). The choice persists via the `guardora_locale` cookie.
- **Dashboard**: go to **Settings → Language** and pick EN / SK / DE. The whole
  dashboard (headers, KPIs, tables, badges) re-renders in that language.

## How to test the dashboard

Open **Dashboard** and check the KPI cards, 30-day risk trend, risk/platform
breakdown, top risky topics, sync health and recent incidents. Flip the language
and confirm everything translates (emoji accents — 🔥 critical, 🚨 incident,
😊/😞 sentiment — should aid quick reading, not clutter).

## How to test the Inbox

Open **Inbox**. Try the tabs and filters (brand, platform, risk, priority).
Open an item to see the **AI risk assessment** (risk level, sentiment, priority,
categories), the **Triage** actions (internal status changes), and the
**Propose platform action** section — which shows a **"No platform action
executed"** badge.

## How to test Accounts

Open **Accounts**. Review the platform cards (real brand icons), connection
health, permissions, and last sync. Technical env checks live under a collapsed
**"Developer diagnostics"** section. Connect/Disconnect (mock) buttons manage
demo accounts.

## How to test the real Meta read-only sync

Follow [LIVE_META_TEST.md](./LIVE_META_TEST.md): configure a Meta App, set
`META_LIVE_SYNC=true` and the OAuth scopes, connect a real Facebook Page, then
run a read-only sync. Expect **fetched 1, created 1**, and a **dedup** (no
duplicate) on a second sync.

## Manual vs automatic read-only sync

- **Manual**: the accounts detail page has a **"Run read-only sync"** button —
  always available as a fallback.
- **Automatic polling**: when `AUTO_SYNC_ENABLED=true`, the **worker**
  (`pnpm dev:worker`) periodically runs a read-only sync for eligible connected
  accounts every `AUTO_SYNC_INTERVAL_SECONDS` (default 300). It respects
  rate-limit backoff, dedups (no duplicate items), and **never executes a
  platform action**. This is polling, not real-time "live monitoring".
- The accounts detail page shows an **"Auto-sync on/off"** badge, last sync, and
  a next-sync estimate. Sync runs are audited with a `trigger` of `manual` or
  `automatic`.

```bash
# enable automatic read-only polling for the beta
AUTO_SYNC_ENABLED=true
AUTO_SYNC_INTERVAL_SECONDS=300
# then run the worker:
pnpm dev:worker
```

## How to verify no platform action was performed

- The item appears in the Inbox with a risk assessment, but **nothing is hidden,
  replied to, or deleted** on the platform.
- The Inbox detail shows **"No platform action executed."**
- Optional: the connector runtime returns `disabled: true` for hide/reply/delete
  (see [BETA_CHECKLIST.md](./BETA_CHECKLIST.md)).

## Multilingual comment intelligence

The **app UI** is EN/SK/DE, but **comments/reviews can be in any language**. On an
inbox item you'll see two cards:

- **Language & translation** — detected language + confidence, the **original
  text (always preserved)**, and translation status. With no provider configured
  the translation is honestly shown as **"Translation not available yet"** — it is
  never faked.
- **Why this was flagged** — matched terms, risk signals, and a recommended
  **human-review** action. Try a comment like "Kokot nenažratý" (SK), "Das ist
  Betrug" (DE), or "To oszustwo" (PL) and confirm it is flagged with an
  explanation. Nothing is executed on the platform.

Wording to use: **Multilingual comment intelligence** / **Viacjazyčné
vyhodnocovanie komentárov** / **Mehrsprachige Kommentar-Analyse**. Do not claim
perfect support for all languages — detection/risk is best-effort and uncertain
items go to human review.

**Providers.** Translation and AI risk run through provider interfaces. By
default no external provider is wired (`none`), so items are classified by **Risk
Rules V1** — the inbox shows a **"Rules only"** badge and "No external AI provider
used" (a safe state, not an error). A `mock` provider exists for local tests only
(refused in production); when enabled, gated items show **"AI assisted"**. No fake
AI, no fake translation, no platform action.

## Brand Risk Memory + feedback (learns per brand)

Open an inbox item → **"Improve Guardora for this brand"**. You can mark it
correctly classified, a **false positive**, a **missed risk**, safe/risky for this
brand, or report a wrong language/sentiment. You can also add a phrase to the
brand **watchlist / allowlist / blocklist**.

- Feedback and rules are **only for this brand** — never shared across brands,
  and this is **not** global AI model training.
- False positive / missed risk **saves feedback**; a memory rule is created only
  if you **explicitly confirm** it.
- **Safety floor:** an allow rule can calm routine items but **never** cancels a
  scam, threat, legal threat, harassment, or critical profanity signal.
- See all learned rules under **Rules → Brand Risk Memory** (type, severity,
  source, language, created, active toggle).
- **Nothing is executed** on any platform — every feedback action is audited and
  actions stay disabled.

## Auto-Protect (shadow mode)

Under **Rules → Auto-Protect** a brand chooses, per harmful-content category, to
**monitor**, **send to approval**, or **auto-hide**. Important for the beta:

- **Auto-hide is shadow mode only.** Guardora shows what it *would* hide
  ("Would auto-hide") and records it, but **nothing is hidden on any platform** —
  live hide/reply/delete remain disabled.
- **Normal criticism of your service is never auto-hidden** — a bad review still
  reaches you.
- You **must switch a category on** for it to act. `Auto-hide (reserved)` is a
  future mode and is not selectable.
- Open an inbox item to see the **Auto-Protect decision** card (matched category,
  mode, decision, confidence, reason, "Live action executed: No"). The dashboard
  shows Auto-Protect metrics.
- The future **live action-enable phase is separate** — this release does not
  enable live auto-hide.

**Value dashboard & report.** The main dashboard has an **"Auto-Protect value"**
section (protected in shadow mode / would auto-hide / sent to approval / normal
criticism preserved / **live actions executed = 0**). **Reports → Auto-Protect
report** adds a category breakdown, a **"What Guardora did not hide"** list
(preserved criticism), recent would-auto-hide items, and a **"No live action
executed"** banner. In the **Inbox**, use the Auto-Protect quick filters
(would auto-hide / requires approval / monitored / normal criticism preserved /
blocked by safety). Demo comments span EN/SK/DE/PL/HU/CZ and are demo scenarios,
not real customers.

## What to test on mobile

- Marketing homepage (hero, CTAs full-width, language switcher reachable).
- Dashboard off-canvas sidebar (open/close), KPI cards, tables.
- SK diacritics and longer DE strings must not break buttons/badges/nav.

## What a tester should NOT expect

- No real hide/reply/delete — actions are disabled.
- Not all platforms are live — only Meta read-only is really verified; others are
  placeholder/mock connectors.
- No payment/checkout.
- Demo data are not real customers; case studies are example scenarios.
- No "Meta approved" / partnership claims — Guardora makes none.

---

Related: [BETA_CHECKLIST.md](./BETA_CHECKLIST.md) ·
[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) ·
[BUG_REPORT_TEMPLATE.md](./BUG_REPORT_TEMPLATE.md) ·
[BETA_FEEDBACK_FORM.md](./BETA_FEEDBACK_FORM.md)
