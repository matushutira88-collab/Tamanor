# Guardora.ai — Product Status

A concise snapshot of where the product is today.

**One-liner:** AI Reputation Firewall for modern brands — read-only by default,
human approval for sensitive actions, official OAuth/API connectors only.

---

## Milestones delivered

| Stage | What it added |
| --- | --- |
| **V0** | Scaffold — pnpm monorepo, Next.js App Router, Prisma/Postgres. |
| **V1** | Foundation — domain model, dashboard, seed dev data. |
| **V1.1** | Human approval workflow (propose → approve/reject → execute gate). |
| **V1.2** | Connector runtime & modes; moderation actions gated off. |
| **V1.3** | Meta OAuth (official login) + Facebook Page selection. |
| **V1.4** | Live Meta validation (read-only), safe-failure paths. |
| **V1.8** | Public trust pages + demo/lead capture, SEO, footer/CTA. |
| **V1.9** | Demo-ready product polish (rich demo data, charts, case studies). |
| **Global Visual QA Polish** | Contrast/premium pass, real brand icons, dark landing / light dashboard / dark-teal sidebar, `[MOCK]` removed from customer UI. |
| **Real Meta read-only sync** | **Verified end-to-end** against a real Facebook Page. |
| **V1.11** | SK/DE i18n (EN default) + testing readiness. Marketing in EN/SK/DE with language switcher and cookie persistence; dictionary-based, EN fallback; dashboard language preference. |
| **V1.12** | Full localization QA. Dashboard page headers (all routes) + sidebar + key empty states localized; trust pages as localized shells (header/footer/nav via cookie, bodies EN fallback); SEO hreflang + canonical on EN/SK/DE marketing routes. i18n-check 189 keys. |
| **V1.12B/C** | Complete dashboard i18n — homepage + all 12 inner pages localized; enum labels via `tEnum`; **513 i18n keys**; dashboard smoke SK/DE PASS across 13 routes; professional emoji accents (risk/sentiment/emotions/topics/approval/incidents). |
| **V1.13** | **Beta Testing Package** — beta guide, checklist, bug/feedback templates, known limitations, test-results log. Localization no longer blocks beta. |
| **V1.14** | Beta blockers: approval-detail i18n, automatic read-only sync (worker polling), Risk Rules V1 profanity/abuse classifier (SK/CZ/EN/DE). |
| **V1.14B** | Hard i18n audit — all dashboard customer UI SK/DE (618 keys); enum display via tEnum. |
| **V1.15** | **Multilingual comment intelligence** — per-item language detection (EN/SK/CS/DE/PL/HU + unknown), honest translation layer (no provider yet), structured risk explanation (matched terms / signals / recommendation), and inbox "Language & translation" + "Why this was flagged" cards. |
| **V1.16** | **Provider interfaces** — provider-agnostic `TranslationProvider` + `AiRiskProvider` (`none` honest no-op + `mock` dev/test only, refused in production). Hybrid pipeline: Risk Rules V1 first-pass, AI provider only when gated (unknown/mixed language, low confidence, high/critical, scam/threat/legal, brand-rule match). Provider-call observability (`provider_calls` — no tokens/secrets/text). Inbox "Rules only / AI assisted" badge. No real external provider wired yet. |
| **V1.17** | **Brand Risk Memory + feedback loop** — per-brand learning (`brand_risk_feedback`, `brand_risk_memory_rules`). Inbox "Improve Guardora for this brand" feedback actions (false positive / missed risk / mark safe/risky / wrong language·sentiment) + add watch/allow/block phrase. Memory rules applied in the pipeline after Risk Rules V1 with a hard **safety floor** (allow/reduce never cancel scam/threat/legal/harassment/critical-profanity). Brand Risk Memory page in Rules. All brand-scoped (never cross-brand), audited. Not global model training. |
| **V1.18** | **Auto-Protect policies (shadow mode)** — per-brand policy per harmful category (`brand_auto_protect_policies`) → monitor / approval / auto-hide **shadow**. Engine computes a decision (`auto_protect_decisions`): monitor · requires_approval · **would_auto_hide** · blocked_by_safety. **Normal criticism is never auto-hidden.** Auto-hide is **shadow only — no live platform action**; `auto_hide_live_reserved` is reserved and not selectable. Auto-Protect settings + inbox "Auto-Protect decision" card + dashboard metrics. Audited. Prepares the future action-enable phase. |
| **V1.21D** | **Real-only reset** — demo data removed from the main app. Default `pnpm db:seed` is now minimal (workspace + dev user + one empty brand + Auto-Protect policy templates, **no demo content**); the demo dataset moved to `pnpm demo:seed`. New `pnpm real:reset-content` safely removes all demo/mock brands, accounts, content, decisions, and demo labels while **keeping the real Konfigurátor page (1165524636643112)** and its real synced comments (confirm via `REAL_RESET_CONFIRM=YES`). Worker never mock-fetches a real account. Empty states are real-only. |
| **V1.21B** | **Controlled Facebook auto-hide (default OFF)** — `PlatformActionExecution` model, isolated `hideComment` connector seam (mock/graph transport), fail-closed env gates (`LIVE_ACTIONS_ENABLED`/`FACEBOOK_HIDE_ENABLED`/`LIVE_ACTIONS_DRY_RUN`), 12+ permission/capability/safety gates, shadow→dry-run→live states. Facebook Page `hide_comment` only; reply/delete stay disabled, no Instagram. Normal criticism never hidden. Rollback seam prepared (unhide dry-run only). **Live actions executed = 0 by default.** |
| **V1.19** | **Auto-Protect demo dataset + executive value dashboard** — multilingual demo comments (EN/SK/DE/PL/HU/CZ) covering all 16 categories. Dashboard "Auto-Protect value" (protected in shadow / would auto-hide / sent to approval / normal criticism preserved / **live actions executed = 0**). Reports "Auto-Protect report" (shadow summary, category breakdown, "What Guardora did not hide", recent would-auto-hide, "no live action executed" banner). Inbox Auto-Protect quick filters. Still shadow mode; live auto-hide disabled. |

## Current verified capability

**Facebook Page comment → Meta API → Guardora live read-only sync →
ReputationItem → Inbox / detail.**

- Official OAuth connection with Page selection.
- Live read-only sync (fetched 1, created 1, dedup works).
- AI risk assessment (risk level, sentiment, priority, categories).
- No platform action performed — reads only.

## Still disabled intentionally

- **reply / hide / delete / any moderation action.**
- Even after human approval, execution is gated off at the connector runtime.
- Enablement is a separate, later phase with per-brand opt-in, approval, audit,
  capability checks, and legal/safety review
  (see [LAUNCH_SAFETY_CHECKLIST.md](./LAUNCH_SAFETY_CHECKLIST.md) §E).

## Beta readiness (V1.13)

**Ready for controlled beta.** Localization no longer blocks it: EN/SK/DE
marketing + dashboard UI are complete (513 keys, smoke-tested SK/DE across 13
routes), demo data is clearly labeled, real Meta read-only sync is verified, and
moderation actions are disabled. Beta materials live in
[BETA_TEST_GUIDE.md](./BETA_TEST_GUIDE.md), [BETA_CHECKLIST.md](./BETA_CHECKLIST.md),
[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md), [BUG_REPORT_TEMPLATE.md](./BUG_REPORT_TEMPLATE.md),
[BETA_FEEDBACK_FORM.md](./BETA_FEEDBACK_FORM.md), [TEST_RESULTS.md](./TEST_RESULTS.md).

Not required for beta (needed before **public** launch): production token storage
(`aes-gcm`/KMS), Meta App Review, domain + real emails, backups/monitoring.

## Notes on data & platforms

- The demo workspace is **demo data**, clearly labeled (sidebar "Demo" badge).
- Only **Meta read-only** is really verified today; other platform connectors are
  placeholder/mock and must not be presented as live.
- Tokens are encrypted at the storage seam and never shown in UI/logs/audit;
  production requires `aes-gcm` or `kms` (plaintext is dev-only).

---

Related: [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) ·
[LAUNCH_SAFETY_CHECKLIST.md](./LAUNCH_SAFETY_CHECKLIST.md) ·
[ROADMAP.md](./ROADMAP.md)
