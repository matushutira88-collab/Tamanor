/**
 * V1.58.8 — Vercel-native job runtime against a REAL Postgres (RLS runtime). Proves the DISPATCHER
 * selection (bounded, retry-aware, live-lease-aware) and the budgeted SYNC JOB (checkpoint after each
 * batch, resume convergence, budget stop) — all reusing the REAL runReadOnlySync (mock content, no
 * network) so the V1.58.7 lease/fencing guarantees stay intact end-to-end.
 *
 * Run: pnpm job-checkpoint:test   (spins up a throwaway Postgres, applies all migrations)
 */
import { systemDb, withTenant, acquireSyncLease } from "@guardora/db";
import { selectMetaSyncBatch, runMetaSyncJob } from "../../sync/src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: "Jb", slug: `jb-${sfx}` } });
  const br = await systemDb.brand.create({ data: { tenantId: t.id, name: "JbB" } });
  const mkAcc = (tag: string) => systemDb.connectedAccount.create({
    data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "mock_connected", mode: "placeholder", externalId: `JB_${tag}_${sfx}`, pageId: `JB_${tag}_${sfx}`, health: "healthy" },
  });
  const ours = (batch: { accountId: string }[]) => batch.filter((b) => [a1, a2, a3].some((a) => a.id === b.accountId));
  const a1 = await mkAcc("1"); const a2 = await mkAcc("2"); const a3 = await mkAcc("3");

  try {
    // -------------------------------------------------------------------------
    console.log("Dispatcher — bounded, retry-aware, lease-aware selection");
    const b2 = await selectMetaSyncBatch({ limit: 2, dataMode: "demo" });
    check("dispatch) bounded to limit", b2.length === 2);

    const all = await selectMetaSyncBatch({ limit: 10, dataMode: "demo" });
    check("dispatch) returns all eligible (>=3 incl. ours)", ours(all).length === 3);

    // Live lease on a1 → excluded from selection (dispatcher respects the lease).
    const lease = await acquireSyncLease(t.id, a1.id, "busy-holder");
    const afterLease = await selectMetaSyncBatch({ limit: 10, dataMode: "demo" });
    check("dispatch) account with a LIVE lease is excluded", ours(afterLease).every((b) => b.accountId !== a1.id) && ours(afterLease).length === 2);
    await systemDb.syncLease.deleteMany({ where: { connectedAccountId: a1.id } });
    void lease;

    // Retry backoff: nextRetryAt in the future → excluded.
    await systemDb.connectedAccount.update({ where: { id: a2.id }, data: { nextRetryAt: new Date(Date.now() + 3_600_000) } });
    const afterBackoff = await selectMetaSyncBatch({ limit: 10, dataMode: "demo" });
    check("dispatch) backed-off account (future nextRetryAt) is excluded", ours(afterBackoff).every((b) => b.accountId !== a2.id));
    await systemDb.connectedAccount.update({ where: { id: a2.id }, data: { nextRetryAt: null } });

    // -------------------------------------------------------------------------
    console.log("Sync job — budget, checkpoint, resume convergence");
    // First job: creates items, records a completed SyncRun (the checkpoint), releases the lease.
    const j1 = await runMetaSyncJob({ accountId: a3.id, tenantId: t.id, budgetMs: 45_000, maxBatches: 5 });
    check("job) first run ok + at least one batch + items created", j1.ok && j1.batches >= 1 && j1.created > 0, JSON.stringify(j1));
    const runsAfter1 = await withTenant(t.id, (db) => db.syncRun.count({ where: { connectedAccountId: a3.id, status: "completed" } }));
    check("job) checkpoint persisted (completed SyncRun recorded)", runsAfter1 >= 1);
    const leaseAfter = await systemDb.syncLease.count({ where: { connectedAccountId: a3.id } });
    check("job) lease released after the job (no lingering lease)", leaseAfter === 0);
    const contentAfter1 = await withTenant(t.id, (db) => db.contentItem.count({ where: { connectedAccountId: a3.id } }));

    // Second job: resume converges — the same items dedup, nothing new is created (idempotent).
    const j2 = await runMetaSyncJob({ accountId: a3.id, tenantId: t.id, budgetMs: 45_000, maxBatches: 5 });
    const contentAfter2 = await withTenant(t.id, (db) => db.contentItem.count({ where: { connectedAccountId: a3.id } }));
    check("job) resume creates nothing new (idempotent, no duplicate posts)", j2.created === 0 && contentAfter2 === contentAfter1);
    check("job) resume converges to completed", j2.completed === true && j2.ok);

    // Budget exhaustion: a zero budget stops BEFORE any batch — no partial work, next Cron continues.
    const j3 = await runMetaSyncJob({ accountId: a3.id, tenantId: t.id, budgetMs: 0, maxBatches: 5 });
    check("job) zero budget → 0 batches, budgetExhausted (checkpoint boundary respected)", j3.batches === 0 && j3.budgetExhausted === true);
  } finally {
    await systemDb.syncLease.deleteMany({ where: { tenantId: t.id } });
    await systemDb.auditLog.deleteMany({ where: { tenantId: t.id } });
    await systemDb.actionQueueItem.deleteMany({ where: { tenantId: t.id } });
    await systemDb.autoProtectDecision.deleteMany({ where: { tenantId: t.id } });
    await systemDb.providerCall.deleteMany({ where: { tenantId: t.id } });
    await systemDb.reputationItem.deleteMany({ where: { tenantId: t.id } });
    await systemDb.contentItem.deleteMany({ where: { tenantId: t.id } });
    await systemDb.incident.deleteMany({ where: { tenantId: t.id } });
    await systemDb.syncRun.deleteMany({ where: { tenantId: t.id } });
    await systemDb.connectedAccount.deleteMany({ where: { tenantId: t.id } });
    await systemDb.brand.deleteMany({ where: { tenantId: t.id } });
    await systemDb.tenant.deleteMany({ where: { id: t.id } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Vercel-native dispatcher + budgeted sync job (V1.58.8)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
