/**
 * V1.37.5 — referential integrity, cross-tenant protection & delete lifecycle.
 * Real Postgres. Seed/inspect via owner systemDb (to exercise composite FKs + triggers
 * on the SYSTEM path too); tenant runtime via withTenant. Proves: real FKs reject
 * missing/foreign parents; composite FKs + triggers make cross-tenant links impossible
 * even for the owner; onDelete Cascade/SetNull behave; AuditLog survives user delete;
 * concurrency leaves no orphan; the new join table is RLS-isolated.
 *
 * Run: pnpm referential-integrity:test
 */
import { systemDb, withTenant } from "@guardora/db";

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
  const tA = await systemDb.tenant.create({ data: { name: "RI A", slug: `ri-a-${sfx}` } });
  const tB = await systemDb.tenant.create({ data: { name: "RI B", slug: `ri-b-${sfx}` } });
  const uActor = await systemDb.user.create({ data: { email: `ri-${sfx}@t.test`, name: "Actor" } });
  const mk = async (t: { id: string }, tag: string) => {
    const brand = await systemDb.brand.create({ data: { tenantId: t.id, name: `B${tag}` } });
    const acc = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: brand.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `RI_${tag}_${sfx}`, pageId: `RI_${tag}_${sfx}` } });
    const ci = await systemDb.contentItem.create({ data: { tenantId: t.id, brandId: brand.id, connectedAccountId: acc.id, platform: "facebook_page", kind: "comment", externalId: `ri_c_${tag}_${sfx}`, text: "x", publishedAt: new Date() } });
    const ri = await systemDb.reputationItem.create({ data: { tenantId: t.id, brandId: brand.id, platform: "facebook_page", contentItemId: ci.id, riskLevel: "high", riskCategories: ["scam"], sentiment: "neutral" } });
    return { brand, acc, ci, ri };
  };
  const A = await mk(tA, "A");
  const B = await mk(tB, "B");

  try {
    // ============ FK enforcement (V4-8) ============
    check("4) valid child (ActionQueueItem→ReputationItem) insert succeeds", await (async () => {
      const aqi = await systemDb.actionQueueItem.create({ data: { tenantId: tA.id, brandId: A.brand.id, itemId: A.ri.id, category: "scam", proposedAction: "hide_comment", queueState: "approval_required" } });
      return !!aqi.id;
    })());
    check("5) missing parent id rejected (FK)", await rejects(() => systemDb.autoProtectDecision.create({ data: { tenantId: tA.id, brandId: A.brand.id, itemId: `nope_${sfx}`, matchedCategory: "scam", policyMode: "monitor", decision: "monitor" } })));
    // 6/8) composite FK: A child pointing at B's reputation item is rejected even on the
    //      SYSTEM path (owner) — two separate tenantId columns can't sneak past (id,tenantId).
    check("6/8) cross-tenant parent (composite FK) rejected — owner path too", await rejects(() => systemDb.autoProtectDecision.create({ data: { tenantId: tA.id, brandId: A.brand.id, itemId: B.ri.id, matchedCategory: "scam", policyMode: "monitor", decision: "monitor" } })));
    // 7) parent reassignment to a foreign tenant rejected (composite FK).
    const aqiA = await systemDb.actionQueueItem.findFirstOrThrow({ where: { tenantId: tA.id, itemId: A.ri.id } });
    check("7) reassigning child.itemId to a foreign parent rejected", await rejects(() => systemDb.actionQueueItem.update({ where: { id: aqiA.id }, data: { itemId: B.ri.id } })));

    // ============ Delete behavior (V9-12, P) ============
    // Cascade: deleting the reputation item removes the derived queue item + auto-protect.
    const riDel = (await mk(tA, "DEL")).ri;
    await systemDb.actionQueueItem.create({ data: { tenantId: tA.id, brandId: A.brand.id, itemId: riDel.id, category: "scam", proposedAction: "hide_comment", queueState: "approval_required" } });
    await systemDb.autoProtectDecision.create({ data: { tenantId: tA.id, brandId: A.brand.id, itemId: riDel.id, matchedCategory: "scam", policyMode: "monitor", decision: "monitor" } });
    await systemDb.reputationItem.delete({ where: { id: riDel.id } });
    check("9) Cascade — derived children removed with parent",
      (await systemDb.actionQueueItem.count({ where: { itemId: riDel.id } })) === 0
      && (await systemDb.autoProtectDecision.count({ where: { itemId: riDel.id } })) === 0);

    // ============ History group (V1.37.5B): SetNull FKs + cross-tenant triggers ============
    // Valid same-tenant execution + provider call insert succeeds.
    const exec = await systemDb.platformActionExecution.create({ data: { tenantId: tA.id, brandId: A.brand.id, itemId: A.ri.id, queueItemId: aqiA.id, connectedAccountId: A.acc.id, platform: "facebook_page", actionType: "hide_comment", status: "executed" } });
    await systemDb.providerCall.create({ data: { type: "ai_risk", provider: "x", status: "ok", tenantId: tA.id, brandId: A.brand.id, itemId: A.ri.id } });
    check("H1) valid same-tenant execution + provider call insert succeeds", !!exec.id);
    check("H2) missing reputation item on execution rejected (FK)", await rejects(() => systemDb.platformActionExecution.create({ data: { tenantId: tA.id, brandId: A.brand.id, itemId: `nope_${sfx}`, connectedAccountId: A.acc.id, platform: "facebook_page", actionType: "hide_comment", status: "blocked" } })));
    check("H3) foreign-tenant reputation item on execution rejected (trigger, owner path)", await rejects(() => systemDb.platformActionExecution.create({ data: { tenantId: tA.id, brandId: A.brand.id, itemId: B.ri.id, connectedAccountId: A.acc.id, platform: "facebook_page", actionType: "hide_comment", status: "blocked" } })));
    const aqiB2 = await systemDb.actionQueueItem.create({ data: { tenantId: tB.id, brandId: B.brand.id, itemId: B.ri.id, category: "scam", proposedAction: "hide_comment", queueState: "approval_required" } });
    check("H4) foreign-tenant queueItemId on execution rejected (trigger)", await rejects(() => systemDb.platformActionExecution.create({ data: { tenantId: tA.id, brandId: A.brand.id, itemId: A.ri.id, queueItemId: aqiB2.id, connectedAccountId: A.acc.id, platform: "facebook_page", actionType: "hide_comment", status: "blocked" } })));
    check("H5) foreign-tenant reputation item on provider call rejected (trigger)", await rejects(() => systemDb.providerCall.create({ data: { type: "ai_risk", provider: "x", status: "ok", tenantId: tA.id, brandId: A.brand.id, itemId: B.ri.id } })));
    // Parent delete → history RETAINED with FK set NULL.
    const riHist = (await mk(tA, "HIST")).ri;
    const execH = await systemDb.platformActionExecution.create({ data: { tenantId: tA.id, brandId: A.brand.id, itemId: riHist.id, connectedAccountId: A.acc.id, platform: "facebook_page", actionType: "hide_comment", status: "executed" } });
    const pcH = await systemDb.providerCall.create({ data: { type: "ai_risk", provider: "x", status: "ok", tenantId: tA.id, brandId: A.brand.id, itemId: riHist.id } });
    await systemDb.reputationItem.delete({ where: { id: riHist.id } });
    const execHAfter = await systemDb.platformActionExecution.findUnique({ where: { id: execH.id }, select: { id: true, itemId: true } });
    const pcHAfter = await systemDb.providerCall.findUnique({ where: { id: pcH.id }, select: { id: true, itemId: true } });
    check("H6) parent delete → execution + provider call RETAINED, itemId NULL (SetNull)", !!execHAfter && execHAfter.itemId === null && !!pcHAfter && pcHAfter.itemId === null);

    // 12) AuditLog survives user deletion (actorUserId → SetNull, append-only).
    const al = await systemDb.auditLog.create({ data: { tenantId: tA.id, brandId: A.brand.id, event: "test.actor", actorKind: "human", actorUserId: uActor.id } });
    await systemDb.user.delete({ where: { id: uActor.id } });
    const alAfter = await systemDb.auditLog.findUnique({ where: { id: al.id }, select: { id: true, actorUserId: true, event: true } });
    check("12) AuditLog survives user delete — actorUserId set NULL, row kept", !!alAfter && alAfter.actorUserId === null && alAfter.event === "test.actor");

    // ============ Join table + RLS (J/K, V13-16) ============
    const inc = await systemDb.incident.create({ data: { tenantId: tA.id, brandId: A.brand.id, title: "i", category: "scam", severity: "high", status: "open", relatedItemIds: [A.ri.id] } });
    await systemDb.incidentRelatedItem.create({ data: { tenantId: tA.id, incidentId: inc.id, reputationItemId: A.ri.id } });
    check("J1) join row links incident↔item; foreign item link rejected (composite FK)",
      (await systemDb.incidentRelatedItem.count({ where: { incidentId: inc.id } })) === 1
      && await rejects(() => systemDb.incidentRelatedItem.create({ data: { tenantId: tA.id, incidentId: inc.id, reputationItemId: B.ri.id } })));
    check("13/14) join table RLS — A sees its links, B sees none of A's",
      (await withTenant(tA.id, (db) => db.incidentRelatedItem.count())) >= 1
      && (await withTenant(tB.id, (db) => db.incidentRelatedItem.findMany({ where: { incidentId: inc.id } }))).length === 0);
    check("16) join query with NO tenant filter still only A", (await withTenant(tA.id, (db) => db.incidentRelatedItem.findMany())).every((r) => r.tenantId === tA.id));
    // Cascade: deleting the incident removes its join links.
    await systemDb.incident.delete({ where: { id: inc.id } });
    check("J2) deleting incident cascades its related-item links", (await systemDb.incidentRelatedItem.count({ where: { incidentId: inc.id } })) === 0);

    // ============ Orphan / concurrency (R, V22) ============
    // 5) create with a non-existent parent fails (already shown). 22) concurrent parent
    // delete + child insert leaves NO orphan: either the insert wins then cascades, or the
    // FK/trigger rejects the insert — never a dangling child.
    const riRace = (await mk(tA, "RACE")).ri;
    const [delRes, insRes] = await Promise.allSettled([
      systemDb.reputationItem.delete({ where: { id: riRace.id } }),
      systemDb.actionQueueItem.create({ data: { tenantId: tA.id, brandId: A.brand.id, itemId: riRace.id, category: "scam", proposedAction: "hide_comment", queueState: "approval_required" } }),
    ]);
    const orphanRace = await systemDb.actionQueueItem.count({ where: { itemId: riRace.id, NOT: { itemId: { in: (await systemDb.reputationItem.findMany({ select: { id: true } })).map((r) => r.id) } } } });
    check("22) concurrent parent-delete + child-insert leaves NO orphan", orphanRace === 0, `del=${delRes.status} ins=${insRes.status}`);

    // 22b) concurrent parent delete + HISTORY insert (SetNull FK): either the insert wins
    // (then SetNull on delete) or it rejects — never a dangling execution referencing a gone item.
    const riRaceH = (await mk(tA, "RACEH")).ri;
    await Promise.allSettled([
      systemDb.reputationItem.delete({ where: { id: riRaceH.id } }),
      systemDb.platformActionExecution.create({ data: { tenantId: tA.id, brandId: A.brand.id, itemId: riRaceH.id, connectedAccountId: A.acc.id, platform: "facebook_page", actionType: "hide_comment", status: "executed" } }),
    ]);
    const histOrphan = await systemDb.$queryRawUnsafe<any[]>(`SELECT count(*) c FROM platform_action_executions a WHERE a."itemId" = '${riRaceH.id}' AND NOT EXISTS (SELECT 1 FROM reputation_items r WHERE r.id = a."itemId")`);
    check("22b) concurrent parent-delete + history insert leaves NO orphan", Number(histOrphan[0].c) === 0);

    // Global orphan sweep for ALL fixed relations (incl. history group) == 0.
    const orphans = await systemDb.$queryRawUnsafe<any[]>(`SELECT
      (SELECT count(*) FROM action_queue_items a WHERE NOT EXISTS (SELECT 1 FROM reputation_items r WHERE r.id=a."itemId")) aqi,
      (SELECT count(*) FROM auto_protect_decisions a WHERE NOT EXISTS (SELECT 1 FROM reputation_items r WHERE r.id=a."itemId")) apd,
      (SELECT count(*) FROM incident_related_items a WHERE NOT EXISTS (SELECT 1 FROM incidents i WHERE i.id=a."incidentId")) irl,
      (SELECT count(*) FROM platform_action_executions a WHERE a."itemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reputation_items r WHERE r.id=a."itemId")) pae_item,
      (SELECT count(*) FROM platform_action_executions a WHERE a."queueItemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM action_queue_items q WHERE q.id=a."queueItemId")) pae_q,
      (SELECT count(*) FROM provider_calls a WHERE a."itemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reputation_items r WHERE r.id=a."itemId")) pc`);
    const o = orphans[0];
    check("R4) orphan count 0 for ALL migrated relations (incl. history group)",
      Number(o.aqi) === 0 && Number(o.apd) === 0 && Number(o.irl) === 0 && Number(o.pae_item) === 0 && Number(o.pae_q) === 0 && Number(o.pc) === 0);
  } finally {
    for (const t of [tA.id, tB.id]) {
      await systemDb.incidentRelatedItem.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.auditLog.deleteMany({ where: { tenantId: t } });
      await systemDb.platformActionExecution.deleteMany({ where: { tenantId: t } });
      await systemDb.providerCall.deleteMany({ where: { tenantId: t } });
      await systemDb.autoProtectDecision.deleteMany({ where: { tenantId: t } });
      await systemDb.actionQueueItem.deleteMany({ where: { tenantId: t } });
      await systemDb.incident.deleteMany({ where: { tenantId: t } });
      await systemDb.reputationItem.deleteMany({ where: { tenantId: t } });
      await systemDb.contentItem.deleteMany({ where: { tenantId: t } });
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: t } });
      await systemDb.brand.deleteMany({ where: { tenantId: t } });
    }
    await systemDb.user.deleteMany({ where: { id: uActor.id } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [tA.id, tB.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — referential integrity & orphan prevention (V1.37.5)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
