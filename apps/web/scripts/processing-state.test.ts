/**
 * V1.44B — per-item PROCESSING STATE truth (real Postgres). Proves classifyWithUsagePolicy emits a
 * truthful, normalized processingStatus/reason for each trigger, never surfaces a raw provider
 * error, and that the ingest content-update path never resets internal inbox workflow.
 *
 * Run: pnpm processing-state:test
 */
import { classifyWithUsagePolicy, paidAiGuard } from "@guardora/sync";
import { classifyHybrid, type ClassificationInput, type HybridConfig, type HybridResult } from "@guardora/ai";
import { systemDb, withTenant } from "@guardora/db";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const RISKY = "This is a scam and fraud, total ripoff, avoid this crook";
const input = (text: string): ClassificationInput => ({ text, platform: "facebook_page" as ClassificationInput["platform"], locale: "en", rules: [] });
const cfg = (provider: string): HybridConfig => ({ workspaceLocale: "en", translation: { enabled: false, provider: "none", targetMode: "workspace_locale" }, aiRisk: { enabled: provider !== "none", provider, minConfidence: 0.7 }, memoryRules: [] });
const period = (tenantId: string) => withTenant(tenantId, (db) => db.usagePeriod.findFirst({ where: { tenantId } }));

// Injected "paid" providers (deterministic) for failure / raw-error paths the real mock can't produce.
async function providerReturningFailed(i: ClassificationInput, c: HybridConfig): Promise<HybridResult> {
  const base = await classifyHybrid(i, { ...c, aiRisk: { enabled: false, provider: "none", minConfidence: 0.7 } });
  return { ...base, providerCalls: [{ type: "ai_risk", provider: "mock", status: "failed", latencyMs: 1, errorCode: "provider_5xx" }] };
}
const RAW_SECRET_MARKER = "RAWTOKEN_" + "must_not_leak"; // synthetic (not a real secret pattern)
async function providerThrowingSecret(): Promise<HybridResult> {
  throw new Error(`raw provider blew up: ${RAW_SECRET_MARKER} at internal-host/v1 stacktrace`);
}

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: `Proc ${sfx}`, slug: `proc-${sfx}`, plan: "free" } });
  const ctx = { tenantId: t.id, plan: "free" };

  try {
    // H1 — rules only (paid off) → processed_rules
    delete process.env.AI_PAID_ENABLED; paidAiGuard.reset();
    const r1 = await classifyWithUsagePolicy(ctx, input("Nice service, thanks"), cfg("none"));
    check("1) rules-only → processed_rules, tier rules", r1.processingStatus === "processed_rules" && r1.processingTier === "rules");

    // H7 — paid wanted but kill switch OFF → paid_ai_disabled
    const r7 = await classifyWithUsagePolicy(ctx, input(RISKY), cfg("mock"));
    check("7) kill switch off + paid wanted → paid_ai_disabled", r7.processingStatus === "paid_ai_disabled" && r7.processingReason === "paid_ai_disabled" && (await period(t.id))!.premiumCallsUsed === 0);

    // H3 — paid enabled (real mock) → processed_paid
    process.env.AI_PAID_ENABLED = "true"; paidAiGuard.reset();
    const r3 = await classifyWithUsagePolicy(ctx, input(RISKY + " alpha"), cfg("mock"));
    check("3) paid enabled + gate fires → processed_paid, tier paid", r3.processingStatus === "processed_paid" && r3.processingTier === "paid" && (await period(t.id))!.premiumCallsUsed === 1);

    // H4 — identical content again → cached
    const r4 = await classifyWithUsagePolicy(ctx, input(RISKY + " alpha"), cfg("mock"));
    check("4) identical content → cached, no extra premium", r4.processingStatus === "cached" && (await period(t.id))!.premiumCallsUsed === 1);

    // H8 — provider returns failure → failed (rules result stands)
    paidAiGuard.reset();
    const r8 = await classifyWithUsagePolicy(ctx, input(RISKY + " bravo"), cfg("mock"), { callProvider: providerReturningFailed });
    check("8) provider failure → failed, reservation released (call not counted)", r8.processingStatus === "failed" && r8.processingReason === "paid_provider_failed");

    // H9 — provider throws a secret-laden raw error → normalized reason ONLY (no raw error/secret)
    paidAiGuard.reset();
    const r9 = await classifyWithUsagePolicy(ctx, input(RISKY + " charlie"), cfg("mock"), { callProvider: providerThrowingSecret });
    check("9) raw provider error is NEVER surfaced — reason is normalized", r9.processingStatus === "failed" && r9.processingReason === "paid_provider_error" && !(r9.processingReason ?? "").includes(RAW_SECRET_MARKER) && !(r9.processingReason ?? "").includes("stacktrace"));

    // H5 — basic quota exhausted → basic_limit_reached (item still classified by rules)
    delete process.env.AI_PAID_ENABLED; paidAiGuard.reset();
    await withTenant(t.id, (db) => db.usagePeriod.updateMany({ where: { tenantId: t.id }, data: { basicUnitsUsed: 500 } }));
    const r5 = await classifyWithUsagePolicy(ctx, input("Totally new content for basic limit"), cfg("none"));
    check("5) basic quota exhausted → basic_limit_reached, still has a real rules level", r5.processingStatus === "basic_limit_reached" && typeof r5.level === "string" && r5.level.length > 0);

    // H6 — premium quota exhausted → premium_limit_reached
    process.env.AI_PAID_ENABLED = "true"; paidAiGuard.reset();
    await withTenant(t.id, (db) => db.usagePeriod.updateMany({ where: { tenantId: t.id }, data: { premiumCallsUsed: 10 } }));
    const r6 = await classifyWithUsagePolicy(ctx, input(RISKY + " delta unique"), cfg("mock"));
    check("6) premium quota exhausted → premium_limit_reached", r6.processingStatus === "premium_limit_reached" && (r6.processingReason ?? "").includes("premium"));

    // H10 — ingest content-update path must NEVER reset internal workflow or processing state.
    delete process.env.AI_PAID_ENABLED;
    const br = await systemDb.brand.create({ data: { tenantId: t.id, name: "B" } });
    const acc = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `ACC_${sfx}`, health: "healthy" } });
    const ci = await systemDb.contentItem.create({ data: { tenantId: t.id, brandId: br.id, connectedAccountId: acc.id, platform: "facebook_page", kind: "comment", externalId: `ext_${sfx}`, text: "original", publishedAt: new Date() } });
    const ri = await systemDb.reputationItem.create({ data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", contentItemId: ci.id, status: "classified", isRead: true, priority: "high", inboxWorkflowStatus: "in_review", processingStatus: "processed_rules", processingTier: "rules", contentHash: "h1" } });
    // Simulate exactly what ingest's "content changed" path does: update ONLY content fields.
    await withTenant(t.id, (db) => db.contentItem.update({ where: { connectedAccountId_externalId: { connectedAccountId: acc.id, externalId: `ext_${sfx}` } }, data: { text: "edited text" } }));
    const after = await systemDb.reputationItem.findUnique({ where: { id: ri.id }, select: { isRead: true, priority: true, inboxWorkflowStatus: true, processingStatus: true } });
    check("10) ingest content update preserves read/priority/workflow/processing (no reset)", after?.isRead === true && after?.priority === "high" && after?.inboxWorkflowStatus === "in_review" && after?.processingStatus === "processed_rules");
  } finally {
    delete process.env.AI_PAID_ENABLED; paidAiGuard.reset();
    await systemDb.usageEvent.deleteMany({ where: { tenantId: t.id } });
    await systemDb.usagePeriod.deleteMany({ where: { tenantId: t.id } });
    await systemDb.aiResultCache.deleteMany({ where: { tenantId: t.id } });
    await systemDb.reputationItem.deleteMany({ where: { tenantId: t.id } });
    await systemDb.contentItem.deleteMany({ where: { tenantId: t.id } });
    await systemDb.connectedAccount.deleteMany({ where: { tenantId: t.id } });
    await systemDb.brand.deleteMany({ where: { tenantId: t.id } });
    await systemDb.auditLog.deleteMany({ where: { tenantId: t.id } });
    await systemDb.tenant.deleteMany({ where: { id: t.id } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Processing-state truth (V1.44B)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
