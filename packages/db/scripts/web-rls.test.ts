/**
 * V1.37.3C — WEB tenant isolation tests. Exercises the exact runtime the migrated
 * web pages/actions/services now use: `withTenant(session.tenantId, db => …)` on the
 * RLS runtime client (appDb / tamanor_app), plus the REAL permission predicate
 * (@guardora/core `can`) that requireSession/assertCan enforce. Seed via the owner
 * systemDb; every read/write runs under RLS. Two tenants A and B.
 *
 * Run: pnpm web-rls:test
 */
import { systemDb, withTenant } from "@guardora/db";
import { Permission, Role, can } from "@guardora/core";

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
  const tA = await systemDb.tenant.create({ data: { name: "Web A", slug: `web-a-${sfx}` } });
  const tB = await systemDb.tenant.create({ data: { name: "Web B", slug: `web-b-${sfx}` } });
  const uOwner = await systemDb.user.create({ data: { email: `web-o-${sfx}@t.test`, name: "Owner" } });
  const uViewer = await systemDb.user.create({ data: { email: `web-v-${sfx}@t.test`, name: "Viewer" } });
  await systemDb.membership.create({ data: { userId: uOwner.id, tenantId: tA.id, role: "owner" } });
  await systemDb.membership.create({ data: { userId: uViewer.id, tenantId: tA.id, role: "viewer" } });
  await systemDb.membership.create({ data: { userId: uOwner.id, tenantId: tB.id, role: "owner" } }); // B has its own owner membership

  const mk = async (t: { id: string }, tag: string) => {
    const brand = await systemDb.brand.create({ data: { tenantId: t.id, name: `Brand ${tag}` } });
    const acc = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: brand.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `${tag}_${sfx}`, pageId: `${tag}_${sfx}` } });
    const ci = await systemDb.contentItem.create({ data: { tenantId: t.id, brandId: brand.id, connectedAccountId: acc.id, platform: "facebook_page", kind: "comment", externalId: `c_${tag}_${sfx}`, text: tag, publishedAt: new Date() } });
    const ri = await systemDb.reputationItem.create({ data: { tenantId: t.id, brandId: brand.id, platform: "facebook_page", contentItemId: ci.id, status: "classified", riskLevel: "high", riskConfidence: 0.9, riskCategories: ["scam"], sentiment: "negative" } });
    const dec = await systemDb.moderationDecision.create({ data: { tenantId: t.id, brandId: brand.id, reputationItemId: ri.id, action: "hide", status: "proposed", proposedByKind: "human", confidence: 0.9 } });
    const aqi = await systemDb.actionQueueItem.create({ data: { tenantId: t.id, brandId: brand.id, itemId: ri.id, category: "scam", proposedAction: "hide_comment", queueState: "approval_required" } });
    const inc = await systemDb.incident.create({ data: { tenantId: t.id, brandId: brand.id, title: `${tag} inc`, category: "scam", severity: "high", status: "open", relatedItemIds: [ri.id] } });
    const pol = await systemDb.controlPolicy.create({ data: { tenantId: t.id, brandId: brand.id, platform: "any", sourceType: "comment", category: "scam", mode: "monitor", minConfidence: 0.8, isActive: true } });
    await systemDb.brandAutoProtectPolicy.create({ data: { tenantId: t.id, brandId: brand.id, category: "scam", mode: "monitor", minConfidence: 0.7, isActive: true } });
    await systemDb.brandRule.create({ data: { tenantId: t.id, brandId: brand.id, name: `${tag} rule`, category: "blocked_words", phrases: ["x"], enabled: true } });
    await systemDb.auditLog.create({ data: { tenantId: t.id, brandId: brand.id, event: `test.${tag}`, actorKind: "system" } });
    return { brand, acc, ci, ri, dec, aqi, inc, pol };
  };
  const A = await mk(tA, "A");
  const B = await mk(tB, "B");

  try {
    // ---- Permission predicate (the real gate requireSession/assertCan use) ----
    check("perm) viewer cannot approve, owner can (real predicate)",
      can(Role.Viewer, Permission.ProposalApprove) === false && can(Role.Owner, Permission.ProposalApprove) === true);

    // ---- Accounts (T1-4) ----
    const accountsA = await withTenant(tA.id, (db) => db.connectedAccount.findMany());
    check("1) accounts list sees only A", accountsA.every((a) => a.tenantId === tA.id) && accountsA.some((a) => a.id === A.acc.id) && !accountsA.some((a) => a.id === B.acc.id));
    check("2) foreign account detail → null", (await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: B.acc.id } }))) === null);
    check("4) accounts query with NO tenant filter still only A", accountsA.length === 1);

    // ---- Inbox / Reputation (T5-11) ----
    const repA = await withTenant(tA.id, (db) => db.reputationItem.findMany());
    check("5/9) reputation/inbox list only A", repA.every((r) => r.tenantId === tA.id) && !repA.some((r) => r.id === B.ri.id));
    check("10) foreign reputation detail → null", (await withTenant(tA.id, (db) => db.reputationItem.findFirst({ where: { id: B.ri.id } }))) === null);
    const foreignContent = await withTenant(tA.id, (db) => db.contentItem.findFirst({ where: { id: B.ci.id } }));
    check("6/11) foreign content (cross-tenant join guard) → null", foreignContent === null);

    // ---- Action Queue / Approvals (T12-15) ----
    check("12) queue list only A", (await withTenant(tA.id, (db) => db.actionQueueItem.findMany())).every((q) => q.tenantId === tA.id));
    check("13/15) foreign queue item → null", (await withTenant(tA.id, (db) => db.actionQueueItem.findFirst({ where: { id: B.aqi.id } }))) === null);
    check("14) foreign proposal (moderationDecision) → null", (await withTenant(tA.id, (db) => db.moderationDecision.findFirst({ where: { id: B.dec.id } }))) === null);
    check("13b) approving B's decision under A writes nothing (updateMany count 0)",
      (await withTenant(tA.id, (db) => db.moderationDecision.updateMany({ where: { id: B.dec.id }, data: { status: "approved" } }))).count === 0);

    // ---- Brands / Team / Settings (T16-20) ----
    check("16) brand list only A", (await withTenant(tA.id, (db) => db.brand.findMany())).every((b) => b.tenantId === tA.id));
    check("17) foreign brand detail → null", (await withTenant(tA.id, (db) => db.brand.findFirst({ where: { id: B.brand.id } }))) === null);
    const membersA = await withTenant(tA.id, (db) => db.membership.findMany());
    check("18) team sees only A memberships", membersA.every((m) => m.tenantId === tA.id) && membersA.length === 2);
    check("19) foreign membership role update writes nothing",
      (await withTenant(tA.id, (db) => db.membership.updateMany({ where: { tenantId: tB.id }, data: { role: "viewer" } }))).count === 0);
    check("20a) settings (auto-protect policy) only A", (await withTenant(tA.id, (db) => db.brandAutoProtectPolicy.findMany())).every((p) => p.tenantId === tA.id));
    check("20b) foreign settings write rejected (RLS WITH CHECK)",
      await rejects(() => withTenant(tA.id, (db) => db.brandLiveSafetySettings.create({ data: { tenantId: tB.id, brandId: B.brand.id, liveModeEnabled: true, autonomousHideEnabled: true } }))));

    // ---- Audit / Control Center (T21-23) ----
    check("21) audit sees only A", (await withTenant(tA.id, (db) => db.auditLog.findMany())).every((a) => a.tenantId === tA.id));
    check("22) control policies only A", (await withTenant(tA.id, (db) => db.controlPolicy.findMany())).every((p) => p.tenantId === tA.id));
    check("23) foreign incident/policy → null",
      (await withTenant(tA.id, (db) => db.incident.findFirst({ where: { id: B.inc.id } }))) === null
      && (await withTenant(tA.id, (db) => db.controlPolicy.findFirst({ where: { id: B.pol.id } }))) === null);

    // ---- Runtime proof (T27-30) ----
    check("27) production query without where:{tenantId} still only A", repA.length === 1 && accountsA.length === 1);
    check("R) foreign tenant WRITE rejected by RLS (create B row under A ctx)",
      await rejects(() => withTenant(tA.id, (db) => db.brandRule.create({ data: { tenantId: tB.id, brandId: B.brand.id, name: "x", category: "blocked_words", phrases: ["x"], enabled: true } }))));
    const [pa, pb] = await Promise.all([
      withTenant(tA.id, (db) => db.brand.findMany()),
      withTenant(tB.id, (db) => db.brand.findMany()),
    ]);
    check("30) parallel A/B contexts do not leak", pa.every((b) => b.tenantId === tA.id) && pb.every((b) => b.tenantId === tB.id));
  } finally {
    for (const t of [tA.id, tB.id]) {
      await systemDb.auditLog.deleteMany({ where: { tenantId: t } });
      await systemDb.brandRule.deleteMany({ where: { tenantId: t } });
      await systemDb.brandAutoProtectPolicy.deleteMany({ where: { tenantId: t } });
      await systemDb.controlPolicy.deleteMany({ where: { tenantId: t } });
      await systemDb.incident.deleteMany({ where: { tenantId: t } });
      await systemDb.actionQueueItem.deleteMany({ where: { tenantId: t } });
      await systemDb.moderationDecision.deleteMany({ where: { tenantId: t } });
      await systemDb.reputationItem.deleteMany({ where: { tenantId: t } });
      await systemDb.contentItem.deleteMany({ where: { tenantId: t } });
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: t } });
      await systemDb.brand.deleteMany({ where: { tenantId: t } });
    }
    await systemDb.membership.deleteMany({ where: { userId: { in: [uOwner.id, uViewer.id] } } });
    await systemDb.user.deleteMany({ where: { id: { in: [uOwner.id, uViewer.id] } } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [tA.id, tB.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — web tenant isolation (V1.37.3C)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
