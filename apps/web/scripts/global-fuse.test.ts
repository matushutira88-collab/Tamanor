/**
 * V1.44B — GLOBAL fuse runtime proof. Two layers:
 *  (a) per-instance guard units (kill switch, RPM, max concurrency, circuit open/half-open/close,
 *      timeout) — deterministic, driven with explicit now + cfg;
 *  (b) DB integration through classifyWithUsagePolicy against real Postgres: kill switch = 0 calls,
 *      multi-instance DB daily call/cost caps, tenant+global stricter wins, dual-reservation
 *      compensation (tenant fail → global released), provider timeout releases both, and the
 *      concurrency peak never exceeds the configured max.
 *
 * Run: pnpm global-fuse:test
 */
import { classifyWithUsagePolicy, paidAiGuard, withTimeout } from "@guardora/sync";
import { classifyHybrid, type ClassificationInput, type HybridConfig, type HybridResult } from "@guardora/ai";
import { systemDb, withTenant, getGlobalDailyUsage } from "@guardora/db";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const RISKY = "This is a scam and fraud, total ripoff, avoid this crook";
const input = (text: string): ClassificationInput => ({ text, platform: "facebook_page" as ClassificationInput["platform"], locale: "en", rules: [] });
const cfg = (provider: string): HybridConfig => ({ workspaceLocale: "en", translation: { enabled: false, provider: "none", targetMode: "workspace_locale" }, aiRisk: { enabled: provider !== "none", provider, minConfidence: 0.7 }, memoryRules: [] });
const T0 = new Date("2026-07-14T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
// Full fuse cfg with overrides for guard-unit tests.
type Cfg = Parameters<typeof paidAiGuard.tryAcquire>[1];
const CFG = (o: Partial<NonNullable<Cfg>> = {}): NonNullable<Cfg> => ({ effectiveEnabled: true, enabled: true, emergencyDisable: false, globalDailyCallLimit: 1000, globalDailyCostLimitMicros: 5_000_000, providerDailyCallLimit: 1000, rpmLimit: 60, maxConcurrency: 4, timeoutMs: 10_000, maxRetries: 1, circuitFailureThreshold: 5, circuitCooldownMs: 60_000, tenantAllowlist: [], ...o });

async function okProvider(i: ClassificationInput, c: HybridConfig): Promise<HybridResult> {
  const base = await classifyHybrid(i, { ...c, aiRisk: { enabled: false, provider: "none", minConfidence: 0.7 } });
  return { ...base, providerCalls: [{ type: "ai_risk", provider: "test", status: "classified", latencyMs: 1 }] };
}

async function guardUnits() {
  console.log("Guard units (per-instance):");
  // 11) kill switch
  paidAiGuard.reset();
  check("11) kill switch → tryAcquire denied (paid_ai_disabled)", paidAiGuard.tryAcquire(T0, CFG({ effectiveEnabled: false })).ok === false);
  // 14) RPM cap
  paidAiGuard.reset();
  const rpm = CFG({ rpmLimit: 2, maxConcurrency: 100 });
  const a1 = paidAiGuard.tryAcquire(T0, rpm); const a2 = paidAiGuard.tryAcquire(T0, rpm); const a3 = paidAiGuard.tryAcquire(T0, rpm);
  check("14) RPM cap: 3rd call in the minute is rejected", a1.ok && a2.ok && !a3.ok && (a3 as { reason: string }).reason === "rpm_limit");
  // 15) max concurrency
  paidAiGuard.reset();
  const cc = CFG({ maxConcurrency: 2, rpmLimit: 100 });
  const c1 = paidAiGuard.tryAcquire(T0, cc); const c2 = paidAiGuard.tryAcquire(T0, cc); const c3 = paidAiGuard.tryAcquire(T0, cc);
  const c3reason = !c3.ok ? c3.reason : "";
  if (c1.ok) c1.release();
  const c4 = paidAiGuard.tryAcquire(T0, cc);
  check("15) max concurrency: 3rd denied while 2 in-flight; a slot frees the 4th", c1.ok && c2.ok && !c3.ok && c3reason === "max_concurrency" && c4.ok);
  // 16/17) circuit open → half-open → close, and half-open failure reopens
  paidAiGuard.reset();
  const cb = CFG({ circuitFailureThreshold: 3, circuitCooldownMs: 1_000 });
  for (let i = 0; i < 3; i++) paidAiGuard.recordFailure(T0, cb);
  const openNow = paidAiGuard.tryAcquire(at(500), cb); // within cooldown
  const probe = paidAiGuard.tryAcquire(at(1_500), cb); // cooldown elapsed → half-open probe allowed
  if (probe.ok) { probe.release(); paidAiGuard.recordSuccess(); }
  const closed = paidAiGuard.tryAcquire(at(1_600), cb);
  check("16/17) circuit opens after threshold, denies within cooldown, half-open probe then closes on success", !openNow.ok && (openNow as { reason: string }).reason === "provider_circuit_open" && probe.ok && closed.ok);
  paidAiGuard.reset();
  for (let i = 0; i < 3; i++) paidAiGuard.recordFailure(T0, cb);
  const probe2 = paidAiGuard.tryAcquire(at(1_500), cb);
  if (probe2.ok) { probe2.release(); paidAiGuard.recordFailure(at(1_500), cb); } // probe fails → reopen
  const reopened = paidAiGuard.tryAcquire(at(1_600), cb);
  check("17b) a failed half-open probe reopens the circuit", probe2.ok && !reopened.ok && (reopened as { reason: string }).reason === "provider_circuit_open");
  // 18) timeout
  let timedOut = false;
  try { await withTimeout(new Promise((r) => setTimeout(r, 500)), 30); } catch (e) { timedOut = (e as Error).message === "paid_provider_timeout"; }
  const fast = await withTimeout(Promise.resolve("ok"), 100);
  check("18) withTimeout rejects a slow call and resolves a fast one", timedOut && fast === "ok");
  paidAiGuard.reset();
}

async function dbIntegration() {
  console.log("DB integration:");
  const sfx = Date.now().toString(36);
  const free = await systemDb.tenant.create({ data: { name: `GF free ${sfx}`, slug: `gf-free-${sfx}`, plan: "free" } });
  const pro = await systemDb.tenant.create({ data: { name: `GF pro ${sfx}`, slug: `gf-pro-${sfx}`, plan: "pro" } });
  const saveEnv = { ...process.env };
  const costProvider = `cost_${sfx}`;

  try {
    // 12) global daily CALL cap (mock est=0 so cost never binds). pro plan → tenant not binding.
    process.env.AI_PAID_ENABLED = "true";
    process.env.AI_PAID_GLOBAL_DAILY_CALL_LIMIT = "3";
    delete process.env.AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS;
    await systemDb.globalAiUsagePeriod.deleteMany({ where: { provider: "mock" } });
    paidAiGuard.reset();
    const callResults: string[] = [];
    for (let i = 0; i < 5; i++) callResults.push((await classifyWithUsagePolicy({ tenantId: pro.id, plan: "pro" }, input(`${RISKY} call ${i}`), cfg("mock"))).processingStatus);
    const paidCount = callResults.filter((s) => s === "processed_paid").length;
    const g = await getGlobalDailyUsage("mock");
    check("12) global daily CALL cap: exactly 3 paid, rest denied before HTTP", paidCount === 3 && g.callsUsed === 3);
    delete process.env.AI_PAID_GLOBAL_DAILY_CALL_LIMIT;

    // 13) global daily COST cap (injected provider, est=SAFE_FALLBACK 200000). pro plan.
    process.env.AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS = "500000";
    await systemDb.globalAiUsagePeriod.deleteMany({ where: { provider: costProvider } });
    paidAiGuard.reset();
    const costStatuses: string[] = [];
    for (let i = 0; i < 3; i++) costStatuses.push((await classifyWithUsagePolicy({ tenantId: pro.id, plan: "pro" }, input(`cost content ${i}`), cfg(costProvider), { callProvider: okProvider })).processingStatus);
    const gc = await getGlobalDailyUsage(costProvider);
    check("13) global daily COST cap: 2 reserved (400000 ≤ 500000), 3rd denied; global cost = 400000", costStatuses.filter((s) => s === "processed_paid").length === 2 && gc.costMicros === 400_000n);
    delete process.env.AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS;

    // 20) tenant + global stricter cap wins (Free tenant=10, global=3 → global stricter).
    process.env.AI_PAID_GLOBAL_DAILY_CALL_LIMIT = "3";
    await systemDb.globalAiUsagePeriod.deleteMany({ where: { provider: "mock" } });
    await withTenant(free.id, (db) => db.usagePeriod.deleteMany({ where: {} }));
    paidAiGuard.reset();
    let freePaid = 0;
    for (let i = 0; i < 6; i++) if ((await classifyWithUsagePolicy({ tenantId: free.id, plan: "free" }, input(`${RISKY} strict ${i}`), cfg("mock"))).processingStatus === "processed_paid") freePaid++;
    check("20) tenant+global: the STRICTER (global 3 < tenant 10) applies", freePaid === 3);
    delete process.env.AI_PAID_GLOBAL_DAILY_CALL_LIMIT;

    // 12b/dual-atomicity) tenant reserve fails AFTER global reserve → global is released (compensated).
    process.env.AI_PAID_GLOBAL_DAILY_CALL_LIMIT = "1000";
    await systemDb.globalAiUsagePeriod.deleteMany({ where: { provider: "mock" } });
    await withTenant(free.id, (db) => db.usagePeriod.updateMany({ where: {}, data: { premiumCallsUsed: 10 } })); // tenant exhausted
    paidAiGuard.reset();
    const dual = await classifyWithUsagePolicy({ tenantId: free.id, plan: "free" }, input(`${RISKY} dual`), cfg("mock"));
    const gDual = await getGlobalDailyUsage("mock");
    check("21) tenant reserve fail after global reserve → global released (net 0), status premium_limit_reached", dual.processingStatus === "premium_limit_reached" && gDual.callsUsed === 0);

    // 19) provider TIMEOUT → both reservations released, normalized reason.
    process.env.AI_PAID_TIMEOUT_MS = "40";
    await systemDb.globalAiUsagePeriod.deleteMany({ where: { provider: costProvider } });
    await withTenant(pro.id, (db) => db.usagePeriod.deleteMany({ where: {} }));
    paidAiGuard.reset();
    const hang = (): Promise<HybridResult> => new Promise((r) => setTimeout(() => r({} as HybridResult), 400));
    const to = await classifyWithUsagePolicy({ tenantId: pro.id, plan: "pro" }, input(`timeout content ${sfx}`), cfg(costProvider), { callProvider: hang });
    const gTo = await getGlobalDailyUsage(costProvider);
    const proPeriod = await withTenant(pro.id, (db) => db.usagePeriod.findFirst({ where: {} }));
    check("19) provider timeout → failed + both reservations released (global 0, tenant 0)", to.processingStatus === "failed" && to.processingReason === "paid_provider_timeout" && gTo.callsUsed === 0 && (proPeriod?.premiumCallsUsed ?? -1) === 0);
    delete process.env.AI_PAID_TIMEOUT_MS;

    // 15b) concurrency PEAK never exceeds configured max under parallel load.
    process.env.AI_PAID_MAX_CONCURRENCY = "2";
    process.env.AI_PAID_RPM_LIMIT = "100";
    await systemDb.globalAiUsagePeriod.deleteMany({ where: { provider: costProvider } });
    await withTenant(pro.id, (db) => db.usagePeriod.deleteMany({ where: {} }));
    paidAiGuard.reset();
    let active = 0, peak = 0;
    const slow = async (): Promise<HybridResult> => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 60)); active--; return okProvider(input("x"), cfg(costProvider)); };
    await Promise.all(Array.from({ length: 6 }, (_, i) => classifyWithUsagePolicy({ tenantId: pro.id, plan: "pro" }, input(`conc ${i} ${sfx}`), cfg(costProvider), { callProvider: slow })));
    check("15b) max concurrency: parallel provider calls never exceed the configured cap", peak <= 2 && peak >= 1, `peak=${peak}`);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saveEnv)) delete process.env[k];
    Object.assign(process.env, saveEnv);
    paidAiGuard.reset();
    await systemDb.globalAiUsagePeriod.deleteMany({ where: { provider: { in: ["mock", costProvider] } } });
    for (const id of [free.id, pro.id]) {
      await systemDb.usageEvent.deleteMany({ where: { tenantId: id } });
      await systemDb.usagePeriod.deleteMany({ where: { tenantId: id } });
      await systemDb.aiResultCache.deleteMany({ where: { tenantId: id } });
      await systemDb.auditLog.deleteMany({ where: { tenantId: id } });
    }
    await systemDb.tenant.deleteMany({ where: { id: { in: [free.id, pro.id] } } });
  }
}

async function run() {
  await guardUnits();
  await dbIntegration();
  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Global fuse runtime (V1.44B)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
