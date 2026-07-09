# Guardora.ai — Real Meta Test Checklist

Step-by-step for testing Guardora against a **real Facebook Page** with real
comments. This is a **read-only** test: nothing is hidden/replied/deleted on the
platform. Auto-hide stays **shadow mode** (would-hide only); **live actions = 0**.

First run [DEMO_ENVIRONMENT_CHECK.md](./DEMO_ENVIRONMENT_CHECK.md).

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

Related: [DEMO_ENVIRONMENT_CHECK.md](./DEMO_ENVIRONMENT_CHECK.md) ·
[LIVE_META_TEST.md](./LIVE_META_TEST.md) · [TESTING_PLAN.md](./TESTING_PLAN.md)
