# Guardora.ai — Real Meta Test Checklist

Step-by-step for testing Guardora against a **real Facebook Page** with real
comments. This is a **read-only** test: nothing is hidden/replied/deleted on the
platform. Auto-hide stays **shadow mode** (would-hide only); **live actions = 0**.

First run [DEMO_ENVIRONMENT_CHECK.md](./DEMO_ENVIRONMENT_CHECK.md).

---

## Reset to real-only (V1.21D — recommended first)

The main app now ships **without demo data**. To clean an existing dev DB of any
leftover demo/mock content while **keeping your real Konfigurátor page and its
real comments**:

```bash
pnpm real:reset-content                        # dry-run summary (nothing deleted)
REAL_RESET_CONFIRM=YES pnpm real:reset-content # apply
```

Kept: real Konfigurátor account (pageId `1165524636643112`), its real synced
comments, real tokens, login tenant/user. Removed: demo brands (Northwind Coffee),
mock/demo accounts, `mock_` content, demo audit, "Demo Workspace" label.

A **fresh** DB (`pnpm db:seed`) is already real-only (no demo). The demo dataset
is only created explicitly via `pnpm demo:seed`.

## Quick real internal test (V1.21C — clean, real-only)

The fast path for a clean real test with **no demo pollution**:

```bash
# 1) stop stale workers
pkill -9 -f "apps/worker"; pkill -9 -f "next dev"; pkill -9 -f "next-server"

# 2-4) real mode + fast auto-sync (in .env)
GUARDORA_DATA_MODE=real
AUTO_SYNC_ENABLED=true
AUTO_SYNC_INTERVAL_SECONDS=60

# 5) preview the cleanup (safe), then apply it (removes demo brands, keeps the
#    real Konfigurátor page — pageId 1165524636643112 is protected)
pnpm real:cleanup-demo                       # dry-run summary, nothing deleted
REAL_CLEANUP_CONFIRM=YES pnpm real:cleanup-demo   # apply

# 6-7) run web + worker
pnpm dev
pnpm dev:worker
```

8. Post a comment on the real Facebook Page.
9. Wait 60–90 seconds (one auto-sync interval — polling, not realtime).
10. Verify **Dashboard / Inbox / Accounts → account detail**:
    - the **"Real test mode"** banner is shown,
    - **no Demo Workspace / Northwind Coffee / `[MOCK]`** anywhere,
    - the real comment appears in the inbox after the automatic sync,
    - Accounts shows the real page (**Live**, **Read-only**) with auto-sync
      status, last automatic/manual sync, and the next-sync estimate,
    - **Live actions executed = 0**.

`real:cleanup-demo` **never deletes** a real connected account or the protected
Konfigurátor page; it prints a summary and requires `REAL_CLEANUP_CONFIRM=YES`.

---

## 1. Kill stale workers

```bash
pkill -9 -f "apps/worker"; pkill -9 -f "next dev"; pkill -9 -f "next-server"; pkill -9 -f "next start"
ps aux | grep -iE "tsx|worker|next" | grep -v grep | grep -i guardora   # expect nothing
```

A stale worker uses an old build and can produce confusing/duplicate results.

## 2. Load env & verify auto-sync is enabled

```bash
grep -E "AUTO_SYNC_ENABLED|AUTO_SYNC_INTERVAL_SECONDS|META_LIVE_SYNC" .env
```

Expected for a real auto-sync test:

```
AUTO_SYNC_ENABLED=true
AUTO_SYNC_INTERVAL_SECONDS=300
META_LIVE_SYNC=true
```

If `AUTO_SYNC_ENABLED` is not `true`, **the worker will log `autosync.DISABLED`
and never auto-sync** — only the manual "Run read-only sync" button works.

## 3. Start the web app

```bash
pnpm dev
# or prod-style: pnpm --filter @guardora/web build && pnpm --filter @guardora/web start
```

## 4. Start the worker (required for auto-sync)

```bash
pnpm dev:worker
```

Watch the log — you should see:

```
worker.boot            { autoSyncEnabled: true, autoSyncIntervalSeconds: 300, ... }
autosync.ENABLED       { intervalSeconds: 300 }
worker.autosync.eligible  { connected: N, eligible: N, skippedBackoff: 0 }
worker.autosync.account.start/done  { pageName, pageId, fetched, created, deduped, errors, trigger: "automatic" }
autosync.done          { eligibleAccounts, createdItems, skippedBackoff }
```

If you see `autosync.DISABLED`, fix `AUTO_SYNC_ENABLED` in `.env` and restart the
worker. Manual and automatic sync call the **same** `runReadOnlySync` — only the
`trigger` differs.

## 5. Confirm the connected Page in the UI

Open **Dashboard → Accounts**. The **Connected accounts** card shows the real
Page **first**, marked **Live** (demo/mock accounts are marked **Demo**). Verify:
Page name, **Page ID**, platform = Facebook Page, health, last sync, granted
permissions, connected time, **Read-only** mode. The **Auto-sync status** card
shows enabled/disabled, worker-required, last automatic sync, last manual sync,
next-sync estimate, and last error.

## 6. Post test comments on the real Facebook Page

- `Tovar mi prišiel neskoro, som nespokojný.`  → normal criticism
- `klikni a vyhraj iPhone`                      → spam/phishing/scam
- `nenažratý kokot`                             → profanity/personal attack
- `Poďte ku konkurencii, píšte mi DM`           → competitor promo

## 7. Wait up to 5 minutes (one auto-sync interval)

Do **not** click anything. The worker runs `runReadOnlySync(..., "automatic")`
on its interval.

## 8. Confirm automatic sync happened without a manual click

- Accounts → Auto-sync status shows a recent **Last automatic sync**.
- Worker log shows `autosync.done` with `createdItems > 0` on first fetch.

## 9. Verify results in the Inbox / Auto-Protect

| Comment | Expected |
|---|---|
| "Tovar mi prišiel neskoro…" | normal_criticism → **monitor** (preserved, never hidden) |
| "klikni a vyhraj iPhone" | high/critical, scam/phishing → **would_auto_hide** |
| "nenažratý kokot" | high/critical, profanity/personal_attack → **would_auto_hide** |
| "Poďte ku konkurencii, píšte mi DM" | competitor_promo → **requires_approval** |

Use the **Inbox Auto-Protect filters** (Would auto-hide / Requires approval /
Normal criticism preserved) to confirm. In each item's **Auto-Protect decision**
card: **"Live action executed: No"**. Dashboard **Live actions executed = 0**.

## 10. Safety re-check

- **Live actions executed = 0** (nothing hidden/replied/deleted on the Page).
- Auto-hide is **shadow mode only**; the client can toggle categories in
  **Rules → Auto-Protect**. `normal_criticism` can never be auto-hidden.

Automated equivalent: `pnpm realmeta:test`.

---

## 11. Controlled live hide test (V1.21B — advanced, opt-in only)

**Default is shadow mode. Do this only for a deliberate, controlled live test on a
single test Page (e.g. Konfigurátor).** Reply/delete are never enabled; Instagram
is out of scope.

Preconditions:
- The Konfigurátor Page is connected as a **real** account (not demo), health
  **healthy**, and granted **`pages_manage_engagement`** (Page moderation task).
- You accept that matching comments **will be hidden on Facebook**.

Steps:

1. **Stage 1 — dry-run first (no Graph call):**
   ```
   LIVE_ACTIONS_ENABLED=true
   FACEBOOK_HIDE_ENABLED=true
   LIVE_ACTIONS_DRY_RUN=true
   ```
   Restart the worker. In **Rules → Auto-Protect**, set a harmful category (e.g.
   `profanity`) to **"Auto-hide live — controlled beta"** for the Konfigurátor
   brand (confirm the warning). Post a matching comment. Confirm the inbox item
   shows **Dry-run live action** and the dashboard shows a **Dry-run hide attempt**
   — and that **nothing was hidden** on the Page (live executed = 0).

2. **Stage 2 — real live (only when Stage 1 looks correct):** — **LOCKED, see §12.**
   ```
   LIVE_ACTIONS_DRY_RUN=false
   LIVE_HIDE_TEST_CONFIRM=YES   # V1.25 second lock — without it, hides stay blocked
   ```
   Restart the worker. Post another matching comment. Within one sync interval the
   comment should be **hidden on the Facebook Page**; the inbox item shows **Live
   hide executed** and a `platform_action_executions` row with status `executed`.
   Without `LIVE_HIDE_TEST_CONFIRM=YES` the execution is recorded **blocked
   (`live_confirm_required`)** and **nothing is hidden**.

3. **Rollback:** the external comment id + execution id are stored. Live unhide is
   not yet automated (documented TODO) — unhide manually in Facebook if needed.

4. **Turn it back off** after the test: set `LIVE_ACTIONS_DRY_RUN=true` (or the
   category back to `auto_hide_shadow`) and restart the worker.

Safety: `normal_criticism` is never hidden; confidence must be ≥ 0.8; only
`facebook_page`; only the categories you explicitly set to live.

---

## 12. First controlled Facebook hide — dry-run via Action Queue (V1.25)

This is the **canonical first live-path test**. It exercises the ControlPolicy
gate stack through the **manual approval** flow (Action Queue detail), staying in
**dry-run** so **no Graph call** is made and **nothing is hidden on Facebook**.

### Stage 1 — dry-run (safe; do this first)

1. **Stop the worker** (avoid an autonomous path racing the manual test):
   ```bash
   pkill -9 -f "apps/worker"
   ```
2. **Set env for dry-run** (`.env`):
   ```
   GUARDORA_DATA_MODE=real
   LIVE_ACTIONS_ENABLED=true
   FACEBOOK_HIDE_ENABLED=true
   LIVE_ACTIONS_DRY_RUN=true
   LIVE_HIDE_TEST_CONFIRM=NO
   ```
3. **Start web + worker:** `pnpm dev` and `pnpm dev:worker`.
4. **Post a harmful comment** on the real Konfigurátor Page (e.g. a profanity /
   personal attack that maps to an autonomous-eligible category).
5. **Wait one sync interval** for the read-only sync to ingest it.
6. Open **Dashboard → Action Queue → the item**. Confirm the **🧪 Controlled
   Facebook Hide Test** panel shows:
   - account = Konfigurátor, pageId `1165524636643112`, permissions include
     `pages_manage_engagement`,
   - env gates `LIVE=true · FB_HIDE=true · DRY_RUN=true`,
   - category / confidence / linked policy,
   - **Expected result = Dry-run (no live action)**.
7. **Approve** the item. Expect the notice **"Dry-run prepared. No Facebook
   comment was hidden."**
8. **Verify:**
   - a `platform_action_executions` row with status **`dry_run`**, `queueItemId`
     + `policyId` set, no token in the row,
   - Command Center **dry-run count +1**, **live executed = 0**,
   - the **Facebook comment is still visible** on the Page,
   - Timeline + audit show the dry-run attempt.

Automated equivalent: `pnpm fbhide:test` and the controlled-hide dry-run tests.

### Stage 2 — real live hide (LOCKED — explicit opt-in only)

**Do not perform Stage 2 until Stage 1 has been reviewed and you explicitly
decide to hide a real comment.** Two independent locks must both be set:

```
LIVE_ACTIONS_DRY_RUN=false
LIVE_HIDE_TEST_CONFIRM=YES
```

When `canExecuteLive` is true the Control Center and the Action Queue panel show a
**bold red "Live Facebook hide is enabled"** warning. Until `LIVE_HIDE_TEST_CONFIRM
=YES` is also set, every hide is recorded **blocked (`live_confirm_required`)** and
**nothing is hidden** — this is the accidental-live-test guard. Approving with both
locks set will hide the real comment via `POST /{comment-id}` `is_hidden=true`.

After the test, restore `LIVE_ACTIONS_DRY_RUN=true` and `LIVE_HIDE_TEST_CONFIRM=NO`.

---

Related: [DEMO_ENVIRONMENT_CHECK.md](./DEMO_ENVIRONMENT_CHECK.md) ·
[LIVE_META_TEST.md](./LIVE_META_TEST.md) · [TESTING_PLAN.md](./TESTING_PLAN.md)
