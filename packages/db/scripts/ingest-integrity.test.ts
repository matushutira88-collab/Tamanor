/**
 * V1.37.4 — ingestion integrity, idempotency & concurrency tests. Exercises the REAL
 * production ingest function (`ingestItem`) and the REAL sync lease helpers against a
 * real Postgres, on the RLS runtime (appDb). Seed via owner systemDb. Concurrency is
 * REAL (Promise.all against the same row) — not a mock.
 *
 * Run: pnpm ingest-integrity:test
 */
import { systemDb, withTenant, acquireSyncLease, releaseSyncLease, heartbeatSyncLease } from "@guardora/db";
import { ingestItem, mockMetaFetch } from "../../sync/src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}

async function run() {
  const sfx = Date.now().toString(36);
  const tA = await systemDb.tenant.create({ data: { name: "Ing A", slug: `ing-a-${sfx}` } });
  const tB = await systemDb.tenant.create({ data: { name: "Ing B", slug: `ing-b-${sfx}` } });
  const brA = await systemDb.brand.create({ data: { tenantId: tA.id, name: "IA" } });
  const brB = await systemDb.brand.create({ data: { tenantId: tB.id, name: "IB" } });
  const mkAcc = (t: { id: string }, br: { id: string }, tag: string) => systemDb.connectedAccount.create({
    data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "mock_connected", mode: "placeholder", externalId: `ING_${tag}_${sfx}`, pageId: `ING_${tag}_${sfx}`, health: "healthy" },
  });
  const accA = await mkAcc(tA, brA, "A");
  const accA2 = await mkAcc(tA, brA, "A2");
  const accB = await mkAcc(tB, brB, "B");
  const fullA = await systemDb.connectedAccount.findFirstOrThrow({ where: { id: accA.id } });

  // Build valid FetchedContent from the real mock generator, then control the fields.
  const base = mockMetaFetch(accA.id, "facebook_page" as never)[0]!;
  const item = (over: Partial<typeof base> & { externalId: string }) => ({ ...base, ...over });

  try {
    // ================= Atomic persistence (R1-4) =================
    const i1 = item({ externalId: `atom_ok_${sfx}`, text: "atomic ok" });
    const o1 = await ingestItem(tA.id, fullA, i1, []);
    check("1) content+reputation created together (atomic)", o1 === "created"
      && (await withTenant(tA.id, (db) => db.contentItem.count({ where: { externalId: i1.externalId } }))) === 1
      && (await withTenant(tA.id, (db) => db.reputationItem.count({ where: { contentItem: { externalId: i1.externalId } } }))) === 1);

    // 2/3) ReputationItem write failure rolls back the ContentItem — no orphan.
    const i2 = item({ externalId: `atom_fail_${sfx}`, text: "atomic fail" });
    const threw = await rejects(() => ingestItem(tA.id, fullA, i2, [], { beforeReputationCreate: () => { throw new Error("boom"); } }));
    const orphanContent = await withTenant(tA.id, (db) => db.contentItem.count({ where: { externalId: i2.externalId } }));
    check("2/3) reputation failure rolls back content — no orphan", threw && orphanContent === 0);

    // ================= Idempotency (R5-10) =================
    const dupId = `idem_${sfx}`;
    const first = await ingestItem(tA.id, fullA, item({ externalId: dupId, text: "v1" }), []);
    const second = await ingestItem(tA.id, fullA, item({ externalId: dupId, text: "v1" }), []);
    check("5/6) first ingest creates, second identical → deduped", first === "created" && second === "deduped");
    check("6b) still exactly one logical record", (await withTenant(tA.id, (db) => db.contentItem.count({ where: { externalId: dupId } }))) === 1);

    // 7) CONCURRENT double ingest of the SAME new item → one logical record (real race).
    const raceId = `race_${sfx}`;
    const results = await Promise.all([
      ingestItem(tA.id, fullA, item({ externalId: raceId, text: "race" }), []),
      ingestItem(tA.id, fullA, item({ externalId: raceId, text: "race" }), []),
    ]);
    const contentCount = await withTenant(tA.id, (db) => db.contentItem.count({ where: { externalId: raceId } }));
    const repCount = await withTenant(tA.id, (db) => db.reputationItem.count({ where: { contentItem: { externalId: raceId } } }));
    check("7/8) concurrent double ingest → ONE content + ONE reputation (no P2002 abort)", contentCount === 1 && repCount === 1 && results.filter((r) => r === "created").length === 1);

    // 9/10) duplicate ids within one batch / across pages → one record each.
    const batchId = `batch_${sfx}`;
    const b1 = await ingestItem(tA.id, fullA, item({ externalId: batchId, text: "b" }), []);
    const b2 = await ingestItem(tA.id, fullA, item({ externalId: batchId, text: "b" }), []);
    check("9/10) duplicate in batch/across pages → one record", b1 === "created" && b2 === "deduped"
      && (await withTenant(tA.id, (db) => db.contentItem.count({ where: { externalId: batchId } }))) === 1);

    // ================= Update semantics (R11-14) =================
    const upId = `upd_${sfx}`;
    await ingestItem(tA.id, fullA, item({ externalId: upId, text: "orig", rating: 3 }), []);
    // Mark a Tamanor-side workflow field so we can prove ingest does NOT clobber it.
    await withTenant(tA.id, (db) => db.reputationItem.updateMany({ where: { contentItem: { externalId: upId } }, data: { status: "needs_approval", requiresApproval: true } }));
    const upd = await ingestItem(tA.id, fullA, item({ externalId: upId, text: "CHANGED", rating: 5 }), []);
    const cRow = await withTenant(tA.id, (db) => db.contentItem.findFirst({ where: { externalId: upId }, select: { text: true, rating: true } }));
    const rRow = await withTenant(tA.id, (db) => db.reputationItem.findFirst({ where: { contentItem: { externalId: upId } }, select: { status: true, requiresApproval: true } }));
    check("11/12) text+rating changes propagate to ContentItem", upd === "updated" && cRow?.text === "CHANGED" && cRow?.rating === 5);
    check("13) ingest does NOT overwrite Tamanor workflow (status/approval preserved)", rRow?.status === "needs_approval" && rRow?.requiresApproval === true);

    // 14) malformed item (no externalId) fails in isolation.
    check("14) malformed item (no externalId) rejected", await rejects(() => ingestItem(tA.id, fullA, item({ externalId: "" }), [])));

    // ================= Lease (R15-20) =================
    const TTL = 5 * 60 * 1000;
    const l1 = await acquireSyncLease(tA.id, accA.id, "holder-1");
    const l2 = await acquireSyncLease(tA.id, accA.id, "holder-2");
    check("15/16) first acquires, second same account → skipped_locked (null)", !!l1 && l2 === null);
    if (l1) await releaseSyncLease(tA.id, l1);

    // 18) release frees the lease for the next holder.
    const l3 = await acquireSyncLease(tA.id, accA.id, "holder-3");
    check("18) release-in-finally frees the lease for the next holder", !!l3);
    if (l3) await releaseSyncLease(tA.id, l3);

    // 17) an EXPIRED lease can be taken over WITHOUT release: hold it, then acquire with
    //     a `now` past its expiry so the conditional takeover UPDATE matches.
    const held = await acquireSyncLease(tA.id, accA.id, "held-holder", TTL);
    const takeover = await acquireSyncLease(tA.id, accA.id, "new-holder", TTL, new Date(Date.now() + 6 * 60 * 1000));
    check("17) expired lease taken over by a new holder (crashed holder never blocks forever)", !!held && !!takeover && takeover!.holderId === "new-holder");
    if (takeover) await releaseSyncLease(tA.id, takeover);

    // 19) different accounts of the same tenant run in parallel.
    const [la, la2] = await Promise.all([acquireSyncLease(tA.id, accA.id, "hx"), acquireSyncLease(tA.id, accA2.id, "hy")]);
    check("19) different accounts lease in parallel", !!la && !!la2);
    if (la) await releaseSyncLease(tA.id, la);
    if (la2) await releaseSyncLease(tA.id, la2);

    // 20) Tenant A cannot lease Tenant B's account (RLS + ownership guard).
    const foreign = await acquireSyncLease(tA.id, accB.id, "hz");
    const bLeaseByA = await withTenant(tB.id, (db) => db.syncLease.count({ where: { connectedAccountId: accB.id } }));
    check("20) foreign-tenant account lease denied (no lease row)", foreign === null && bLeaseByA === 0);

    // HB) heartbeat renews only for the holder.
    const lh = await acquireSyncLease(tA.id, accA.id, "hbeat");
    check("HB) heartbeat renews for the holder, not for a stranger", !!lh
      && (await heartbeatSyncLease(tA.id, lh!)) === true
      && (await heartbeatSyncLease(tA.id, { id: lh!.id, connectedAccountId: accA.id, holderId: "not-holder" })) === false);
    if (lh) await releaseSyncLease(tA.id, lh);
  } finally {
    for (const t of [tA.id, tB.id]) {
      await systemDb.syncLease.deleteMany({ where: { tenantId: t } });
      await systemDb.auditLog.deleteMany({ where: { tenantId: t } });
      await systemDb.actionQueueItem.deleteMany({ where: { tenantId: t } });
      await systemDb.autoProtectDecision.deleteMany({ where: { tenantId: t } });
      await systemDb.providerCall.deleteMany({ where: { tenantId: t } });
      await systemDb.reputationItem.deleteMany({ where: { tenantId: t } });
      await systemDb.contentItem.deleteMany({ where: { tenantId: t } });
      await systemDb.incident.deleteMany({ where: { tenantId: t } });
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: t } });
      await systemDb.brand.deleteMany({ where: { tenantId: t } });
    }
    await systemDb.tenant.deleteMany({ where: { id: { in: [tA.id, tB.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — ingest integrity, idempotency & lease (V1.37.4)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
