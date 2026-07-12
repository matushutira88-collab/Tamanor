/**
 * V1.37.4 — SyncRun verdicts + REAL concurrent sync lease. Drives the REAL
 * `runReadOnlySync` against a real Postgres on the RLS runtime. Two concurrent syncs
 * of the SAME account are launched with Promise.all — genuine concurrency, not a mock.
 *
 * Run: pnpm sync-verdict:test
 */
import { systemDb, withTenant } from "@guardora/db";
import { runReadOnlySync } from "../../sync/src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: "Sv", slug: `sv-${sfx}` } });
  const br = await systemDb.brand.create({ data: { tenantId: t.id, name: "SvB" } });
  const mkAcc = (tag: string) => systemDb.connectedAccount.create({
    data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "mock_connected", mode: "placeholder", externalId: `SV_${tag}_${sfx}`, pageId: `SV_${tag}_${sfx}`, health: "healthy" },
  });
  const a1 = await mkAcc("1");
  const a2 = await mkAcc("2");

  try {
    // 31/35) All items OK → verdict success; counts consistent; SyncRun completed.
    const r1 = await runReadOnlySync({ accountId: a1.id, tenantId: t.id }, "manual");
    check("31) all items ok → verdict success", r1.verdict === "success" && r1.ok && r1.created > 0 && r1.errors === 0);
    check("35) counts consistent (created+updated+deduped == fetched)", r1.created + r1.updated + r1.deduped === r1.fetched);
    check("31b) SyncRun row recorded as completed", (await withTenant(t.id, (db) => db.syncRun.count({ where: { connectedAccountId: a1.id, status: "completed" } }))) === 1);

    // Idempotent at the sync level — a second run creates NOTHING new (the same items
    // resolve to deduped or updated, never duplicated). No new content rows appear.
    const contentBefore = await withTenant(t.id, (db) => db.contentItem.count({ where: { connectedAccountId: a1.id } }));
    const r1b = await runReadOnlySync({ accountId: a1.id, tenantId: t.id }, "manual");
    const contentAfter = await withTenant(t.id, (db) => db.contentItem.count({ where: { connectedAccountId: a1.id } }));
    check("idem) second sync of same account → 0 created, no new rows", r1b.verdict === "success" && r1b.created === 0 && (r1b.deduped + r1b.updated) > 0 && contentAfter === contentBefore);

    // 32) One malformed item is isolated → partial_success (a stateful failure hook
    //     fails only the FIRST new item; the rest persist).
    let n = 0;
    const r2 = await runReadOnlySync({ accountId: a2.id, tenantId: t.id }, "manual", {
      beforeReputationCreate: () => { if (n++ === 0) throw new Error("simulated bad item"); },
    });
    check("32) one malformed item → partial_success, item isolated", r2.verdict === "partial_success" && r2.errors >= 1 && r2.created >= 1);
    check("32b) SyncRun recorded as partial_success", (await withTenant(t.id, (db) => db.syncRun.count({ where: { connectedAccountId: a2.id, status: "partial_success" } }))) === 1);
    check("32c) failed item left NO orphan content (content == reputation count)",
      (await withTenant(t.id, (db) => db.contentItem.count({ where: { connectedAccountId: a2.id } })))
      === (await withTenant(t.id, (db) => db.reputationItem.count({ where: { contentItem: { connectedAccountId: a2.id } } }))));

    // 34) TWO CONCURRENT syncs of the SAME fresh account → exactly one runs, the other
    //     is skipped_locked (real lease). No duplicate ingest.
    const a3 = await mkAcc("3");
    const [c1, c2] = await Promise.all([
      runReadOnlySync({ accountId: a3.id, tenantId: t.id }, "manual"),
      runReadOnlySync({ accountId: a3.id, tenantId: t.id }, "automatic"),
    ]);
    const skipped = [c1, c2].filter((r) => r.verdict === "skipped_locked");
    const ran = [c1, c2].filter((r) => r.verdict !== "skipped_locked");
    check("34) concurrent same-account sync → exactly one runs, one skipped_locked", skipped.length === 1 && ran.length === 1);
    check("34b) skipped_locked SyncRun row recorded (not a success)", (await withTenant(t.id, (db) => db.syncRun.count({ where: { connectedAccountId: a3.id, status: "skipped_locked" } }))) === 1);
    // The one that ran produced exactly one authoritative set of content (no duplicates).
    const contentA3 = await withTenant(t.id, (db) => db.contentItem.count({ where: { connectedAccountId: a3.id } }));
    check("34c) no duplicate ingest under concurrency", contentA3 === ran[0]!.created);

    // Lease is released — a subsequent sync succeeds (not permanently blocked).
    const c3 = await runReadOnlySync({ accountId: a3.id, tenantId: t.id }, "manual");
    check("lease-release) lease freed after run — next sync proceeds", c3.verdict === "success");
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

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — SyncRun verdicts & concurrent lease (V1.37.4)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
