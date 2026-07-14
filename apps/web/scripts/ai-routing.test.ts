/**
 * V1.44 — AI routing through the metering service (cache → rules → paid), against real Postgres.
 * Proves: paid fallback is fail-closed on the kill switch; when enabled it reserves BEFORE the
 * provider and meters the call; a second identical content is served from cache (no paid); and the
 * per-tenant premium limit stops paid at the routing layer.
 *
 * Uses the deterministic in-process `mock` provider (dev/test only) as the "paid" provider — no
 * real network. Run: pnpm ai-routing:test
 */
import { classifyWithUsagePolicy, paidAiGuard } from "@guardora/sync";
import type { ClassificationInput } from "@guardora/ai";
import { systemDb, withTenant } from "@guardora/db";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const RISKY = "This is a scam and fraud, total ripoff, avoid this crook";
const cfg = (provider: string) => ({
  workspaceLocale: "en",
  translation: { enabled: false, provider: "none", targetMode: "workspace_locale" as const },
  aiRisk: { enabled: provider !== "none", provider, minConfidence: 0.7 },
  memoryRules: [],
});
const input = (text: string): ClassificationInput => ({ text, platform: "facebook_page" as ClassificationInput["platform"], locale: "en", rules: [] });
const period = (tenantId: string) => withTenant(tenantId, (db) => db.usagePeriod.findFirst({ where: { tenantId } }));

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: `Route ${sfx}`, slug: `route-${sfx}`, plan: "free" } });
  paidAiGuard.reset();

  try {
    // 1) Kill switch OFF (default) → no paid call, no reservation, honest rules result.
    delete process.env.AI_PAID_ENABLED;
    const off = await classifyWithUsagePolicy({ tenantId: t.id, plan: "free" }, input(RISKY), cfg("mock"));
    check("1) paid disabled by default → processingStatus paid_ai_disabled, 0 premium reserved", off.processingStatus === "paid_ai_disabled" && (await period(t.id))!.premiumCallsUsed === 0 && (await period(t.id))!.basicUnitsUsed === 1);

    // 2) Kill switch ON + mock provider → reserve BEFORE provider, meter the paid call.
    process.env.AI_PAID_ENABLED = "true";
    paidAiGuard.reset();
    const on = await classifyWithUsagePolicy({ tenantId: t.id, plan: "free" }, input(RISKY + " one"), cfg("mock"));
    check("2) paid enabled → processed_paid + exactly one premium call metered", on.processingStatus === "processed_paid" && on.processingTier === "paid" && (await period(t.id))!.premiumCallsUsed === 1);

    // 3) Identical content again → cache hit, NO new paid call.
    const again = await classifyWithUsagePolicy({ tenantId: t.id, plan: "free" }, input(RISKY + " one"), cfg("mock"));
    check("3) identical content → cache hit, no additional paid call", again.processingStatus === "cached" && (await period(t.id))!.premiumCallsUsed === 1);

    // 4) Basic dedup at routing: same content does not re-consume a basic unit.
    const basicBefore = (await period(t.id))!.basicUnitsUsed;
    await classifyWithUsagePolicy({ tenantId: t.id, plan: "free" }, input(RISKY + " one"), cfg("mock"));
    check("4) repeated content consumes no extra basic unit", (await period(t.id))!.basicUnitsUsed === basicBefore);

    // 5) Premium limit stops paid at the routing layer (fill to 10, then deny).
    for (let i = 0; i < 12; i++) await classifyWithUsagePolicy({ tenantId: t.id, plan: "free" }, input(`${RISKY} variant ${i}`), cfg("mock"));
    const p = (await period(t.id))!;
    const denied = await classifyWithUsagePolicy({ tenantId: t.id, plan: "free" }, input(`${RISKY} final unique`), cfg("mock"));
    check("5) premium limit halts paid at routing (calls capped at 10, reason surfaced)", p.premiumCallsUsed === 10 && denied.processingStatus === "premium_limit_reached" && (denied.processingReason ?? "").includes("premium"));

    // 6) With paid capped, the item is STILL classified by rules (inbox never blocked).
    check("6) after premium exhaustion the item still has a real rules result", typeof denied.level === "string" && denied.level.length > 0 && denied.processingTier === "rules");
  } finally {
    delete process.env.AI_PAID_ENABLED;
    paidAiGuard.reset();
    await systemDb.usageEvent.deleteMany({ where: { tenantId: t.id } });
    await systemDb.usagePeriod.deleteMany({ where: { tenantId: t.id } });
    await systemDb.aiResultCache.deleteMany({ where: { tenantId: t.id } });
    await systemDb.auditLog.deleteMany({ where: { tenantId: t.id } });
    await systemDb.tenant.deleteMany({ where: { id: t.id } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — AI routing via metering (V1.44)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
