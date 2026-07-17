/**
 * V1.59 phase 2 — REAL dashboard + watched-account metrics against a real Postgres on the RLS runtime.
 * Proves the KPI counts, the per-account watched view (FB + IG SEPARATE, real comment/risk counts,
 * deterministic protection score), timeframe filtering, and strict tenant isolation. Run via
 * pnpm dashboard-metrics:test.
 */
import { randomUUID } from "node:crypto";
import { systemDb, getDashboardKpis, getWatchedAccountsView, accountProtectionScore } from "@guardora/db";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const SINCE = new Date(Date.now() - 30 * 86_400_000);
const IN = new Date(Date.now() - 1 * 86_400_000);   // inside the 30-day window
const OUT = new Date(Date.now() - 60 * 86_400_000);  // outside it

async function run() {
  const sfx = Date.now().toString(36);
  const mk = async (tag: string) => {
    const t = await systemDb.tenant.create({ data: { name: `Dm${tag}`, slug: `dm-${tag}-${sfx}` } });
    const b = await systemDb.brand.create({ data: { tenantId: t.id, name: `DmB${tag}` } });
    return { t, b };
  };
  const mkAcc = (T: { t: { id: string }; b: { id: string } }, tag: string, platform: string, health = "healthy", parentId?: string) =>
    systemDb.connectedAccount.create({ data: {
      tenantId: T.t.id, brandId: T.b.id, platform: platform as never, status: "active", mode: "read_only",
      externalId: `DM_${tag}_${sfx}`, health: health as never, tokenHealth: "ok", connectionStatus: "connected",
      lastSuccessfulSyncAt: IN, parentAccountId: parentId ?? null,
    } });
  const A = await mk("a"); const B = await mk("b");

  const comment = async (T: { t: { id: string }; b: { id: string } }, acc: { id: string; platform: unknown }, risk: string, when: Date) => {
    const ci = await systemDb.contentItem.create({ data: {
      tenantId: T.t.id, brandId: T.b.id, connectedAccountId: acc.id, platform: acc.platform as never,
      kind: "comment", externalId: `C_${randomUUID()}`, text: "x", publishedAt: when, ingestedAt: when,
    } });
    await systemDb.reputationItem.create({ data: {
      tenantId: T.t.id, brandId: T.b.id, platform: acc.platform as never, contentItemId: ci.id,
      status: "classified", riskLevel: risk as never, riskCategories: [], createdAt: when,
    } });
    return ci;
  };
  const queueItem = async (T: { t: { id: string }; b: { id: string } }, acc: { id: string; platform: unknown }, state: string) => {
    const ci = await comment(T, acc, "low", OUT); // out of the analyzed window so it does not skew KPIs
    const rep = await systemDb.reputationItem.findUnique({ where: { contentItemId: ci.id }, select: { id: true } });
    await systemDb.actionQueueItem.create({ data: {
      tenantId: T.t.id, brandId: T.b.id, itemId: rep!.id, category: "spam", confidence: 0.9,
      proposedAction: "hide", queueState: state, reason: "test", safetyBlocked: false, wouldExecute: true,
    } });
  };

  try {
    const fb = await mkAcc(A, "fb", "facebook_page", "error"); // health error ⇒ a "problem" account
    const ig = await mkAcc(A, "ig", "instagram_business", "healthy", fb.id);

    // 4 in-window comments (FB: high, high, low; IG: critical) + 1 out-of-window FB comment.
    await comment(A, fb, "high", IN); await comment(A, fb, "high", IN); await comment(A, fb, "low", IN);
    await comment(A, ig, "critical", IN);
    await comment(A, fb, "low", OUT);
    await queueItem(A, fb, "executed");           // → autoHidden
    await queueItem(A, fb, "approval_required");   // → pending
    // Tenant B noise that must NEVER show up in A's numbers.
    const bfb = await mkAcc(B, "bfb", "facebook_page");
    await comment(B, bfb, "critical", IN); await comment(B, bfb, "critical", IN);

    console.log("KPIs");
    const kpi = await getDashboardKpis(A.t.id, SINCE);
    check("analyzedComments = 4 (in-window only)", kpi.analyzedComments === 4, JSON.stringify(kpi));
    check("riskComments = 3 (high/critical in window)", kpi.riskComments === 3, JSON.stringify(kpi));
    check("autoHidden = 1 (executed)", kpi.autoHidden === 1);
    check("pending = 1 (approval_required)", kpi.pending === 1);
    check("accountsWithProblem = 1 (FB health error)", kpi.accountsWithProblem === 1);

    console.log("Tenant isolation");
    const kpiB = await getDashboardKpis(B.t.id, SINCE);
    check("tenant B sees ONLY its own data (2 analyzed, 2 risk)", kpiB.analyzedComments === 2 && kpiB.riskComments === 2);
    check("tenant A's numbers exclude tenant B entirely", kpi.analyzedComments === 4);

    console.log("Watched accounts view (FB + IG separate)");
    const view = await getWatchedAccountsView(A.t.id, SINCE);
    check("returns 2 SEPARATE account cards (FB + IG)", view.length === 2 && view.some((v) => v.platform === "facebook_page") && view.some((v) => v.platform === "instagram_business"));
    const vfb = view.find((v) => v.platform === "facebook_page")!;
    const vig = view.find((v) => v.platform === "instagram_business")!;
    check("FB card: 3 comments, 2 risk in window", vfb.commentsInWindow === 3 && vfb.riskCommentsInWindow === 2, `${vfb.commentsInWindow}/${vfb.riskCommentsInWindow}`);
    check("IG card: 1 comment, 1 risk in window", vig.commentsInWindow === 1 && vig.riskCommentsInWindow === 1);
    check("IG links to its parent FB Page (still a separate account)", vig.parentAccountId === fb.id && vig.id !== vfb.id);
    check("FB card problem = sync_failed (health error)", vfb.problem === "sync_failed");
    check("protection resolves to tenant default", vfb.protection.source === "tenant_default");

    console.log("Deterministic protection score");
    const s1 = accountProtectionScore(vig); const s2 = accountProtectionScore(vig);
    check("score is deterministic + 0..100 + explainable", s1.score === s2.score && s1.score >= 0 && s1.score <= 100 && s1.components.length === 7);
  } finally {
    for (const X of [A, B]) {
      await systemDb.actionQueueItem.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.reputationItem.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.contentItem.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.brand.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.tenant.deleteMany({ where: { id: X.t.id } });
    }
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — dashboard + watched-account metrics (V1.59)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
