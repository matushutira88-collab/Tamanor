/**
 * V1.58.7 — sync lease HEARTBEAT, FENCING generation & interrupted lifecycle against a REAL Postgres on
 * the RLS runtime (tamanor_app). These prove the invariants that unit tests CANNOT: the atomic
 * acquire/takeover, the generation-checked heartbeat/release, and — the crux — that a DISPLACED worker
 * (whose lease expired and was taken over) can no longer write the account's cursor, success markers,
 * health, or release the new holder's lease. Uses the REAL acquireSyncLease / heartbeatSyncLease /
 * releaseSyncLease / writeAccountIfLeaseHeld and the REAL runReadOnlySync (mock content, no network).
 *
 * Run: pnpm sync-fencing:test   (spins up a throwaway Postgres, applies all migrations)
 */
import { systemDb, withTenant, acquireSyncLease, heartbeatSyncLease, releaseSyncLease } from "@guardora/db";
import { runReadOnlySync, writeAccountIfLeaseHeld } from "../../sync/src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const PAST = () => new Date(Date.now() - 60_000);
async function expireLease(connectedAccountId: string) {
  await systemDb.syncLease.updateMany({ where: { connectedAccountId }, data: { expiresAt: PAST() } });
}

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: "Fx", slug: `fx-${sfx}` } });
  const br = await systemDb.brand.create({ data: { tenantId: t.id, name: "FxB" } });
  const mkAcc = (tag: string) => systemDb.connectedAccount.create({
    data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "mock_connected", mode: "placeholder", externalId: `FX_${tag}_${sfx}`, pageId: `FX_${tag}_${sfx}`, health: "healthy" },
  });

  try {
    // ---------------------------------------------------------------------------
    console.log("Group B — lease acquire & generation");
    const b = await mkAcc("B");
    const a1 = await acquireSyncLease(t.id, b.id, "holderA");
    check("B14) first acquire returns a handle with generation >= 1", !!a1 && a1.generation >= 1n, `${a1?.generation}`);
    const gen1 = a1!.generation;

    // B15) heartbeat renews expiry but does NOT change the generation.
    const hb = await heartbeatSyncLease(t.id, a1!);
    const afterHb = await systemDb.syncLease.findUnique({ where: { connectedAccountId: b.id }, select: { generation: true } });
    check("B15) heartbeat renews without changing generation", hb === true && afterHb?.generation === gen1);

    // B16) re-acquire while the lease is LIVE (even same holder) → null (deterministic "already held").
    const reacq = await acquireSyncLease(t.id, b.id, "holderA");
    check("B16) re-acquire while live → null (deterministic)", reacq === null);

    // B18) a foreign worker cannot take a LIVE lease.
    const foreign = await acquireSyncLease(t.id, b.id, "holderB");
    check("B18) live lease not taken by another holder", foreign === null);

    // B17/B20) takeover after expiry mints a STRICTLY HIGHER generation (monotonic).
    await expireLease(b.id);
    const a2 = await acquireSyncLease(t.id, b.id, "holderB");
    check("B17) takeover after expiry succeeds for the new holder", !!a2 && a2.holderId === "holderB");
    check("B20) takeover generation strictly increases (monotonic)", !!a2 && a2.generation > gen1, `${gen1} -> ${a2?.generation}`);
    await releaseSyncLease(t.id, a2!);

    // B19) concurrent acquire on a FRESH account → exactly one winner.
    const bc = await mkAcc("BC");
    const [w1, w2] = await Promise.all([
      acquireSyncLease(t.id, bc.id, "c1"),
      acquireSyncLease(t.id, bc.id, "c2"),
    ]);
    check("B19) concurrent acquire → exactly one winner", [w1, w2].filter(Boolean).length === 1);
    await systemDb.syncLease.deleteMany({ where: { connectedAccountId: bc.id } });

    // ---------------------------------------------------------------------------
    console.log("Group D — fencing race (displaced worker is powerless)");
    const d = await mkAcc("D");
    const A = await acquireSyncLease(t.id, d.id, "workerA"); // generation gA
    await expireLease(d.id);
    const B = await acquireSyncLease(t.id, d.id, "workerB"); // takeover → generation gB > gA
    check("D31/D33) A then B; B generation > A generation", !!A && !!B && B!.generation > A!.generation, `${A?.generation} < ${B?.generation}`);

    // Snapshot the account BEFORE any stale write.
    const before = await systemDb.connectedAccount.findUnique({ where: { id: d.id }, select: { lastCursor: true, lastSuccessfulSyncAt: true, health: true } });

    // D34) stale A cannot write the cursor.
    const rCursor = await withTenant(t.id, (db) => writeAccountIfLeaseHeld(db, d.id, A!, { lastCursor: "STALE_CURSOR" }));
    // D35) stale A cannot write lastSuccessfulSyncAt.
    const rSucc = await withTenant(t.id, (db) => writeAccountIfLeaseHeld(db, d.id, A!, { lastSuccessfulSyncAt: new Date() }));
    // D37) stale A cannot reset account health.
    const rHealth = await withTenant(t.id, (db) => writeAccountIfLeaseHeld(db, d.id, A!, { health: "healthy", lastError: null }));
    const afterStale = await systemDb.connectedAccount.findUnique({ where: { id: d.id }, select: { lastCursor: true, lastSuccessfulSyncAt: true, health: true } });
    check("D34) stale worker cannot write cursor (0 rows)", rCursor === 0 && afterStale?.lastCursor === before?.lastCursor);
    check("D35) stale worker cannot write lastSuccessfulSyncAt (0 rows)", rSucc === 0 && afterStale?.lastSuccessfulSyncAt?.getTime() === before?.lastSuccessfulSyncAt?.getTime());
    check("D37) stale worker cannot reset account health (0 rows)", rHealth === 0 && afterStale?.health === before?.health);

    // D24) stale A cannot heartbeat; current B can.
    check("D24) stale worker heartbeat → false (lease lost)", (await heartbeatSyncLease(t.id, A!)) === false);
    check("D24b) current worker heartbeat → true", (await heartbeatSyncLease(t.id, B!)) === true);

    // D38) stale A cannot release B's lease; the lease survives; B can.
    const relA = await releaseSyncLease(t.id, A!);
    const stillThere = await systemDb.syncLease.findUnique({ where: { connectedAccountId: d.id }, select: { holderId: true } });
    check("D38) stale worker release → not owner (released=false), B's lease survives", relA.released === false && stillThere?.holderId === "workerB");

    // D39) current B CAN write all critical states (1 row), then release cleanly.
    const rB = await withTenant(t.id, (db) => writeAccountIfLeaseHeld(db, d.id, B!, { lastCursor: "B_CURSOR", lastSuccessfulSyncAt: new Date(), health: "healthy" }));
    const relB = await releaseSyncLease(t.id, B!);
    check("D39) current worker writes all critical states (1 row) + clean release", rB === 1 && relB.released === true);

    // D42) concurrent stale + current write is deterministic — only the current holder lands.
    const d2 = await mkAcc("D2");
    const A2 = await acquireSyncLease(t.id, d2.id, "wA");
    await expireLease(d2.id);
    const B2 = await acquireSyncLease(t.id, d2.id, "wB");
    const [ra, rb] = await Promise.all([
      withTenant(t.id, (db) => writeAccountIfLeaseHeld(db, d2.id, A2!, { lastCursor: "FROM_A" })),
      withTenant(t.id, (db) => writeAccountIfLeaseHeld(db, d2.id, B2!, { lastCursor: "FROM_B" })),
    ]);
    const finalCursor = await systemDb.connectedAccount.findUnique({ where: { id: d2.id }, select: { lastCursor: true } });
    check("D41/D42) concurrent stale+current → only current lands (no TOCTOU)", ra === 0 && rb === 1 && finalCursor?.lastCursor === "FROM_B");
    await releaseSyncLease(t.id, B2!);

    // ---------------------------------------------------------------------------
    console.log("Group E — run lifecycle (interrupted is never success)");
    const e = await mkAcc("E");
    // E43) a normal run completes success and SETS the account success markers.
    const ok = await runReadOnlySync({ accountId: e.id, tenantId: t.id }, "manual");
    const afterOk = await systemDb.connectedAccount.findUnique({ where: { id: e.id }, select: { lastSuccessfulSyncAt: true } });
    check("E43) normal run → success", ok.verdict === "success" && ok.ok);
    check("E43b) success sets lastSuccessfulSyncAt", !!afterOk?.lastSuccessfulSyncAt);
    const successMarker = afterOk?.lastSuccessfulSyncAt?.getTime();

    // E45/E47) a run that loses its lease → verdict `interrupted` (NOT success), SyncRun row interrupted.
    const interrupted = await runReadOnlySync({ accountId: e.id, tenantId: t.id }, "automatic", { simulateLeaseLost: true });
    check("E45) lease-lost run → verdict interrupted (never success)", interrupted.verdict === "interrupted" && interrupted.ok === false);
    const interruptedRows = await withTenant(t.id, (db) => db.syncRun.count({ where: { connectedAccountId: e.id, status: "interrupted" } }));
    check("E45b) SyncRun row recorded as interrupted", interruptedRows === 1);
    const noSuccessRow = await withTenant(t.id, (db) => db.syncRun.count({ where: { connectedAccountId: e.id, status: "completed", id: interrupted.syncRunId ?? "none" } }));
    check("E47) the interrupted run is NOT also recorded completed", noSuccessRow === 0);

    // E48/E49) the interrupted run did NOT overwrite the newer/earlier success aggregate on the account.
    const afterInterrupted = await systemDb.connectedAccount.findUnique({ where: { id: e.id }, select: { lastSuccessfulSyncAt: true } });
    check("E48/E49) interrupted run leaves the account success aggregate untouched", afterInterrupted?.lastSuccessfulSyncAt?.getTime() === successMarker);
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

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — sync lease heartbeat, fencing & interrupted lifecycle (V1.58.7)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
