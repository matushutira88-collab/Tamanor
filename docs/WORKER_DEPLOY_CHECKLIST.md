# Worker Deploy Checklist — V1.58.7 (Sync Lease Heartbeat, Fencing & Fail-Closed Runtime)

The Tamanor **worker** is a long-running Node process on a persistent host **outside Vercel**. This
repo does NOT contain a worker hosting/deploy definition (no Dockerfile, Procfile, systemd unit, or CI
deploy job for the worker). This checklist is the operator runbook to ship a worker change safely; it
must be executed by whoever owns the worker host. Nothing here should be automated blindly.

> **Fencing status after the V1.58.7 DB migration but BEFORE this worker deploy:** the schema is ready
> (`sync_leases.generation`, `sync_lease_generation_seq`, `interrupted` state) and is backward compatible
> with the old worker, but the fencing/heartbeat INVARIANTS are **NOT active** until the new worker code
> below is actually running. Do not claim fencing is live until step 13–14 pass on the host.

## Secrets discipline (applies to every step)
Never print or paste: access tokens, app secret, `appsecret_proof`, `DATABASE_URL`, `APP_DATABASE_URL`,
`TOKEN_ENCRYPTION_KEY`, session tokens, password hashes, or raw webhook payloads. Startup logs already
redact these — do not add debug logging that echoes env values.

---

1. **Identify the hosting + process manager.** Determine where the worker runs (VM / container host /
   PaaS) and what supervises it (systemd, pm2, Docker `restart: always`, nomad, etc.). Record the exact
   restart command and log location. If this is undocumented, document it now before proceeding.

2. **Record the current commit/build.** On the host, note the currently-deployed git SHA and build
   artifact (for rollback). `git rev-parse HEAD` in the worker's checkout, or the image tag.

3. **Confirm runtime env WITHOUT a physical `.env`.** The production start command is
   `pnpm --filter @guardora/worker start` → `tsx src/index.ts`, which reads `process.env` only (V1.58.6).
   Confirm the process manager injects env directly (systemd `Environment=`/`EnvironmentFile` outside the
   repo, container env, or PaaS secrets) — **not** a committed `.env`. `start:local` (dotenv) is dev only.

4. **Verify all required env vars are present** (names only; never echo values):
   `NODE_ENV=production`, `DATABASE_URL` (owner), `APP_DATABASE_URL` (tamanor_app, must DIFFER from owner),
   `TOKEN_ENCRYPTION_MODE` (`aes-gcm` or `kms`, not `plaintext`), `TOKEN_ENCRYPTION_KEY`,
   `GUARDORA_DATA_MODE` (explicit `real`/`demo`), `AUTO_SYNC_ENABLED`, `META_APP_ID`, `META_APP_SECRET`,
   `META_LIVE_SYNC`, `WORKER_SYNC_INTERVAL_MS`, `SYNC_LEASE_TTL_MS` (~300000), `SYNC_LEASE_HEARTBEAT_MS`
   (~75000, must be ≤ TTL/2), `WORKER_SHUTDOWN_GRACE_MS` (~25000). The worker's fail-closed config
   validator (V1.58.7) refuses to start if any of these is missing/unsafe — that is the enforcement.

5. **Apply the DB migration (decision).** The `20260721090000_v1_58_7_sync_lease_fencing` migration is
   ADDITIVE and backward compatible with the OLD worker (nullable-safe `generation BIGINT DEFAULT 0`,
   a new sequence, an additive `interrupted` enum value, one sequence GRANT). It is SAFE to deploy the
   migration BEFORE the worker: the old worker keeps running unchanged; fencing simply stays inactive
   until the new worker runs. Apply with `pnpm db:migrate:deploy` (owner `DATABASE_URL`). If for any
   reason the old worker would break on the new schema, do NOT deploy the migration — but it does not.

6. **Deploy the new worker commit** to the host (git pull to the target SHA / new image), matching the
   commit that carries V1.58.7.

7. **Install dependencies** for that commit: `pnpm install --frozen-lockfile`.

8. **Start the worker with the production start command:** `pnpm --filter @guardora/worker start`
   (or the supervisor's managed equivalent that runs `tsx src/index.ts`). Do NOT use `start:local`.

9. **Watch startup logs (no secrets).** Expect, in order: `worker.starting` → config validation passes
   → `worker.boot` → RLS preflight `worker.preflight.ok` → `worker.ready`. A config problem logs
   `worker.config_invalid` with a variable NAME + reason (never a value) and the process exits non-zero.

10. **Confirm config validation passed** — the process reached `worker.ready`; there is no
    `worker.config_invalid` line. If it exited, fix the named env var and restart (see step 20).

11. **Confirm `worker.ready`** was emitted (readiness is true ONLY after config validation + DB/RLS
    connectivity + scheduler init). A worker that failed any of those never reports ready.

12. **Confirm the scheduler is running** — the maintenance tick heartbeat (`worker.heartbeat`) appears on
    its cadence and, if `AUTO_SYNC_ENABLED=true`, `autosync.ENABLED` was logged.

13. **Confirm a lease acquire** on a real sync — `sync.lease_acquired` appears when an account syncs.

14. **Confirm heartbeat** — for a longer sync, `sync.lease_heartbeat` events appear at the heartbeat
    cadence; a `sync.lease_lost`/`sync.fencing_rejected` should only ever appear on a genuine takeover.

15. **Perform a controlled restart** (supervisor restart) to exercise shutdown.

16. **Confirm graceful shutdown** — on SIGTERM the logs show `worker.shutdown_started` → the scheduler
    stops taking new work → active runs finalize as `interrupted` (never success) → either
    `worker.shutdown_completed` (clean, exit 0) or `worker.shutdown_timeout` (deadline hit, non-zero exit
    → supervisor restarts). Confirm the process actually exited and was restarted.

17. **Confirm no old process runs in parallel.** Exactly ONE worker process/replica must run against the
    same DB. Two concurrent workers are safe for correctness (fencing/lease guarantee single active sync
    per account) but the deploy intent is a clean cutover — verify the old process is gone.

18. **Rollback procedure.** If startup fails or behavior regresses: stop the new worker, redeploy the
    previous SHA/image (step 2), restart. The DB migration does NOT need rollback (it is additive and the
    old worker ignores `generation`/`interrupted`). If you must revert the schema anyway, drop the column
    and sequence — but this is not required and not recommended.

19. **How to verify fencing WITHOUT touching customer data.** Do not fabricate takeovers on live tenant
    accounts. Instead, run the integration proof against a throwaway Postgres: `pnpm sync-fencing:test`
    (spins its own container, applies all migrations, exercises acquire/heartbeat/fencing/interrupted with
    the real `tamanor_app` role). In production, observe the ops stream: a healthy fleet shows
    `sync.lease_acquired` + periodic `sync.lease_heartbeat` and NO `sync.lease_lost` under normal
    single-worker operation.

20. **What to do on `worker.config_invalid` or `sync.lease_lost`.**
    - `worker.config_invalid`: read the reason (a variable NAME, never a value), fix that env var on the
      host, restart. The worker is fail-closed — it will not boot into a degraded/demo/no-op mode.
    - `sync.lease_lost` / `sync.fencing_rejected`: the run was interrupted because another worker held the
      lease at a newer generation. Under intended single-worker operation this signals two workers running
      concurrently — verify step 17 (kill the stray) or a host clock/DB issue. The affected run recorded
      `interrupted` (never a false success); the account's state was NOT corrupted by the displaced worker.
