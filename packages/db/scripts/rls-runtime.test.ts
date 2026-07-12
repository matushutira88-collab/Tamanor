/**
 * V1.37.3 RLS RUNTIME activation tests. These call the REAL production tenant
 * repository functions (listConnectedAccounts / disconnectConnectedAccount /
 * getActionQueueItem / listReputationItems / listTenantAudit / withTenant /
 * findSyncCandidates) — which run on the RLS runtime client `appDb` (tamanor_app)
 * through `withTenantDb`. Seed is via the owner `systemDb`. This proves the real
 * application path (not a bespoke test client) is isolated by Postgres RLS.
 *
 * Run via: pnpm rls-runtime:test
 */
import {
  systemDb, checkRlsRuntime, validateRuntimeDbConfig,
  listConnectedAccounts, getConnectedAccount, disconnectConnectedAccount,
  getActionQueueItem, listReputationItems, listTenantAudit, withTenant, findSyncCandidates,
} from "@guardora/db";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}

async function run() {
  // ---- Runtime role + config (Q1-5) ----
  const report = await checkRlsRuntime();
  check("1-3) runtime is tamanor_app, not superuser/bypassrls, RLS healthy", report.status === "healthy" && report.role === "tamanor_app" && report.superuser === false && report.bypassrls === false);
  check("4) runtime URL is not the owner URL", process.env.APP_DATABASE_URL !== undefined && process.env.APP_DATABASE_URL !== process.env.DATABASE_URL);
  check("5) production config fail-closed", validateRuntimeDbConfig({ NODE_ENV: "production" } as never).ok === false
    && validateRuntimeDbConfig({ NODE_ENV: "production", APP_DATABASE_URL: "x", DATABASE_URL: "x" } as never).ok === false
    && validateRuntimeDbConfig({ NODE_ENV: "production", APP_DATABASE_URL: "a", DATABASE_URL: "b" } as never).ok === true
    && validateRuntimeDbConfig({ NODE_ENV: "development" } as never).ok === true);

  // ---- Seed two tenants as OWNER ----
  const sfx = Date.now().toString(36);
  const tA = await systemDb.tenant.create({ data: { name: "RT A", slug: `rt-a-${sfx}` } });
  const tB = await systemDb.tenant.create({ data: { name: "RT B", slug: `rt-b-${sfx}` } });
  const uV = await systemDb.user.create({ data: { email: `rt-${sfx}@t.test`, name: "V" } });
  await systemDb.membership.create({ data: { userId: uV.id, tenantId: tA.id, role: "viewer" } });
  const brA = await systemDb.brand.create({ data: { tenantId: tA.id, name: "BA" } });
  const brB = await systemDb.brand.create({ data: { tenantId: tB.id, name: "BB" } });
  const acA = await systemDb.connectedAccount.create({ data: { tenantId: tA.id, brandId: brA.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `A_${sfx}`, pageId: `A_${sfx}` } });
  const acB = await systemDb.connectedAccount.create({ data: { tenantId: tB.id, brandId: brB.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `B_${sfx}`, pageId: `B_${sfx}` } });
  const ciA = await systemDb.contentItem.create({ data: { tenantId: tA.id, brandId: brA.id, connectedAccountId: acA.id, platform: "facebook_page", kind: "comment", externalId: `ca_${sfx}`, text: "A", publishedAt: new Date() } });
  const ciB = await systemDb.contentItem.create({ data: { tenantId: tB.id, brandId: brB.id, connectedAccountId: acB.id, platform: "facebook_page", kind: "comment", externalId: `cb_${sfx}`, text: "B", publishedAt: new Date() } });
  const riA = await systemDb.reputationItem.create({ data: { tenantId: tA.id, brandId: brA.id, platform: "facebook_page", contentItemId: ciA.id, riskLevel: "none", riskCategories: [], sentiment: "neutral" } });
  const riB = await systemDb.reputationItem.create({ data: { tenantId: tB.id, brandId: brB.id, platform: "facebook_page", contentItemId: ciB.id, riskLevel: "high", riskCategories: ["scam"], sentiment: "neutral" } });
  const aqA = await systemDb.actionQueueItem.create({ data: { tenantId: tA.id, brandId: brA.id, itemId: riA.id, category: "scam", proposedAction: "hide_comment", queueState: "approval_required" } });
  const aqB = await systemDb.actionQueueItem.create({ data: { tenantId: tB.id, brandId: brB.id, itemId: riB.id, category: "scam", proposedAction: "hide_comment", queueState: "approval_required" } });
  await systemDb.auditLog.create({ data: { tenantId: tA.id, actorKind: "system", event: "test.a" } });
  await systemDb.auditLog.create({ data: { tenantId: tB.id, actorKind: "system", event: "test.b" } });

  try {
    // ---- Web/service tenant reads (Q6-12) via REAL repositories on appDb ----
    const accountsA = await listConnectedAccounts(tA.id);
    check("6/R) Accounts service (no explicit tenant filter) → only A", accountsA.every((a) => a.tenantId === tA.id) && accountsA.some((a) => a.id === acA.id) && !accountsA.some((a) => a.id === acB.id));
    check("8) Reputation service → only A", (await listReputationItems(tA.id)).every((r) => r.tenantId === tA.id));
    check("9) foreign ActionQueue id → null (not_found)", (await getActionQueueItem(tA.id, aqB.id)) === null && (await getActionQueueItem(tA.id, aqA.id)) !== null);
    check("10) foreign account lookup → null", (await getConnectedAccount(tA.id, acB.id)) === null && (await getConnectedAccount(tA.id, acA.id)) !== null);
    check("11) tenant audit → only A", (await listTenantAudit(tA.id)).every((a) => a.tenantId === tA.id));

    // ---- Mutations (Q13, Q16-17) ----
    check("13) disconnect foreign account → null (denied)", (await disconnectConnectedAccount(tA.id, acB.id)) === null);
    check("16) insert with foreign tenantId rejected by RLS", await rejects(() => withTenant(tA.id, (db) => db.contentItem.create({ data: { tenantId: tB.id, brandId: brB.id, connectedAccountId: acB.id, platform: "facebook_page", kind: "comment", externalId: `f_${sfx}`, text: "f", publishedAt: new Date() } }))));
    check("17) moving a row to a foreign tenant rejected", await rejects(() => withTenant(tA.id, (db) => db.contentItem.update({ where: { id: ciA.id }, data: { tenantId: tB.id } }))));
    // legitimate disconnect of own account succeeds
    const disc = await disconnectConnectedAccount(tA.id, acA.id);
    check("13b) disconnect own account succeeds", disc?.id === acA.id);

    // ---- Worker (Q18-24) ----
    const candidates = await findSyncCandidates();
    check("18) discovery returns jobs with trusted tenantId", candidates.some((c) => c.id === acB.id && c.tenantId === tB.id));
    const wrote = await withTenant(tA.id, (db) => db.contentItem.create({ data: { tenantId: tA.id, brandId: brA.id, connectedAccountId: acA.id, platform: "facebook_page", kind: "comment", externalId: `w_${sfx}`, text: "w", publishedAt: new Date() } }));
    check("19) tenant A worker write creates an A record", wrote.tenantId === tA.id);
    check("20) A job cannot write into B", await rejects(() => withTenant(tA.id, (db) => db.reputationItem.create({ data: { tenantId: tB.id, brandId: brB.id, platform: "facebook_page", contentItemId: ciB.id, riskLevel: "none", riskCategories: [], sentiment: "neutral" } }))));
    const [pa, pb] = await Promise.all([
      withTenant(tA.id, (db) => db.contentItem.findMany()),
      withTenant(tB.id, (db) => db.contentItem.findMany()),
    ]);
    check("21) parallel A/B worker jobs isolated", pa.every((r) => r.tenantId === tA.id) && pb.every((r) => r.tenantId === tB.id));
    check("22/23) missing/empty tenantId rejected", await rejects(() => withTenant("", (db) => db.contentItem.findMany())));

    // ---- The wrong-query proof through the REAL service (R) ----
    check("R) real Accounts service has NO where:{tenantId} yet is isolated", accountsA.length === 1);
  } finally {
    await systemDb.auditLog.deleteMany({ where: { tenantId: { in: [tA.id, tB.id] } } });
    await systemDb.actionQueueItem.deleteMany({ where: { brandId: { in: [brA.id, brB.id] } } });
    await systemDb.reputationItem.deleteMany({ where: { brandId: { in: [brA.id, brB.id] } } });
    await systemDb.contentItem.deleteMany({ where: { brandId: { in: [brA.id, brB.id] } } });
    await systemDb.connectedAccount.deleteMany({ where: { brandId: { in: [brA.id, brB.id] } } });
    await systemDb.brand.deleteMany({ where: { id: { in: [brA.id, brB.id] } } });
    await systemDb.membership.deleteMany({ where: { userId: uV.id } });
    await systemDb.user.deleteMany({ where: { id: uV.id } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [tA.id, tB.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — RLS runtime activation (V1.37.3)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
