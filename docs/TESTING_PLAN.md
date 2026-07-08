# Guardora.ai — Testing Plan

A practical checklist for internal / beta testing. No moderation actions are
enabled — testing covers monitoring, demo data, real read-only Meta sync, i18n,
and safety only.

---

## A. Local test setup

- [ ] Docker Postgres running (`guardora_postgres`, port 5460).
- [ ] `.env` present and populated (copy from `.env.example`).
- [ ] `pnpm install`.
- [ ] `pnpm db:migrate` (apply Prisma migrations).
- [ ] `pnpm dev` (web).
- [ ] `pnpm dev:worker` (background sync/token monitor) — optional.

## B. Demo data test

- [ ] `pnpm db:seed` populates the demo workspace.
- [ ] Dashboard loads with KPI cards, trend, breakdowns.
- [ ] Inbox has items.
- [ ] Insights / Reports are populated (charts, sync monitoring).
- [ ] No `[MOCK]` visible in the main customer-facing UI.
- [ ] "Demo" badge visible in the sidebar.

## C. Real Meta read-only test

- [ ] Meta App configured (`META_APP_ID/SECRET/REDIRECT_URI`, `META_LIVE_SYNC=true`).
- [ ] OAuth scopes requested (via `META_OAUTH_SCOPES`) as needed:
      `public_profile`, `pages_show_list`, `pages_read_engagement`
      (and `pages_read_user_content` if required for comments — verify against
      current official Meta documentation).
- [ ] Connect a real Facebook Page (OAuth + Page selection).
- [ ] Run a read-only sync.
- [ ] A ReputationItem appears in the Inbox.
- [ ] Second sync deduplicates (no duplicate item).
- [ ] No moderation action was executed (reads only).

See [LIVE_META_TEST.md](./LIVE_META_TEST.md).

## C2. Automatic read-only sync

- [ ] `AUTO_SYNC_ENABLED=true`, `AUTO_SYNC_INTERVAL_SECONDS=300`, `pnpm dev:worker`.
- [ ] Worker logs `autosync.done` on its own cadence (auto-poll runs).
- [ ] Dedup on a second run — `createdItems: 0` (no duplicates).
- [ ] Sync audit records `trigger: automatic` (manual button → `trigger: manual`).
- [ ] No platform action executed. Accounts page shows **Auto-sync on** + next sync.

## C3. Risk Rules V1 (profanity / abuse classifier)

- [ ] `pnpm risk:test` passes (SK/CZ/EN/DE vulgarity, scam, positive, neutral, obfuscated).
- [ ] `pnpm risk:reclassify-demo` recomputes risk; items with decisions are skipped.
- [ ] A comment like "Kokot nenažratý" classifies as high/critical, negative,
      approval required — not none/neutral/low. No platform action executed.

## C4. Multilingual comment intelligence (V1.15)

- [ ] `pnpm intel:test` passes (SK/CZ/EN/DE/PL/HU risk + language detection,
      positive/neutral, unknown, mixed-language, translation honesty).
- [ ] Inbox item shows **Language & translation** (detected language + confidence,
      original text preserved, translation status).
- [ ] With `TRANSLATION_ENABLED=false`, translation shows **unavailable** — never
      a fabricated translation.
- [ ] Inbox item shows **Why this was flagged** (matched terms, risk signals,
      recommendation). No platform action executed.

## C5. Provider interfaces + hybrid pipeline (V1.16)

- [ ] `pnpm providers:test` passes (none/mock translation + AI, hybrid rules-only
      vs AI-assisted, gating, no-fake-translation, no platform action, prod refuses mock).
- [ ] Default (`none` providers) → inbox shows **"Rules only"** + "No external AI
      provider used" (safe state, not an error).
- [ ] With `AI_RISK_PROVIDER_ENABLED=true AI_RISK_PROVIDER=mock` + reclassify,
      gated items show **"AI assisted"** and `provider_calls` records the calls.
- [ ] `provider_calls` never contains tokens/secrets/text.

## D. i18n test

- [ ] EN landing renders (`/`).
- [ ] SK landing renders (`/sk`).
- [ ] DE landing renders (`/de`).
- [ ] Case studies render in all three (`/case-studies`, `/sk/case-studies`, `/de/case-studies`).
- [ ] Language switcher (marketing header) navigates between locales and persists
      the choice via the `guardora_locale` cookie.
- [ ] Dashboard language preference (Settings → Language) changes sidebar labels.
- [ ] Fallback to EN works for an unknown locale.
- [ ] No missing-key artifacts visible (run `pnpm i18n-check` → PASS).

## E. Security / safety test

- [ ] `.env` is not committed (`git status` clean of secrets).
- [ ] Token leak: no `plain:v1:` / `aesgcm:v1:` in any rendered page.
- [ ] `hide` / `reply` / `delete` are disabled at the connector runtime.
- [ ] Unsupported actions never fake success (capability check).
- [ ] Seed guard protects a real connected account (`pnpm db:seed` refuses
      without `SEED_FORCE=1` when a real account exists).
- [ ] Developer diagnostics on the Accounts page are collapsed by default.

## F. Browser QA

- [ ] Desktop Chrome and Safari.
- [ ] Mobile homepage (hero, CTAs full-width, language switcher reachable).
- [ ] Mobile dashboard sidebar (off-canvas drawer).
- [ ] Light dashboard theme.
- [ ] Dark marketing pages.
- [ ] DE (longer strings) and SK (diacritics) do not break buttons/badges/nav.

## G. Acceptance checklist

- [ ] `pnpm -r typecheck` passes.
- [ ] `pnpm build` passes.
- [ ] All pages render (landing EN/SK/DE, case-studies EN/SK/DE, dashboard,
      inbox, inbox detail, accounts, insights, reports).
- [ ] Real Meta sync (optional, if credentials available).
- [ ] `pnpm i18n-check` PASS and `pnpm db:reconnect-check` PASS.
- [ ] No fake claims (no "Meta approved", no fake clients/partners/KPIs).
- [ ] Docs updated.

---

Related: [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) ·
[LAUNCH_SAFETY_CHECKLIST.md](./LAUNCH_SAFETY_CHECKLIST.md) ·
[PRODUCT_STATUS.md](./PRODUCT_STATUS.md)
