/**
 * V1.37.3B — WORKER RLS runtime tests. Exercises the REAL worker functions
 * (runTenantJob, proposeForHighRiskItems, runTokenExpiryMonitor) and the system
 * discovery repositories against a real Postgres. Seed is via the owner systemDb;
 * every tenant execution runs on the RLS runtime client (appDb) through
 * withTenantDb, proving the worker is isolated by Postgres RLS — not by where-clauses.
 *
 * Run: pnpm worker-rls:test
 */
import {
  systemDb, checkRlsRuntime, validateRuntimeDbConfig, withTenant,
  findAccountsForTokenCheck, findItemsForProposal, findMetaSyncCandidates,
} from "@guardora/db";
import { runTenantJob, assertValidJob, newCorrelationId, type TenantWorkerJob } from "../../../apps/worker/src/job";
import { proposeForHighRiskItems } from "../../../apps/worker/src/proposals";
import { runTokenExpiryMonitor } from "../../../apps/worker/src/token-monitor";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
function threw(fn: () => unknown): boolean { try { fn(); return false; } catch { return true; } }

async function run() {
  // ---- Runtime preflight (Q26-30) ----
  const rep = await checkRlsRuntime();
  check("preflight) worker RLS runtime healthy (tamanor_app, no super/bypass)", rep.status === "healthy" && rep.role === "tamanor_app" && !rep.superuser && !rep.bypassrls);
  check("config) production fail-closed; dev ok", validateRuntimeDbConfig({ NODE_ENV: "production" } as never).ok === false
    && validateRuntimeDbConfig({ NODE_ENV: "production", APP_DATABASE_URL: "x", DATABASE_URL: "x" } as never).ok === false
    && validateRuntimeDbConfig({ NODE_ENV: "development" } as never).ok === true);

  // ---- Job validation (Q1-5) ----
  check("1) job without tenantId rejected", threw(() => assertValidJob({ jobType: "propose", brandId: "b", reputationItemId: "r", correlationId: "c" } as never)));
  check("2) job with empty tenantId rejected", threw(() => assertValidJob({ jobType: "propose", tenantId: "", brandId: "b", reputationItemId: "r", correlationId: "c" } as never)));
  check("3) malformed job rejected", threw(() => assertValidJob(null as never)) && threw(() => assertValidJob({} as never)));

  const bad = await runTenantJob({ jobType: "propose", tenantId: "does-not-exist", brandId: "b", reputationItemId: "r", correlationId: newCorrelationId() }, async () => "ran");
  check("3b) non-existent tenant → tenant_not_found (fn never runs)", !bad.ok && bad.reason === "tenant_not_found");
  const missing = await runTenantJob({ jobType: "propose", tenantId: "", brandId: "b", reputationItemId: "r", correlationId: "c" } as never, async () => "ran");
  check("2b) empty tenantId job → tenant_context_missing", !missing.ok && missing.reason === "tenant_context_missing");

  // ---- Seed two tenants ----
  const sfx = Date.now().toString(36);
  const tA = await systemDb.tenant.create({ data: { name: "WK A", slug: `wk-a-${sfx}` } });
  const tB = await systemDb.tenant.create({ data: { name: "WK B", slug: `wk-b-${sfx}` } });
  const brA = await systemDb.brand.create({ data: { tenantId: tA.id, name: "WBA" } });
  const brB = await systemDb.brand.create({ data: { tenantId: tB.id, name: "WBB" } });
  const past = new Date(Date.now() - 60_000);
  const acA = await systemDb.connectedAccount.create({ data: { tenantId: tA.id, brandId: brA.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `WA_${sfx}`, pageId: `WA_${sfx}`, health: "healthy", tokenExpiresAt: past } });
  const acB = await systemDb.connectedAccount.create({ data: { tenantId: tB.id, brandId: brB.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `WB_${sfx}`, pageId: `WB_${sfx}`, health: "healthy", tokenExpiresAt: past } });
  const ciA = await systemDb.contentItem.create({ data: { tenantId: tA.id, brandId: brA.id, connectedAccountId: acA.id, platform: "facebook_page", kind: "comment", externalId: `wca_${sfx}`, text: "scam A", publishedAt: new Date() } });
  const ciB = await systemDb.contentItem.create({ data: { tenantId: tB.id, brandId: brB.id, connectedAccountId: acB.id, platform: "facebook_page", kind: "comment", externalId: `wcb_${sfx}`, text: "scam B", publishedAt: new Date() } });
  const riA = await systemDb.reputationItem.create({ data: { tenantId: tA.id, brandId: brA.id, platform: "facebook_page", contentItemId: ciA.id, status: "classified", riskLevel: "high", riskConfidence: 0.95, riskCategories: ["scam"], sentiment: "negative", requiresApproval: false } });
  const riB = await systemDb.reputationItem.create({ data: { tenantId: tB.id, brandId: brB.id, platform: "facebook_page", contentItemId: ciB.id, status: "classified", riskLevel: "high", riskConfidence: 0.95, riskCategories: ["scam"], sentiment: "negative", requiresApproval: false } });

  try {
    // ---- Discovery (Q6-9) ----
    const cands = await findMetaSyncCandidates(["active"]);
    check("6) sync discovery returns account+trusted tenantId (cross-tenant)", cands.some((c) => c.id === acA.id && c.tenantId === tA.id) && cands.some((c) => c.id === acB.id && c.tenantId === tB.id));
    const tokCands = await findAccountsForTokenCheck();
    check("7) token discovery returns ids+tenantId, NO token material", tokCands.some((c) => c.id === acA.id) && !Object.keys(tokCands[0] ?? {}).some((k) => /token|access|secret/i.test(k) && k !== "tokenExpiresAt"));
    const propCands = await findItemsForProposal(1000);
    check("9) proposal discovery includes both items with correct tenantId, only id/tenant/brand", propCands.some((c) => c.id === riA.id && c.tenantId === tA.id) && propCands.some((c) => c.id === riB.id && c.tenantId === tB.id) && Object.keys(propCands.find((c) => c.id === riA.id)!).sort().join(",") === "brandId,id,tenantId");

    // ---- Foreign write denial + wrong-query proof (Q13-15, R) ----
    const foreign = await runTenantJob({ jobType: "propose", tenantId: tA.id, brandId: brA.id, reputationItemId: riB.id, correlationId: newCorrelationId() }, async ({ db }) =>
      db.moderationDecision.create({ data: { tenantId: tB.id, brandId: brB.id, reputationItemId: riB.id, action: "hide", status: "proposed", proposedByKind: "ai", confidence: 0.9, reason: "x" } }));
    check("13) A job writing a B row → tenant_access_denied (RLS)", !foreign.ok && foreign.reason === "tenant_access_denied");

    const wrongQuery = await runTenantJob({ jobType: "propose", tenantId: tA.id, brandId: brA.id, reputationItemId: riA.id, correlationId: newCorrelationId() }, async ({ db }) => {
      // Intentionally NO where:{tenantId} — RLS must still return only A.
      const accts = await db.connectedAccount.findMany();
      const items = await db.reputationItem.findMany();
      const content = await db.contentItem.findMany();
      return { accts, items, content };
    });
    check("15/R) worker query with NO tenant filter still sees only A", wrongQuery.ok === true
      && wrongQuery.value!.accts.every((a) => a.tenantId === tA.id)
      && wrongQuery.value!.items.every((i) => i.tenantId === tA.id)
      && wrongQuery.value!.content.every((c) => c.tenantId === tA.id));

    // ---- Real proposals worker (execution isolation) ----
    await proposeForHighRiskItems(1000);
    const decA = await withTenant(tA.id, (db) => db.moderationDecision.findMany({ where: { reputationItemId: riA.id } }));
    const decAoverB = await withTenant(tA.id, (db) => db.moderationDecision.findMany({ where: { reputationItemId: riB.id } }));
    const decB = await withTenant(tB.id, (db) => db.moderationDecision.findMany({ where: { reputationItemId: riB.id } }));
    check("10-12) proposals: A item proposed under A, B under B, no cross-tenant leak", decA.length === 1 && decA[0].tenantId === tA.id && decB.length === 1 && decB[0].tenantId === tB.id && decAoverB.length === 0);

    // ---- Real token monitor worker (per-tenant writes) ----
    await runTokenExpiryMonitor();
    const accAafter = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: acA.id }, select: { status: true } }));
    const auditA = await withTenant(tA.id, (db) => db.auditLog.findMany({ where: { event: "token.expired", targetId: acA.id } }));
    const auditAoverB = await withTenant(tA.id, (db) => db.auditLog.findMany({ where: { targetId: acB.id } }));
    check("J) token monitor flags A expired + audits under A only", accAafter?.status === "expired" && auditA.length >= 1 && auditA.every((a) => a.tenantId === tA.id) && auditAoverB.length === 0);

    // ---- Parallel isolation + context reset (Q16-21) ----
    const [pa, pb] = await Promise.all([
      runTenantJob({ jobType: "propose", tenantId: tA.id, brandId: brA.id, reputationItemId: riA.id, correlationId: newCorrelationId() }, async ({ db }) => db.reputationItem.findMany()),
      runTenantJob({ jobType: "propose", tenantId: tB.id, brandId: brB.id, reputationItemId: riB.id, correlationId: newCorrelationId() }, async ({ db }) => db.reputationItem.findMany()),
    ]);
    check("18) parallel A/B jobs isolated", pa.ok && pb.ok && pa.value!.every((r) => r.tenantId === tA.id) && pb.value!.every((r) => r.tenantId === tB.id));

    const boom = await runTenantJob({ jobType: "propose", tenantId: tA.id, brandId: brA.id, reputationItemId: riA.id, correlationId: newCorrelationId() }, async () => { throw new Error("boom"); });
    const afterBoom = await runTenantJob({ jobType: "propose", tenantId: tB.id, brandId: brB.id, reputationItemId: riB.id, correlationId: newCorrelationId() }, async ({ db }) => db.reputationItem.findMany());
    check("19) tenant context does not leak after a failing job", !boom.ok && afterBoom.ok! && afterBoom.value!.every((r) => r.tenantId === tB.id));
  } finally {
    await systemDb.auditLog.deleteMany({ where: { tenantId: { in: [tA.id, tB.id] } } });
    await systemDb.moderationDecision.deleteMany({ where: { brandId: { in: [brA.id, brB.id] } } });
    await systemDb.reputationItem.deleteMany({ where: { brandId: { in: [brA.id, brB.id] } } });
    await systemDb.contentItem.deleteMany({ where: { brandId: { in: [brA.id, brB.id] } } });
    await systemDb.connectedAccount.deleteMany({ where: { brandId: { in: [brA.id, brB.id] } } });
    await systemDb.brand.deleteMany({ where: { id: { in: [brA.id, brB.id] } } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [tA.id, tB.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — worker RLS runtime (V1.37.3B)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
