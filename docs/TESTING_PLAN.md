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

## C6. Brand risk memory + feedback (V1.17)

- [ ] `pnpm memory:test` (allow/block/watch/competitor, safety floor, inactive,
      brand isolation, no platform action) passes.
- [ ] `pnpm memory:db-test` (feedback persistence + tenant/brand isolation) passes.
- [ ] Inbox detail shows **"Improve Guardora for this brand"** with feedback
      actions; clicking one shows a confirmation and adds an audit entry — **no**
      platform action runs.
- [ ] False positive / missed risk saves feedback; a memory rule is created only
      on explicit confirm.
- [ ] **Rules → Brand Risk Memory** lists rules with type/severity/source/
      language/created + active toggle. A brand's rule never appears for another.
- [ ] `brand_risk_feedback` / `brand_risk_memory_rules` scoped by tenant+brand.

## C7. Auto-Protect policies — shadow mode (V1.18)

- [ ] `pnpm autoprotect:test` (policy modes, would_auto_hide, safety floor,
      confidence downgrade, competitor promo vs comparison, disabled policy,
      reserved-live never live) passes.
- [ ] `pnpm autoprotect:db-test` (decision persistence + tenant/brand isolation) passes.
- [ ] **Rules → Auto-Protect** shows per-category mode (Monitor / Approval /
      Auto-hide shadow). `normal_criticism` cannot be set to auto-hide;
      `auto_hide_live_reserved` is not selectable.
- [ ] Inbox detail **Auto-Protect decision** card shows matched category, mode,
      decision, confidence, reason, and **"Live action executed: No"**; a
      would_auto_hide item shows the shadow-mode explanation.
- [ ] Dashboard shows Auto-Protect metrics (protected / would-hide / approval /
      monitored / criticism preserved).
- [ ] No content is hidden on any platform; every decision is audited.

## C8. Auto-Protect value dashboard + report (V1.19)

- [ ] `pnpm autoprotect:value-test` passes (all 16 categories in demo, criticism
      never would-hide, live actions = 0, value metrics, category breakdown, inbox
      filters).
- [ ] Dashboard **"Auto-Protect value"** shows 5 cards incl. **Live actions
      executed = 0** + the shadow-mode paragraph.
- [ ] Reports **"Auto-Protect report"**: shadow summary, category breakdown,
      **"What Guardora did not hide"**, recent would-auto-hide, **"No live action
      executed"** banner.
- [ ] Inbox **Auto-Protect quick filters** (would auto-hide / requires approval /
      monitored / normal criticism preserved / blocked by safety) filter the list.
- [ ] Demo comments span EN/SK/DE/PL/HU/CZ; **no visible [MOCK]**; no claim that
      live auto-hide is enabled.

## C9. Real Meta test blockers (V1.21A)

- [ ] `pnpm realmeta:test` passes: "klikni a vyhraj iPhone" → high/critical +
      scam/phishing/spam + approval + would_auto_hide; "nenažratý kokot" →
      high/critical + profanity/personal_attack + would_auto_hide; normal
      criticism → monitor, never auto-hide; low-confidence downgrade; no execution.
- [ ] Worker `autosync.ENABLED` logs on boot when `AUTO_SYNC_ENABLED=true`;
      `worker.autosync.eligible` + per-account `pageName/pageId` logged; auto-sync
      runs `runReadOnlySync(..., "automatic")` with no UI click.
- [ ] Accounts → **Connected accounts** shows the real page first, marked **Live**
      (demo/mock marked **Demo**); Page ID, Read-only, permissions, last sync shown.
- [ ] Accounts → **Auto-sync status**: enabled/disabled, worker-required, last
      automatic sync, last manual sync, next-sync estimate, last error.
- [ ] Follow `docs/REAL_META_TEST_CHECKLIST.md`; live actions executed = 0.

## C10. Controlled Facebook auto-hide gates (V1.21B)

- [ ] `pnpm fbhide:test` passes (all safety gates block; dry-run never calls the
      transport; live-with-mock executes once; failures never fake success; no
      tokens in rows; audit written; dry-run counted separately from executed).
- [ ] Default env → **Live actions executed = 0** (dashboard card + DB).
- [ ] Inbox Auto-Protect card shows the live state (Shadow / Dry-run / Blocked /
      Executed) + reason when not executed.
- [ ] Accounts shows **Hide comment capability**: Available / Missing permissions
      / Disabled by env (Facebook Page only).
- [ ] Rules live-mode option appears ONLY when `LIVE_ACTIONS_ENABLED=true`, with a
      warning banner; `normal_criticism` can never be set to live.

## C11. Real test mode + demo cleanup (V1.21C)

- [ ] `pnpm realmode:test` passes (real/demo separation, autosync excludes mock,
      cleanup never targets the real account/protected page, brandWhere real-only).
- [ ] `pnpm real:cleanup-demo` (dry-run) prints a summary and deletes nothing;
      keeps the real Konfigurátor page (`1165524636643112`).
- [ ] With `GUARDORA_DATA_MODE=real`: dashboard/inbox/reports/accounts show a
      **"Real test mode"** banner and **only real data** (no Demo Workspace, no
      Northwind Coffee, no `[MOCK]`).
- [ ] Worker log shows `dataMode` + `skippedDemo` when real; only active accounts
      auto-sync.
- [ ] Accounts overview: real accounts first, "Open account detail" CTA to
      `/dashboard/accounts/[id]`; auto-sync cadence text ("every N seconds").
- [ ] Real mode with no real data → empty state "No real synced comments yet."
- [ ] Live actions = 0; hide/reply/delete disabled.

## C12. Real-only reset (V1.21D)

- [ ] `pnpm reset:test` passes (mock/demo removed, protected page + real synced
      items kept, Northwind/Demo Workspace gone, mock accounts removed).
- [ ] `pnpm real:reset-content` (dry-run) prints a summary, deletes nothing;
      `REAL_RESET_CONFIRM=YES` applies it and keeps `1165524636643112`.
- [ ] Default `pnpm db:seed` creates **no demo content** (workspace + dev user +
      one empty brand + Auto-Protect policies only). `pnpm demo:seed` is separate.
- [ ] After reset: no `[MOCK]`, no `mock_`, no Northwind Coffee, no Demo Workspace
      in DB or UI. Accounts shows only the real Konfigurátor page.
- [ ] Dashboard/Inbox/Reports show real data (or a real-only empty state).
- [ ] Worker never mock-fetches a real account.

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
