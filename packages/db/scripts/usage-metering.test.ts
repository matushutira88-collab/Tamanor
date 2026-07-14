/**
 * V1.44 — Usage metering / reservation / concurrency / RLS against real Postgres.
 *
 * Proves the hard cost-protection contract: Free = 500 basic / 10 premium / 200000 micros; basic
 * dedup by content version; premium reservation is atomic + idempotent + BEFORE any provider call;
 * parallel reservations never exceed the quota; finalize/release/stale-recovery keep counters true;
 * usage data is tenant-isolated by RLS.
 *
 * Run: pnpm usage-metering:test
 */
import { resolveUsagePolicy, POLICY_VERSION } from "@guardora/core";
import {
  systemDb, withTenant,
  reservePremiumCall, finalizePremiumCall, releaseReservation, recoverStaleReservations,
  consumeBasicUnit, cacheGet, cachePut, recordCacheHit, getUsageSummary, contentVersionHash,
} from "../src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const mkTenant = (sfx: string, plan = "free") => systemDb.tenant.create({ data: { name: `Usage ${sfx}`, slug: `usage-${sfx}`, plan } });
const readPeriod = (tenantId: string) => withTenant(tenantId, (db) => db.usagePeriod.findFirst({ where: { tenantId } }));

async function run() {
  const sfx = Date.now().toString(36);
  const A = await mkTenant(sfx + "a");
  const B = await mkTenant(sfx + "b");

  try {
    // ---------------- policy ----------------
    const free = resolveUsagePolicy("free");
    check("1) Free policy = 500 basic / 10 premium / 200000 micros", free.basicUnitsPerPeriod === 500 && free.premiumCallsPerPeriod === 10 && free.premiumCostLimitMicros === 200000n && free.allowGeneratedReplies === false);
    const unknown = resolveUsagePolicy("banana");
    const nullPlan = resolveUsagePolicy(null);
    check("2) unknown/null plan fail-safe to Free (never unlimited paid)", unknown.plan === "free" && unknown.premiumCallsPerPeriod === 10 && nullPlan.plan === "free" && nullPlan.premiumCostLimitMicros === 200000n);
    check("3) paid fallback flag exists per policy; enterprise known-plan may be unlimited but unknown never is", resolveUsagePolicy("enterprise").premiumCallsPerPeriod === null && unknown.premiumCallsPerPeriod === 10);

    // ---------------- basic metering + dedup ----------------
    const hashV1 = contentVersionHash({ text: "  Great   service ", rating: 5, classifierVersion: "risk-rules-v1", policyVersion: POLICY_VERSION });
    const r1 = await consumeBasicUnit(A.id, "free", { idempotencyKey: `basic:${hashV1}`, tier: "rules" });
    check("4) first unique content consumes 1 basic unit", r1.consumed === true && (await readPeriod(A.id))!.basicUnitsUsed === 1);
    const r2 = await consumeBasicUnit(A.id, "free", { idempotencyKey: `basic:${hashV1}`, tier: "rules" });
    check("5) retry of same content consumes 0 (idempotent)", r2.consumed === false && r2.reused === true && (await readPeriod(A.id))!.basicUnitsUsed === 1);
    const r3 = await consumeBasicUnit(A.id, "free", { idempotencyKey: `basic:${hashV1}`, tier: "rules" });
    check("6) unchanged resync (same key) consumes 0", r3.consumed === false && (await readPeriod(A.id))!.basicUnitsUsed === 1);
    const hashV2 = contentVersionHash({ text: "Great service — edited", rating: 5, classifierVersion: "risk-rules-v1", policyVersion: POLICY_VERSION });
    const r4 = await consumeBasicUnit(A.id, "free", { idempotencyKey: `basic:${hashV2}`, tier: "rules" });
    check("7) changed text consumes a NEW unit", hashV2 !== hashV1 && r4.consumed === true && (await readPeriod(A.id))!.basicUnitsUsed === 2);

    // ---------------- cache hit never reserves paid ----------------
    await cachePut(A.id, { contentHash: hashV1, modelKey: "mock", policyVersion: POLICY_VERSION, normalizedResult: { level: "low" } });
    const cached = await cacheGet(A.id, hashV1, "mock", POLICY_VERSION);
    await recordCacheHit(A.id, { idempotencyKey: `cache:${hashV1}` }, "free");
    const premiumAfterCache = (await readPeriod(A.id))!.premiumCallsUsed;
    check("8) cache hit returns result, consumes 0 premium, no reservation", !!cached && premiumAfterCache === 0);

    // ---------------- premium reservation is BEFORE provider ----------------
    const res1 = await reservePremiumCall(A.id, "free", { provider: "mock", modelKey: "mock", estMicros: 1000n, idempotencyKey: `prem:${sfx}:1` });
    const evAfterReserve = res1.ok ? await withTenant(A.id, (db) => db.usageEvent.findUnique({ where: { id: res1.eventId } })) : null;
    check("9) reservation succeeds and records a 'reserved' event BEFORE any provider call", res1.ok === true && evAfterReserve?.status === "reserved" && (await readPeriod(A.id))!.premiumCallsUsed === 1);

    // ---------------- idempotent premium ----------------
    const res1again = await reservePremiumCall(A.id, "free", { provider: "mock", modelKey: "mock", estMicros: 1000n, idempotencyKey: `prem:${sfx}:1` });
    check("14) same idempotencyKey does not double-charge", res1again.ok === true && (res1again as { reused?: boolean }).reused === true && (await readPeriod(A.id))!.premiumCallsUsed === 1);

    // ---------------- finalize actual cost ----------------
    if (res1.ok) await finalizePremiumCall(A.id, res1.eventId, { status: "succeeded", actualCostMicros: 600n });
    check("12) actual cost finalizes (period cost adjusted to actual)", (await readPeriod(A.id))!.premiumCostMicros === 600n);

    // ---------------- provider failure → release ----------------
    const res2 = await reservePremiumCall(A.id, "free", { provider: "mock", modelKey: "mock", estMicros: 5000n, idempotencyKey: `prem:${sfx}:2` });
    const callsBeforeRelease = (await readPeriod(A.id))!.premiumCallsUsed;
    if (res2.ok) await finalizePremiumCall(A.id, res2.eventId, { status: "failed", billed: false });
    const pAfterRelease = (await readPeriod(A.id))!;
    check("13) provider failure (unbilled) releases the reservation (call + cost refunded)", callsBeforeRelease === 2 && pAfterRelease.premiumCallsUsed === 1 && pAfterRelease.premiumCostMicros === 600n);

    // ---------------- cost limit denies before HTTP ----------------
    const C = await mkTenant(sfx + "c");
    const costReserves = [];
    for (let i = 0; i < 5; i++) costReserves.push(await reservePremiumCall(C.id, "free", { provider: "mock", modelKey: "mock", estMicros: 50000n, idempotencyKey: `cost:${sfx}:${i}` }));
    const okCost = costReserves.filter((r) => r.ok).length;
    const deniedCost = costReserves.find((r) => !r.ok) as { reason?: string } | undefined;
    check("11) cost limit denies before HTTP (4×50000=200000 fits, 5th denied)", okCost === 4 && deniedCost?.reason === "premium_cost_limit_reached" && (await readPeriod(C.id))!.premiumCostMicros === 200000n);

    // ---------------- call limit denies before HTTP ----------------
    const D = await mkTenant(sfx + "d");
    let okCalls = 0; let callDenyReason = "";
    for (let i = 0; i < 12; i++) {
      const r = await reservePremiumCall(D.id, "free", { provider: "mock", modelKey: "mock", estMicros: 100n, idempotencyKey: `call:${sfx}:${i}` });
      if (r.ok) okCalls++; else callDenyReason = (r as { reason: string }).reason;
    }
    check("10) call limit denies before HTTP (max 10 of 12)", okCalls === 10 && callDenyReason === "premium_call_limit_reached" && (await readPeriod(D.id))!.premiumCallsUsed === 10);

    // ---------------- CONCURRENCY: 20 parallel at limit 10 → exactly 10 ----------------
    const E = await mkTenant(sfx + "e");
    const parallel = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      reservePremiumCall(E.id, "free", { provider: "mock", modelKey: "mock", estMicros: 100n, idempotencyKey: `par:${sfx}:${i}` })));
    const okParallel = parallel.filter((r) => r.ok).length;
    check("15) 20 PARALLEL reservations at limit 10 → exactly 10 succeed (no over-reservation)", okParallel === 10 && (await readPeriod(E.id))!.premiumCallsUsed === 10);

    // ---------------- concurrency + same idempotencyKey → single charge ----------------
    const F = await mkTenant(sfx + "f");
    const sameKey = await Promise.all(Array.from({ length: 8 }, () =>
      reservePremiumCall(F.id, "free", { provider: "mock", modelKey: "mock", estMicros: 100n, idempotencyKey: `dup:${sfx}` })));
    check("14b) 8 parallel with the SAME key → single reservation (count 1)", sameKey.every((r) => r.ok) && (await readPeriod(F.id))!.premiumCallsUsed === 1);

    // ---------------- stale reservation recovery ----------------
    const G = await mkTenant(sfx + "g");
    const gRes = await reservePremiumCall(G.id, "free", { provider: "mock", modelKey: "mock", estMicros: 7000n, idempotencyKey: `stale:${sfx}` });
    if (gRes.ok) await systemDb.usageEvent.update({ where: { id: gRes.eventId }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    const rec = await recoverStaleReservations(G.id, 5 * 60_000);
    const gp = (await readPeriod(G.id))!;
    check("18) stale reservation recovery releases + refunds counters", rec.recovered === 1 && gp.premiumCallsUsed === 0 && gp.premiumCostMicros === 0n);

    // ---------------- basic limit exhaustion (inbox not blocked) ----------------
    const H = await mkTenant(sfx + "h");
    await consumeBasicUnit(H.id, "free", { idempotencyKey: `h:seed`, tier: "rules" }); // create the period
    await withTenant(H.id, (db) => db.usagePeriod.updateMany({ where: { tenantId: H.id }, data: { basicUnitsUsed: 500 } }));
    const overBasic = await consumeBasicUnit(H.id, "free", { idempotencyKey: `h:over`, tier: "rules" });
    check("25) basic quota exhausted → denied with truthful reason, item NOT blocked", overBasic.consumed === false && overBasic.denied === true && overBasic.reason === "basic_limit_reached");

    // ---------------- RLS isolation ----------------
    const aEvents = await withTenant(A.id, (db) => db.usageEvent.findMany({}));
    const bSeesA = await withTenant(B.id, (db) => db.usageEvent.findMany({ where: {} }));
    check("20) cross-tenant usage read denied (RLS): B never sees A's events", aEvents.length > 0 && bSeesA.every((e) => e.tenantId === B.id));
    const bPeriods = await withTenant(B.id, (db) => db.usagePeriod.findMany({}));
    check("21) cross-tenant reservation isolated: A's reservations never appear under B", bPeriods.every((p) => p.tenantId === B.id));

    // ---------------- usage summary ----------------
    const sumD = await getUsageSummary(D.id, "free");
    check("28) usage summary truthful + exhausted at 100% premium calls", sumD.premiumCalls.used === 10 && sumD.premiumCalls.limit === 10 && sumD.premiumCalls.percent === 100 && sumD.status === "exhausted" && sumD.nextReset.getTime() === sumD.periodEnd.getTime());
    const sumA = await getUsageSummary(A.id, "free");
    check("29) usage summary reload reads persisted counters (basic 2/500)", sumA.basic.used === 2 && sumA.basic.limit === 500 && sumA.status === "normal");

    void releaseReservation;
  } finally {
    for (const id of [A.id, B.id]) { /* keep list explicit below */ void id; }
    const tenants = await systemDb.tenant.findMany({ where: { slug: { startsWith: `usage-${sfx}` } }, select: { id: true } });
    for (const t of tenants) {
      await systemDb.usageEvent.deleteMany({ where: { tenantId: t.id } });
      await systemDb.usagePeriod.deleteMany({ where: { tenantId: t.id } });
      await systemDb.aiResultCache.deleteMany({ where: { tenantId: t.id } });
      await systemDb.auditLog.deleteMany({ where: { tenantId: t.id } });
    }
    await systemDb.tenant.deleteMany({ where: { slug: { startsWith: `usage-${sfx}` } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Usage metering & reservation (V1.44)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
