# Guardora.ai — Test Results

Log one block per test session. Newest at the top.

```markdown
### Session
- Date:
- Tester:
- Environment:        <local dev / staging — port, DB>
- Commit:             <git hash if known>
- Language tested:    <EN / SK / DE>
- Browser / device:   <e.g. Chrome 126 macOS / Safari iOS iPhone>

### Test scope
<which BETA_CHECKLIST sections were run>

### Passed
- 

### Failed
- <link to bug report>

### Issues found
- <id / severity / one-line>

### Screenshots
<links>

### Notes
<observations, language quality, comprehension>

### Next actions
- 
```

---

## Internal Beta Dry Run — V1.20 (first internal run)

- **Date:** 2026-07-09
- **Tester:** Internal (acting as first client/tester)
- **Environment:** local, `next start` prod build (port 402x), Docker Postgres `guardora_postgres:5460`
- **Commit:** V1.20 (no VCS hash — repo is not a git checkout)
- **Languages tested:** EN / SK / DE
- **Build/data:** V1.19 demo dataset (16/16 Auto-Protect categories, EN/SK/DE/PL/HU/CZ), 0 visible `[MOCK]`

### Environment hygiene (Scope A)
- Stopped all stale workers/servers (0 Guardora node processes before start).
- `.env` not committed; `.gitignore` covers `.env`.
- Env flags safe: `AUTO_SYNC_ENABLED` off, `TRANSLATION_/AI_RISK_` providers `none`, only `META_LIVE_SYNC=true` (read-only).
- **1 real connected account present → did NOT re-seed / did NOT use `SEED_FORCE`.**
- Live platform actions disabled (`disabled=true,true,true`).

### Routes checked (Scope B) — all HTTP 200
- **Marketing:** `/`, `/sk`, `/de`, `/case-studies`, `/sk/case-studies`, `/de/case-studies`
- **Dashboard:** `/dashboard`, `/inbox`, `/inbox/[id]`, `/accounts`, `/accounts/[id]`, `/approvals`, `/approvals/[id]`, `/rules`, `/reports`, `/insights`, `/settings`, `/brands`, `/team`, `/billing`, `/audit`

### Verified
- ✅ EN/SK/DE switching (Welcome back / Prehľad / Willkommen).
- ✅ Hard i18n smoke SK/DE **PASS** — no untranslated customer-facing text.
- ✅ **0 visible `[MOCK]`** across all routes.
- ✅ No fake "live auto-hide" / no positive "content hidden/removed" claims (only safe "No platform action executed").
- ✅ **Live actions executed = 0** (dashboard card + `moderation_decisions` executed = 0).
- ✅ Auto-Protect value dashboard + report render and add up (would-hide 51, approval 60, criticism preserved, live = 0).
- ✅ Inbox Auto-Protect filters (would_auto_hide / requires_approval / monitor / preserved / blocked_by_safety) all return filtered lists (HTTP 200).
- ✅ Inbox detail cards clear: Auto-Protect decision, Language & translation, Why flagged, Improve-for-brand feedback, Provider status.
- ✅ Rules: Brand Risk Memory + Auto-Protect settings render.
- ✅ **normal_criticism never `would_auto_hide`** (0).
- ✅ Mobile scaffolding present (viewport, mobile nav toggle, `overflow-x-auto` tables, `flex-wrap` chips, responsive grids).

### Issues found
- None blocking. Two false-positive scanner hits (`hidden` HTML attributes and the safe phrase "No platform action executed") — not defects.

### Fixes applied
- None required (docs added: `DEMO_ENVIRONMENT_CHECK.md`; `DEMO_SCRIPT.md` narrative beats for multilingual / brand memory / providers).

### Remaining non-blockers
- Scheduled export (PDF/CSV) is UI-only ("coming soon").
- Real AI/translation provider not wired (Risk Rules V1 only).
- Dashboard layout has no explicit `overflow-x-hidden` guard (cards self-contain; not a demo blocker).

### Beta readiness verdict
**PASS — ready for controlled external beta testing.** No beta/demo blockers found.

---

## Latest automated verification (developer baseline)

Fill in on each build tested with a beta group.

| Check | Result | Date |
| --- | --- | --- |
| `pnpm -r typecheck` | ✅ 8/8 | 2026-07-09 |
| `pnpm build` | ✅ ok | 2026-07-09 |
| `pnpm i18n-check` (795 keys) | ✅ PASS | 2026-07-09 |
| Dashboard i18n smoke SK/DE (all routes) | ✅ PASS | 2026-07-09 |
| `pnpm risk:test` / `intel:test` / `providers:test` | ✅ PASS | 2026-07-09 |
| `pnpm memory:test` / `autoprotect:test` / `autoprotect:value-test` | ✅ PASS | 2026-07-09 |
| `pnpm memory:db-test` / `autoprotect:db-test` | ✅ PASS | 2026-07-09 |
| Token leak none | ✅ NONE | 2026-07-09 |
| hide/reply/delete disabled | ✅ disabled | 2026-07-09 |
| Live actions executed = 0 · normal_criticism never would_auto_hide | ✅ 0 / 0 | 2026-07-09 |

Related: [BETA_CHECKLIST.md](./BETA_CHECKLIST.md) · [BUG_REPORT_TEMPLATE.md](./BUG_REPORT_TEMPLATE.md)
