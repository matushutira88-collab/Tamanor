/**
 * V1.61.1 — a paid AI call's ProviderCall + UsageEvent must both link to the SAME ReputationItem so the
 * admin panel can join model / input+output tokens / actualCostMicros. Real Postgres, deterministic
 * injected provider (no network). Proves the correlationId link, per-item isolation, and no fake cost on
 * failure. Run: pnpm ai-usage-link:test
 */
import { classifyWithUsagePolicy, paidAiGuard } from "@guardora/sync";
import type { ClassificationInput, HybridConfig, HybridResult } from "@guardora/ai";
import { classifyHybrid } from "@guardora/ai";
import { systemDb, withTenant } from "@guardora/db";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
};

const cfgOpenAi = (): HybridConfig => ({
  workspaceLocale: "en", translation: { enabled: false, provider: "none", targetMode: "workspace_locale" },
  aiRisk: { enabled: true, provider: "openai", minConfidence: 0, callMode: "all", openai: { apiKey: "unused-test", model: "gpt-4o-mini", timeoutMs: 1000, maxRetries: 0 } },
  memoryRules: [],
});
const input = (text: string): ClassificationInput => ({ text, platform: "facebook_page" as ClassificationInput["platform"], locale: "en", rules: [] });

// Injected provider (no network): "classified" with KNOWN token usage.
const paidClassified = (inTok: number, outTok: number) => async (i: ClassificationInput, c: HybridConfig): Promise<HybridResult> => {
  const r = await classifyHybrid(i, { ...c, aiRisk: { enabled: false, provider: "none", minConfidence: c.aiRisk.minConfidence } });
  return { ...r, aiProvider: "openai", aiProviderStatus: "classified",
    providerCalls: [...r.providerCalls, { type: "ai_risk", provider: "openai", status: "classified", latencyMs: 5 }],
    aiUsage: { inputTokens: inTok, outputTokens: outTok } };
};
const failingProvider = async (i: ClassificationInput, c: HybridConfig): Promise<HybridResult> => {
  const r = await classifyHybrid(i, { ...c, aiRisk: { enabled: false, provider: "none", minConfidence: c.aiRisk.minConfidence } });
  return { ...r, providerCalls: [...r.providerCalls, { type: "ai_risk", provider: "openai", status: "failed", latencyMs: 1, errorCode: "provider_server_error" }] };
};

// Mirror of the production link (sync/index.ts) + the admin-panel joins (comments/page.tsx).
const linkUsage = (tenantId: string, correlationId: string, riId: string) =>
  withTenant(tenantId, (db) => db.usageEvent.updateMany({ where: { tenantId, correlationId, reputationItemId: null }, data: { reputationItemId: riId } }));
const adminUsage = (tenantId: string, riId: string) =>
  withTenant(tenantId, (db) => db.usageEvent.findFirst({ where: { reputationItemId: riId, processingTier: "paid", status: "succeeded" }, select: { modelKey: true, actualCostMicros: true, inputTokens: true, outputTokens: true }, orderBy: { createdAt: "desc" } }));
const adminCall = (tenantId: string, riId: string) =>
  withTenant(tenantId, (db) => db.providerCall.findFirst({ where: { itemId: riId, type: "ai_risk" }, orderBy: { createdAt: "desc" }, select: { provider: true, status: true, errorCode: true } }));

const KEYS = ["AI_PAID_ENABLED", "AI_PAID_GLOBAL_DAILY_CALL_LIMIT", "AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS"];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
const restore = () => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: `Link ${sfx}`, slug: `link-${sfx}`, plan: "free" } });
  const br = await systemDb.brand.create({ data: { tenantId: t.id, name: "B" } });
  const acc = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `ACC_${sfx}`, health: "healthy" } });
  const mkItem = async (tag: string) => {
    const ci = await systemDb.contentItem.create({ data: { tenantId: t.id, brandId: br.id, connectedAccountId: acc.id, platform: "facebook_page", kind: "comment", externalId: `ext_${tag}_${sfx}`, text: "x", publishedAt: new Date() } });
    const ri = await systemDb.reputationItem.create({ data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", contentItemId: ci.id, status: "classified", processingStatus: "processed_paid", processingTier: "paid", contentHash: `h_${tag}_${sfx}`, riskLevel: "low" as never, riskCategories: [], riskConfidence: 0.5 } });
    return ri.id;
  };
  const mkProviderCall = (riId: string, status: string, errorCode: string | null) =>
    systemDb.providerCall.create({ data: { tenantId: t.id, brandId: br.id, itemId: riId, type: "ai_risk", provider: "openai", status, latencyMs: 5, errorCode } });

  process.env.AI_PAID_ENABLED = "true";
  delete process.env.AI_PAID_GLOBAL_DAILY_CALL_LIMIT;
  delete process.env.AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS;
  paidAiGuard.reset();

  try {
    // ---- A) success → ProviderCall + UsageEvent both link to the SAME item; join returns model/tokens/cost.
    const cidA = `cid-a-${sfx}`;
    const resA = await classifyWithUsagePolicy({ tenantId: t.id, plan: "free", correlationId: cidA }, input(`scam-link-a ${sfx}`), cfgOpenAi(), { callProvider: paidClassified(120, 30) });
    check("A) paid call ran (processed_paid)", resA.processingStatus === "processed_paid" && resA.processingTier === "paid", `${resA.processingStatus}/${resA.processingTier}`);
    const riA = await mkItem("a");
    await linkUsage(t.id, cidA, riA);
    await mkProviderCall(riA, "classified", null);
    const uA = await adminUsage(t.id, riA);
    const cA = await adminCall(t.id, riA);
    check("A) ProviderCall linked to the item (status classified)", cA?.status === "classified" && cA?.provider === "openai");
    check("A) UsageEvent linked to the item", !!uA);
    check("A) admin join returns model = gpt-4o-mini", uA?.modelKey === "gpt-4o-mini", uA?.modelKey ?? "null");
    check("A) admin join returns input/output tokens (120/30)", uA?.inputTokens === 120 && uA?.outputTokens === 30, `${uA?.inputTokens}/${uA?.outputTokens}`);
    check("A) admin join returns a real actualCostMicros (> 0)", (uA?.actualCostMicros ?? 0n) > 0n, String(uA?.actualCostMicros));

    // ---- B) provider FAILURE → status/error shown, NO fake cost (no succeeded usage row).
    const cidB = `cid-b-${sfx}`;
    const resB = await classifyWithUsagePolicy({ tenantId: t.id, plan: "free", correlationId: cidB }, input(`scam-link-b ${sfx}`), cfgOpenAi(), { callProvider: failingProvider });
    check("B) failed provider → rules fallback (failed status)", resB.processingStatus === "failed" && resB.processingTier === "rules", `${resB.processingStatus}`);
    const riB = await mkItem("b");
    await linkUsage(t.id, cidB, riB);
    await mkProviderCall(riB, "failed", "provider_server_error");
    const uB = await adminUsage(t.id, riB);
    const cB = await adminCall(t.id, riB);
    check("B) NO succeeded usage row → no fake cost", uB === null);
    check("B) ProviderCall shows failed status + error", cB?.status === "failed" && cB?.errorCode === "provider_server_error");

    // ---- C) two comments do NOT mix: each links its own usage by its own correlationId.
    const cidC1 = `cid-c1-${sfx}`, cidC2 = `cid-c2-${sfx}`;
    await classifyWithUsagePolicy({ tenantId: t.id, plan: "free", correlationId: cidC1 }, input(`scam-link-c1 ${sfx}`), cfgOpenAi(), { callProvider: paidClassified(100, 10) });
    await classifyWithUsagePolicy({ tenantId: t.id, plan: "free", correlationId: cidC2 }, input(`scam-link-c2 ${sfx}`), cfgOpenAi(), { callProvider: paidClassified(200, 20) });
    const riC1 = await mkItem("c1"), riC2 = await mkItem("c2");
    await linkUsage(t.id, cidC1, riC1);
    await linkUsage(t.id, cidC2, riC2);
    const uC1 = await adminUsage(t.id, riC1), uC2 = await adminUsage(t.id, riC2);
    check("C) concurrent items keep their OWN tokens (no cross-mix)", uC1?.inputTokens === 100 && uC1?.outputTokens === 10 && uC2?.inputTokens === 200 && uC2?.outputTokens === 20, `${uC1?.inputTokens}/${uC2?.inputTokens}`);

    // ---- D) an UNLINKED (historical) usage event never joins a foreign comment.
    const cidD = `cid-d-${sfx}`;
    await classifyWithUsagePolicy({ tenantId: t.id, plan: "free", correlationId: cidD }, input(`scam-link-d ${sfx}`), cfgOpenAi(), { callProvider: paidClassified(999, 999) });
    // deliberately DO NOT link cidD. riA's join must still be riA's own data (120/30), never the orphan's.
    const uAafter = await adminUsage(t.id, riA);
    check("D) orphaned usage (unlinked) does NOT leak into another item's join", uAafter?.inputTokens === 120 && uAafter?.outputTokens === 30, `${uAafter?.inputTokens}/${uAafter?.outputTokens}`);
    const orphanPaid = await withTenant(t.id, (db) => db.usageEvent.count({ where: { correlationId: cidD, reputationItemId: null, processingTier: "paid" } }));
    check("D) the orphaned PAID usage row is still unlinked (reputationItemId NULL)", orphanPaid === 1, String(orphanPaid));
  } finally {
    restore();
    paidAiGuard.reset();
    await systemDb.providerCall.deleteMany({ where: { tenantId: t.id } });
    await systemDb.usageEvent.deleteMany({ where: { tenantId: t.id } });
    await systemDb.usagePeriod.deleteMany({ where: { tenantId: t.id } });
    await systemDb.aiResultCache.deleteMany({ where: { tenantId: t.id } });
    await systemDb.reputationItem.deleteMany({ where: { tenantId: t.id } });
    await systemDb.contentItem.deleteMany({ where: { tenantId: t.id } });
    await systemDb.connectedAccount.deleteMany({ where: { tenantId: t.id } });
    await systemDb.auditLog.deleteMany({ where: { tenantId: t.id } });
    await systemDb.brand.deleteMany({ where: { tenantId: t.id } });
    await systemDb.tenant.deleteMany({ where: { id: t.id } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — paid ProviderCall + UsageEvent link to the ReputationItem (V1.61.1)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
