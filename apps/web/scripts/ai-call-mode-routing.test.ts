/**
 * V1.61 — AI_RISK_CALL_MODE=`all` through the METERED service (cache → rules → paid), real Postgres,
 * deterministic `mock` provider (no network). Proves that `all` still obeys EVERY guard that precedes the
 * pipeline value-gate, so "call on every comment" can never bypass the budget/resilience fuses:
 *   - all + benign comment  → provider IS consulted (value_gated would have skipped it) → processed_paid;
 *   - all + identical content → cache hit, NO second paid call (no double-charge on duplicate work);
 *   - all + global daily CALL limit exhausted → rules-only;
 *   - all + global daily COST limit exhausted → rules-only;
 *   - all + circuit open → rules-only;
 *   - all + provider failure → comment still classified by rules (fail-open).
 * Creates + deletes its own tenant. Run: pnpm ai-call-mode-routing:test
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

const BENIGN = "Thanks team, this was a genuinely lovely and helpful update — much appreciated!";
const cfgAll = (): HybridConfig => ({
  workspaceLocale: "en",
  translation: { enabled: false, provider: "none", targetMode: "workspace_locale" },
  // benign text + minConfidence 0 → value_gated would NOT call; callMode `all` forces the attempt.
  aiRisk: { enabled: true, provider: "mock", minConfidence: 0, callMode: "all" },
  memoryRules: [],
});
const input = (text: string): ClassificationInput => ({ text, platform: "facebook_page" as ClassificationInput["platform"], locale: "en", rules: [] });
const period = (tenantId: string) => withTenant(tenantId, (db) => db.usagePeriod.findFirst({ where: { tenantId } }));

// Snapshot + restore only the env knobs this test mutates.
const KEYS = ["AI_PAID_ENABLED", "AI_PAID_GLOBAL_DAILY_CALL_LIMIT", "AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS", "AI_PAID_CIRCUIT_FAILURE_THRESHOLD", "AI_PAID_CIRCUIT_COOLDOWN_MS"];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
const restore = () => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: `CallMode ${sfx}`, slug: `callmode-${sfx}`, plan: "free" } });
  const ctx = { tenantId: t.id, plan: "free" };

  try {
    // 1) all + benign → provider consulted (value_gated would skip a confident benign comment).
    process.env.AI_PAID_ENABLED = "true";
    delete process.env.AI_PAID_GLOBAL_DAILY_CALL_LIMIT;
    delete process.env.AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS;
    paidAiGuard.reset();
    const on = await classifyWithUsagePolicy(ctx, input(BENIGN), cfgAll());
    check("1) all + benign → processed_paid (provider consulted for every comment)", on.processingStatus === "processed_paid" && on.processingTier === "paid" && (await period(t.id))!.premiumCallsUsed === 1, `${on.processingStatus}/${on.processingTier}`);

    // 2) all + identical content → cache hit, NO additional paid call.
    const again = await classifyWithUsagePolicy(ctx, input(BENIGN), cfgAll());
    check("2) all + identical content → cache hit, no double-charge", again.processingStatus === "cached" && (await period(t.id))!.premiumCallsUsed === 1, again.processingStatus);

    // 3) all + global daily CALL limit EXHAUSTED → rules-only. Case 1 already spent ≥1 mock call today,
    // so a positive limit of 1 denies the reservation (a limit of 0 is misconfiguration, not exhaustion).
    process.env.AI_PAID_GLOBAL_DAILY_CALL_LIMIT = "1";
    paidAiGuard.reset();
    const callCap = await classifyWithUsagePolicy(ctx, input(`${BENIGN} unique-callcap ${sfx}`), cfgAll());
    check("3) all + global call limit exhausted → rules-only", callCap.processingTier === "rules" && callCap.processingStatus !== "processed_paid" && (callCap.processingReason ?? "").includes("call_limit"), `${callCap.processingTier}/${callCap.processingReason}`);
    delete process.env.AI_PAID_GLOBAL_DAILY_CALL_LIMIT;

    // 4) all + global daily COST limit EXHAUSTED → rules-only. The `mock` provider is free (estimate = 0),
    // so a cost cap can only bite a PRICED model. Use provider `openai`/gpt-4o-mini for a positive estimate,
    // and a stub callProvider so the REAL OpenAI adapter is never constructed or called (no network). A
    // positive 1-micro cap is exceeded by any reservation, so the reserve is denied on cost before the stub.
    process.env.AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS = "1";
    paidAiGuard.reset();
    const neverCalled = async (i: ClassificationInput, c: HybridConfig): Promise<HybridResult> =>
      classifyHybrid(i, { ...c, aiRisk: { enabled: false, provider: "none", minConfidence: c.aiRisk.minConfidence } });
    const cfgOpenAi: HybridConfig = { ...cfgAll(), aiRisk: { enabled: true, provider: "openai", minConfidence: 0, callMode: "all", openai: { apiKey: "unused-cost-cap-denies-first", model: "gpt-4o-mini", timeoutMs: 1000, maxRetries: 0 } } };
    const costCap = await classifyWithUsagePolicy(ctx, input(`${BENIGN} unique-costcap ${sfx}`), cfgOpenAi, { callProvider: neverCalled });
    check("4) all + global cost limit exhausted → rules-only", costCap.processingTier === "rules" && costCap.processingStatus !== "processed_paid" && (costCap.processingReason ?? "").includes("cost_limit"), `${costCap.processingTier}/${costCap.processingReason}`);
    delete process.env.AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS;

    // 5) all + circuit open → rules-only.
    process.env.AI_PAID_CIRCUIT_FAILURE_THRESHOLD = "1";
    process.env.AI_PAID_CIRCUIT_COOLDOWN_MS = "600000";
    paidAiGuard.reset();
    paidAiGuard.recordFailure(new Date()); // threshold=1 → circuit opens immediately
    const circuit = await classifyWithUsagePolicy(ctx, input(`${BENIGN} unique-circuit ${sfx}`), cfgAll());
    check("5) all + circuit open → rules-only", circuit.processingTier === "rules" && circuit.processingReason === "provider_circuit_open", `${circuit.processingTier}/${circuit.processingReason}`);
    delete process.env.AI_PAID_CIRCUIT_FAILURE_THRESHOLD;
    delete process.env.AI_PAID_CIRCUIT_COOLDOWN_MS;
    paidAiGuard.reset();

    // 6) all + provider FAILURE → comment still classified by rules (fail-open).
    const failingProvider = async (i: ClassificationInput, c: HybridConfig): Promise<HybridResult> => {
      const r = await classifyHybrid(i, { ...c, aiRisk: { enabled: false, provider: "none", minConfidence: c.aiRisk.minConfidence } });
      return { ...r, providerCalls: [...r.providerCalls, { type: "ai_risk", provider: "openai", status: "failed", latencyMs: 1, errorCode: "provider_server_error" }] };
    };
    const failed = await classifyWithUsagePolicy(ctx, input(`${BENIGN} unique-fail ${sfx}`), cfgAll(), { callProvider: failingProvider });
    check("6) all + provider failure → failed status, rules result stands (comment classified)", failed.processingStatus === "failed" && failed.processingTier === "rules" && typeof failed.level === "string" && failed.level.length > 0, `${failed.processingStatus}/${failed.level}`);
  } finally {
    restore();
    paidAiGuard.reset();
    await systemDb.usageEvent.deleteMany({ where: { tenantId: t.id } });
    await systemDb.usagePeriod.deleteMany({ where: { tenantId: t.id } });
    await systemDb.aiResultCache.deleteMany({ where: { tenantId: t.id } });
    await systemDb.auditLog.deleteMany({ where: { tenantId: t.id } });
    await systemDb.tenant.deleteMany({ where: { id: t.id } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — AI call mode 'all' obeys all metered guards (V1.61)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
