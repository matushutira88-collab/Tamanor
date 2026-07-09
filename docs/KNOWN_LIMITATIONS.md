# Guardora.ai — Known Limitations

Read before testing. These are **intentional** for the beta — not bugs. State
them plainly to testers so expectations are correct.

## Actions & execution

- **Moderation actions (reply / hide / delete) are DISABLED** at the connector
  runtime. They stay off even after human approval, until a separate
  action-enable phase (per-brand opt-in, audit, capability checks, legal review).
- **No platform action is ever executed** — Guardora is read-only by default.
  Unsupported actions are never faked as success.

## Sync

- Read-only sync is **manual** (button) and, when `AUTO_SYNC_ENABLED=true`,
  **automatic polling** by the worker every `AUTO_SYNC_INTERVAL_SECONDS`
  (default 300, off by default in dev). It is **polling, not real-time live
  monitoring** — do not present it as live. It reads only and never executes a
  platform action; dedup and rate-limit backoff apply.

## Platforms

- **Not all platforms are live.** Only **Meta (Facebook Page) read-only sync** is
  really verified. Instagram, YouTube, LinkedIn, TikTok, Google connectors are
  **placeholder/mock** in the demo and must not be presented as live.

## Data

- **Demo data are not real customers.** The Demo Workspace, its brands
  (Aurora Fitness, Northwind Coffee) and reputation items are seeded `[MOCK]`
  content. Case studies are **example scenarios**, not real clients, with no real
  numbers.
- Demo **comment content** may be in English even when the UI is SK/DE — that is
  expected (only UI chrome is localized).

## Real-only app — demo data removed (V1.21D)

- **Demo data has been removed from the main app.** The default `pnpm db:seed`
  creates only a workspace, a dev user, one empty brand, and Auto-Protect policy
  templates — **no demo brands, accounts, comments, or metrics**.
- The illustrative demo dataset is now an **optional, separate** script:
  `pnpm demo:seed` (never used by the real app or a real test).
- **`pnpm real:reset-content`** removes existing demo/mock data (Northwind Coffee,
  mock accounts, `mock_` content, demo audit, "Demo Workspace" label) while
  **keeping** the real Konfigurátor page (`1165524636643112`), its **real synced
  comments**, real tokens, and the login tenant/user. It prints a summary and
  requires `REAL_RESET_CONFIRM=YES` (dry-run otherwise); it never deletes the
  protected page.
- Real internal testing goes through **real connected accounts only**. The worker
  **never** mock-fetches a real account (a real account without `META_LIVE_SYNC`
  is skipped cleanly, not filled with mock data).
- Empty states are real-only ("Connect a Facebook Page", "Real items appear here
  after the first sync").

## Real test mode & demo data (V1.21C)

- `GUARDORA_DATA_MODE` = `demo` (default) or `real`. In **real mode**, only real
  (active) connected accounts sync, and dashboards/inbox/reports/accounts show
  **only real data** — demo/mock brands (Demo Workspace, Northwind Coffee) and any
  `[MOCK]` are hidden. A **"Real test mode"** banner is shown.
- **Auto-sync is polling, not realtime** — it checks for new comments every
  `AUTO_SYNC_INTERVAL_SECONDS`. New comments appear after the next interval.
- `pnpm real:cleanup-demo` removes demo brands/data for a clean real test. It
  **never deletes** a real connected account or the protected Konfigurátor Page
  (`1165524636643112`), prints a summary, and requires `REAL_CLEANUP_CONFIRM=YES`.
- The **Accounts** menu item opens an **overview**; a specific account opens only
  via its **detail** (`/dashboard/accounts/[id]`), never as a top-level menu item.

## Controlled Facebook auto-hide (V1.21B)

- Guardora can now **hide Facebook Page comments** — but this is **default OFF and
  fail-closed**. A live hide runs ONLY when **all** gates pass:
  `LIVE_ACTIONS_ENABLED=true` AND `FACEBOOK_HIDE_ENABLED=true` AND
  `LIVE_ACTIONS_DRY_RUN=false`, the brand set the category to **live mode**, the
  connected account is real (not demo), platform is **facebook_page**, the Page
  granted `pages_manage_engagement`, confidence ≥ 0.8, category is live-eligible,
  and it is **not** normal_criticism.
- **Three states:** *shadow* (would-hide, no execution) → *dry-run* (simulated,
  no Graph call) → *live* (real hide). Default env stays shadow/dry-run, so
  **live actions executed = 0**.
- **Scope is Facebook Page `hide_comment` only.** Reply and delete stay disabled;
  **Instagram is out of scope**; no new platforms.
- **Normal criticism is never hidden** (hard safety floor, even in live mode).
- **Rollback/unhide** is a prepared seam (comment id + execution id stored) but
  **live unhide is a documented TODO** — required before any broader rollout.
- Every attempt is recorded in `platform_action_executions` (no tokens/secrets)
  and audited (`platform_action.blocked/dry_run/executed/failed`).

## Auto-Protect value dashboard & demo (V1.19)

- The **Auto-Protect value** dashboard and **Auto-Protect report** summarise what
  Guardora *would* do in shadow mode. **Live actions executed is always 0** — no
  content is hidden on any platform.
- The demo dataset is **clearly-labelled demo/scenario data** (Demo Workspace, no
  real client names) spanning EN/SK/DE/PL/HU/CZ. It exists to show category
  coverage, not real customer activity.
- "What Guardora did not hide" exists on purpose: **normal service criticism is
  preserved**, never auto-hidden.

## Auto-Protect (V1.18)

- Auto-Protect lets a brand choose per harmful-content category: **monitor**,
  **send to approval**, or **auto-hide**. **Auto-hide runs in SHADOW MODE only** —
  Guardora computes a "would auto-hide" decision, records it, and audits it, but
  **no content is hidden on any platform**. Live hide/reply/delete stay disabled.
- **Normal criticism of the service is never auto-hidden** (hard safety floor). A
  shadow policy on criticism resolves to `blocked_by_safety`.
- A client **must enable a category** for it to act; categories without an active
  policy stay **monitor only**. Low-confidence shadow items are downgraded to
  **requires_approval**.
- `auto_hide_live_reserved` is a **reserved** enum for the future action-enable
  phase — it is **not selectable in the UI** and never performs a live action.
- The future **action-enable phase is a separate, explicit step**. This release
  makes no claim that live auto-hide is enabled.
- Every policy change and `would_auto_hide` decision is audited (no tokens/secrets).

## Brand risk memory & feedback (V1.17)

- Guardora learns **at the brand level only**. Feedback and memory rules are
  **tenant + brand scoped** — a rule for one brand **never** affects another, and
  there is **no global model training** across brands.
- Marking an item **false positive / missed risk** saves feedback; a memory rule
  is created **only on explicit confirmation** (default = feedback only).
- **Safety floor:** allow/reduce brand memory rules can lower routine risk but
  **never** cancel a critical safety signal — scam/fraud, threats, legal threats,
  explicit harassment, or critical profanity always hold.
- Every feedback entry and memory-rule create/update/activate/deactivate is
  **audited** (no tokens/secrets). The classifier also audits when a brand memory
  signal influenced a result.
- **No platform action** is ever taken from feedback — actions stay disabled.

## Providers (translation + AI risk)

- **Provider interfaces are ready** (`TranslationProvider`, `AiRiskProvider`) but
  **no real external provider is wired**. Defaults: `TRANSLATION_PROVIDER=none`,
  `AI_RISK_PROVIDER=none` → **Risk Rules V1 alone**, no translation.
- `mock` providers exist for **local tests only** — clearly labelled and
  **refused in production** (`NODE_ENV=production` → falls back to `none`).
- The hybrid pipeline calls the AI provider **only when gated** (unknown/mixed
  language, low confidence, high/critical risk, scam/threat/legal signal, or a
  brand-rule match) — never on every comment.
- Provider calls are recorded for observability (`provider_calls`): provider,
  type, status, latency — **no tokens, secrets, or full payloads**.
- **No fake AI, no fake translation.** Nothing is executed on any platform.

## Languages & translation

- **App UI supports EN / SK / DE only.** Comment/review **intelligence is
  multilingual**: per-item language detection (best-effort for EN/SK/CS/DE/PL/HU
  and `unknown` fallback for the rest) and multilingual risk lexicons.
- **Do not claim "perfect support for all languages."** Detection and risk are
  heuristic and may be imperfect; uncertain risky items are surfaced for **human
  review**.
- **Translation requires a provider.** With `TRANSLATION_ENABLED=false` (default)
  or no provider, translation status is **"unavailable"** — **no translation is
  ever fabricated**. The **original text is always preserved and shown**.
- Human approval remains required for anything sensitive; nothing is executed.

## Localization

- Marketing (EN/SK/DE) and dashboard **customer-facing UI** are localized
  (513 keys; smoke-tested SK/DE across 13 routes).
- **Legal bodies** of trust pages (privacy/terms/security/about) may still show an
  **EN fallback** — the shells (header/footer/nav) localize, the legal prose is
  pending native translation.
- A few long descriptive paragraphs and billing plan feature bullets remain EN by
  design (no keys yet).

## Commerce & team

- **Billing checkout is disabled** — no payment is processed; plans are display-only.
- **Team invites do not send** — invitation delivery is not wired for the beta.

## Production readiness (before public launch — not beta)

- **Token storage**: production must use **`aes-gcm`** (or a KMS provider);
  plaintext is dev-only and blocked in `NODE_ENV=production`.
- **Meta App Review** required for the exact read scopes before public production.
- **Domain, real emails** (hello@ / security@ / privacy@), backups, monitoring,
  incident response — still to configure. See
  [LAUNCH_SAFETY_CHECKLIST.md](./LAUNCH_SAFETY_CHECKLIST.md).

---

Related: [PRODUCT_STATUS.md](./PRODUCT_STATUS.md) ·
[LAUNCH_SAFETY_CHECKLIST.md](./LAUNCH_SAFETY_CHECKLIST.md) ·
[PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md)
