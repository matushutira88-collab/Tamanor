# Guardora.ai — Demo / Dry-Run Environment Check

Run this **before** any demo, beta session, or internal dry-run. It keeps the
environment safe (no live actions, no accidental data loss) and predictable.

---

## 1. Stop stale processes

A stale worker from an older build can re-add mock-fetch items (historically the
source of stray `[MOCK]` content). Always clear processes first:

```bash
pkill -9 -f "apps/worker"    # stop any auto-sync worker
pkill -9 -f "next dev"       # stop stray dev servers
pkill -9 -f "next-server"    # stop stray prod servers
pkill -9 -f "next start"
# verify nothing Guardora-related is left:
ps aux | grep -iE "tsx|worker|next" | grep -v grep | grep -i guardora
```

Expected: **no rows** (0 processes) before you start fresh.

## 2. Start only the current web + (optional) worker

```bash
# web (dev)
pnpm dev
# OR production-style
pnpm --filter @guardora/web build && pnpm --filter @guardora/web start

# worker (ONLY if demoing auto-sync; otherwise leave it off)
pnpm dev:worker
```

Run **one** web server and at most **one** worker. Don't leave old ones running.

## 3. Seed caution (do NOT wipe real accounts)

The seed **truncates `connected_accounts`**. It refuses to run if a **real**
(non-mock) connected account exists, unless `SEED_FORCE=1`.

- The current demo data (V1.19) is already seeded — **you normally do NOT re-seed.**
- **Never** pass `SEED_FORCE=1` if a real Facebook Page (or other live account)
  is connected, unless you have consciously confirmed it is safe to remove it.
- Check first:

```bash
docker exec guardora_postgres psql -U guardora -t -A -c \
  "select count(*) from connected_accounts where status <> 'mock_connected';"
```

If this is `> 0`, a real account exists — **do not force-seed.**

## 4. `.env` is not committed

```bash
grep -c '^\.env$' .gitignore   # expect >= 1
git ls-files 2>/dev/null | grep -c '^\.env$'   # expect 0
```

## 5. Expected safe env flags

| Flag | Safe demo value | Meaning |
|------|-----------------|---------|
| `AUTO_SYNC_ENABLED` | `false` (default) | no background polling unless demoing it |
| `META_LIVE_SYNC` | `false` (or `true` only to demo a live read-only sync) | read-only Graph reads |
| `TRANSLATION_ENABLED` | `false` (default) | no external translation provider |
| `TRANSLATION_PROVIDER` | `none` | honest "translation unavailable" |
| `AI_RISK_PROVIDER_ENABLED` | `false` (default) | Risk Rules V1 only |
| `AI_RISK_PROVIDER` | `none` | no external AI, no `mock` in production |

## 6. Live platform actions are disabled

```bash
cd apps/worker && DATABASE_URL="x" npx tsx -e "import('@guardora/connectors').then(async m=>{const c=await import('@guardora/core');const rt=m.createConnectorRuntime(c.Platform.FacebookPage,c.ConnectorMode.ReadOnly);const h=await rt.hide({externalContentId:'x'});const r=await rt.reply({externalContentId:'x',text:'y'});const d=await rt.delete({externalContentId:'x'});console.log('disabled='+[h.disabled,r.disabled,d.disabled].join(','));process.exit(0)})"
```

Expected: `disabled=true,true,true`. Auto-hide is **shadow mode only**; live
actions executed must be **0**.

---

Related: [TESTING_PLAN.md](./TESTING_PLAN.md) · [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) ·
[LAUNCH_SAFETY_CHECKLIST.md](./LAUNCH_SAFETY_CHECKLIST.md)
