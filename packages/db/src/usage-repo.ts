/**
 * V1.44 — Usage metering repository. The ONLY sanctioned way to consume basic units or reserve/
 * finalize a paid AI call. Every function runs through `withTenantDb` (RLS), so isolation is DB
 * enforced. Reservation uses an ATOMIC guarded UPDATE on the period counter (row-lock serialized),
 * so parallel requests can never exceed the limit and a provider is never called before a
 * reservation succeeds. `idempotencyKey` (unique per tenant) makes a retry a no-op — never a double
 * charge. Audit events carry NO raw content / prompt / token / provider response.
 */
import { ActorKind, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { resolveUsagePolicy, resolveEffectiveUsagePolicy, type UsagePolicy, type UsagePlan } from "@guardora/core";
import { withTenantDb, type TenantTx } from "./tenant-db";

function isUnique(e: unknown) { return (e as { code?: string })?.code === "P2002"; }
const corr = () => `usg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const pid = () => `usp_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

// --------------------------- period bounds (UTC calendar month) ---------------------------
export function currentPeriodBounds(now: Date = new Date()): { periodStart: Date; periodEnd: Date } {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  return { periodStart: new Date(Date.UTC(y, m, 1)), periodEnd: new Date(Date.UTC(y, m + 1, 1)) };
}

// --------------------------- content-version hash ---------------------------
/** Stable hash of a unique content VERSION: normalized text + rating + context + classifier/policy. */
export function contentVersionHash(input: { text: string; rating?: number | null; context?: string; classifierVersion: string; policyVersion: string }): string {
  const norm = (input.text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const h = createHash("sha256");
  for (const part of [norm, String(input.rating ?? ""), input.context ?? "", input.classifierVersion, input.policyVersion]) { h.update(part); h.update("\u0000"); }
  return h.digest("hex");
}

// --------------------------- audit (no raw content) ---------------------------
async function usageAudit(db: TenantTx, tenantId: string, event: string, metadata: Record<string, unknown>): Promise<void> {
  await db.auditLog.create({ data: { tenantId, event, actorKind: ActorKind.system, metadata: metadata as Prisma.InputJsonValue } });
}

/**
 * Idempotently ensure the current period exists, in its OWN transaction. Uses `INSERT … ON CONFLICT
 * DO NOTHING` (which never aborts a transaction) so it is safe under heavy concurrency — unlike a
 * create-then-catch, which would poison the surrounding reservation transaction. Reservation/consume
 * then run their atomic guarded UPDATE against this already-committed row.
 */
export function getOrCreateCurrentPeriod(tenantId: string, plan: string, now: Date = new Date()) {
  const { periodStart, periodEnd } = currentPeriodBounds(now);
  return withTenantDb(tenantId, async (db) => {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "usage_periods" ("id","tenantId","periodStart","periodEnd","plan","updatedAt")
      VALUES (${pid()}, ${tenantId}, ${periodStart}, ${periodEnd}, ${plan}, now())
      ON CONFLICT ("tenantId","periodStart") DO NOTHING`);
    return (await db.usagePeriod.findUnique({ where: { tenantId_periodStart: { tenantId, periodStart } } }))!;
  });
}

// ============================ BASIC metering (dedup by content version) ============================
export type BasicResult = { consumed: boolean; reused?: boolean; denied?: boolean; reason?: string; eventId: string };

/**
 * Consume ONE basic unit for the first processing of a unique content version. A retry / reload /
 * unchanged resync (same `idempotencyKey`) consumes 0. When the basic quota is exhausted the item is
 * NOT blocked — this returns `{ denied, reason: "basic_limit_reached" }` and the caller still stores
 * the (honest, rules-based) result with a truthful status.
 */
export async function consumeBasicUnit(
  tenantId: string, plan: string, args: { idempotencyKey: string; tier: "rules" | "local"; reputationItemId?: string; contentItemId?: string; correlationId?: string; internalAccess?: boolean },
  now: Date = new Date(),
): Promise<BasicResult> {
  // V1.73 — internal admin tenant → unlimited processed usage (ENTERPRISE policy, null caps = no guard).
  const policy = resolveEffectiveUsagePolicy(plan, undefined, { internalAccess: args.internalAccess });
  const period = await getOrCreateCurrentPeriod(tenantId, plan, now);
  return withTenantDb(tenantId, async (db) => {
    const existing = await db.usageEvent.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: args.idempotencyKey } } });
    if (existing) return { consumed: false, reused: true, eventId: existing.id };

    const limit = policy.basicUnitsPerPeriod;
    const guard = limit === null ? Prisma.empty : Prisma.sql`AND "basicUnitsUsed" + 1 <= ${limit}`;
    const updated = await db.$executeRaw(Prisma.sql`
      UPDATE "usage_periods" SET "basicUnitsUsed" = "basicUnitsUsed" + 1, "updatedAt" = now()
      WHERE "id" = ${period.id} ${guard}`);

    const base = { tenantId, usagePeriodId: period.id, reputationItemId: args.reputationItemId ?? null, contentItemId: args.contentItemId ?? null, processingTier: args.tier, idempotencyKey: args.idempotencyKey, correlationId: args.correlationId ?? corr() };
    if (updated === 0) {
      const ev = await db.usageEvent.create({ data: { ...base, eventType: "usage.limit_reached", units: 0, status: "denied", reason: "basic_limit_reached" } });
      await usageAudit(db, tenantId, "usage.limit_reached", { tier: "basic", reason: "basic_limit_reached", correlationId: base.correlationId });
      return { consumed: false, denied: true, reason: "basic_limit_reached", eventId: ev.id };
    }
    const ev = await db.usageEvent.create({ data: { ...base, eventType: "usage.basic_consumed", units: 1, status: "succeeded" } });
    await usageAudit(db, tenantId, "usage.basic_consumed", { tier: args.tier, correlationId: base.correlationId });
    return { consumed: true, eventId: ev.id };
  });
}

// ============================ PREMIUM reservation (atomic, idempotent) ============================
export type ReserveResult =
  | { ok: true; eventId: string; periodId: string; reused?: boolean; reservedCostMicros: bigint }
  | { ok: false; reason: string; eventId?: string };

export interface ReserveArgs {
  provider: string; modelKey: string; estMicros: bigint; idempotencyKey: string;
  reputationItemId?: string; contentItemId?: string; correlationId?: string; internalAccess?: boolean;
}

async function reserveOnce(tenantId: string, policy: UsagePolicy, args: ReserveArgs, now: Date): Promise<ReserveResult> {
  const period = await getOrCreateCurrentPeriod(tenantId, policy.plan, now);
  return withTenantDb(tenantId, async (db) => {
    const existing = await db.usageEvent.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: args.idempotencyKey } } });
    if (existing) {
      if (existing.status === "reserved" || existing.status === "succeeded") return { ok: true, eventId: existing.id, periodId: existing.usagePeriodId, reused: true, reservedCostMicros: existing.reservedCostMicros };
      return { ok: false, reason: existing.reason ?? "already_finalized", eventId: existing.id };
    }
    const callLimit = policy.premiumCallsPerPeriod;
    const costLimit = policy.premiumCostLimitMicros;
    const callGuard = callLimit === null ? Prisma.empty : Prisma.sql`AND "premiumCallsUsed" + 1 <= ${callLimit}`;
    const costGuard = costLimit === null ? Prisma.empty : Prisma.sql`AND "premiumCostMicros" + ${args.estMicros} <= ${costLimit}`;
    // ATOMIC: row-lock-serialized guarded increment. 0 rows ⇒ a limit would be exceeded ⇒ deny.
    const updated = await db.$executeRaw(Prisma.sql`
      UPDATE "usage_periods"
      SET "premiumCallsUsed" = "premiumCallsUsed" + 1, "premiumCostMicros" = "premiumCostMicros" + ${args.estMicros}, "updatedAt" = now()
      WHERE "id" = ${period.id} ${callGuard} ${costGuard}`);

    const base = { tenantId, usagePeriodId: period.id, reputationItemId: args.reputationItemId ?? null, contentItemId: args.contentItemId ?? null, processingTier: "paid" as const, provider: args.provider, modelKey: args.modelKey, idempotencyKey: args.idempotencyKey, correlationId: args.correlationId ?? corr() };
    if (updated === 0) {
      const p = await db.usagePeriod.findUnique({ where: { id: period.id } });
      const reason = callLimit !== null && p!.premiumCallsUsed + 1 > callLimit ? "premium_call_limit_reached" : "premium_cost_limit_reached";
      const ev = await db.usageEvent.create({ data: { ...base, eventType: "usage.denied", units: 0, reservedCostMicros: 0n, status: "denied", reason } });
      await usageAudit(db, tenantId, "usage.denied", { reason, provider: args.provider, modelKey: args.modelKey, correlationId: base.correlationId });
      return { ok: false, reason, eventId: ev.id };
    }
    const ev = await db.usageEvent.create({ data: { ...base, eventType: "usage.premium_reserved", units: 0, reservedCostMicros: args.estMicros, status: "reserved" } });
    await usageAudit(db, tenantId, "usage.premium_reserved", { provider: args.provider, modelKey: args.modelKey, reservedCostMicros: args.estMicros.toString(), correlationId: base.correlationId });
    return { ok: true, eventId: ev.id, periodId: period.id, reservedCostMicros: args.estMicros };
  });
}

/**
 * Reserve one paid call + its estimated cost BEFORE any provider request. Concurrency-safe (atomic
 * guarded UPDATE) and idempotent (a same-key retry never double-charges — the losing concurrent
 * transaction rolls back, undoing its increment).
 */
export async function reservePremiumCall(tenantId: string, plan: string, args: ReserveArgs, now: Date = new Date()): Promise<ReserveResult> {
  // V1.73 — internal admin tenant → unlimited paid AI (ENTERPRISE policy).
  const policy = resolveEffectiveUsagePolicy(plan, undefined, { internalAccess: args.internalAccess });
  try {
    return await reserveOnce(tenantId, policy, args, now);
  } catch (e) {
    if (isUnique(e)) {
      const ev = await withTenantDb(tenantId, (db) => db.usageEvent.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: args.idempotencyKey } } }));
      if (ev) return ev.status === "reserved" || ev.status === "succeeded"
        ? { ok: true, eventId: ev.id, periodId: ev.usagePeriodId, reused: true, reservedCostMicros: ev.reservedCostMicros }
        : { ok: false, reason: ev.reason ?? "denied", eventId: ev.id };
    }
    throw e;
  }
}

/**
 * Finalize a reservation after the provider call. `succeeded` → record actual cost (adjust the
 * period by actual−reserved). `failed` with `billed:false` → RELEASE (refund the reserved call +
 * cost). `failed` with `billed:true` → keep the charge (provider billed us). Idempotent: a
 * non-reserved event is a no-op.
 */
export function finalizePremiumCall(
  tenantId: string, eventId: string,
  outcome: { status: "succeeded" | "failed"; actualCostMicros?: bigint; billed?: boolean; inputTokens?: number; outputTokens?: number },
): Promise<{ ok: boolean; reason?: string }> {
  return withTenantDb(tenantId, async (db) => {
    const ev = await db.usageEvent.findUnique({ where: { id: eventId } });
    if (!ev) return { ok: false, reason: "not_found" };
    if (ev.status !== "reserved") return { ok: true }; // idempotent

    const release = outcome.status === "failed" && outcome.billed !== true;
    if (release) {
      await db.$executeRaw(Prisma.sql`
        UPDATE "usage_periods" SET "premiumCallsUsed" = GREATEST("premiumCallsUsed" - 1, 0),
          "premiumCostMicros" = GREATEST("premiumCostMicros" - ${ev.reservedCostMicros}, 0), "updatedAt" = now()
        WHERE "id" = ${ev.usagePeriodId}`);
      await db.usageEvent.update({ where: { id: eventId }, data: { status: "released", eventType: "usage.premium_released", actualCostMicros: 0n } });
      await usageAudit(db, tenantId, "usage.premium_released", { correlationId: ev.correlationId ?? undefined });
      return { ok: true };
    }
    const actual = outcome.actualCostMicros ?? ev.reservedCostMicros;
    const delta = actual - ev.reservedCostMicros;
    if (delta !== 0n) {
      await db.$executeRaw(Prisma.sql`
        UPDATE "usage_periods" SET "premiumCostMicros" = GREATEST("premiumCostMicros" + ${delta}, 0), "updatedAt" = now()
        WHERE "id" = ${ev.usagePeriodId}`);
    }
    await db.usageEvent.update({ where: { id: eventId }, data: {
      status: outcome.status, eventType: "usage.premium_finalized", units: 1, actualCostMicros: actual,
      // Provider-reported token usage (nullable) — for the admin diagnostics join only.
      inputTokens: outcome.inputTokens ?? null, outputTokens: outcome.outputTokens ?? null,
    } });
    await usageAudit(db, tenantId, "usage.premium_finalized", { status: outcome.status, actualCostMicros: actual.toString(), correlationId: ev.correlationId ?? undefined });
    return { ok: true };
  });
}

/** Explicit release of a reservation that never reached the provider (e.g. fuse opened post-reserve). */
export function releaseReservation(tenantId: string, eventId: string, reason: string): Promise<{ ok: boolean }> {
  return finalizePremiumCall(tenantId, eventId, { status: "failed", billed: false }).then(async (r) => {
    if (r.ok) await withTenantDb(tenantId, (db) => db.usageEvent.update({ where: { id: eventId }, data: { reason } }).then(() => undefined).catch(() => undefined));
    return { ok: r.ok };
  });
}

/** Crash-safe recovery: release reservations left `reserved` longer than the TTL (stale). */
export function recoverStaleReservations(tenantId: string, olderThanMs = 5 * 60_000, now: Date = new Date()): Promise<{ recovered: number }> {
  return withTenantDb(tenantId, async (db) => {
    const cutoff = new Date(now.getTime() - olderThanMs);
    const stale = await db.usageEvent.findMany({ where: { status: "reserved", createdAt: { lt: cutoff } }, select: { id: true, usagePeriodId: true, reservedCostMicros: true, correlationId: true } });
    for (const s of stale) {
      await db.$executeRaw(Prisma.sql`
        UPDATE "usage_periods" SET "premiumCallsUsed" = GREATEST("premiumCallsUsed" - 1, 0),
          "premiumCostMicros" = GREATEST("premiumCostMicros" - ${s.reservedCostMicros}, 0), "updatedAt" = now()
        WHERE "id" = ${s.usagePeriodId}`);
      await db.usageEvent.update({ where: { id: s.id }, data: { status: "released", eventType: "usage.premium_released", reason: "stale_reservation_recovered", actualCostMicros: 0n } });
      await usageAudit(db, tenantId, "usage.premium_released", { reason: "stale_reservation_recovered", correlationId: s.correlationId ?? undefined });
    }
    return { recovered: stale.length };
  });
}

// ============================ AI result cache ============================
export function cacheGet(tenantId: string, contentHash: string, modelKey: string, policyVersion: string) {
  return withTenantDb(tenantId, (db) => db.aiResultCache.findUnique({ where: { tenantId_contentHash_modelKey_policyVersion: { tenantId, contentHash, modelKey, policyVersion } } }));
}
export function cachePut(tenantId: string, args: { contentHash: string; modelKey: string; policyVersion: string; normalizedResult: unknown; expiresAt?: Date }) {
  return withTenantDb(tenantId, (db) => db.aiResultCache.upsert({
    where: { tenantId_contentHash_modelKey_policyVersion: { tenantId, contentHash: args.contentHash, modelKey: args.modelKey, policyVersion: args.policyVersion } },
    create: { tenantId, contentHash: args.contentHash, modelKey: args.modelKey, policyVersion: args.policyVersion, normalizedResult: args.normalizedResult as Prisma.InputJsonValue, expiresAt: args.expiresAt ?? null },
    update: { normalizedResult: args.normalizedResult as Prisma.InputJsonValue, expiresAt: args.expiresAt ?? null },
  }));
}
export async function recordCacheHit(tenantId: string, args: { idempotencyKey: string; reputationItemId?: string; contentItemId?: string; correlationId?: string }, plan: string, now: Date = new Date()): Promise<{ ok: boolean }> {
  const period = await getOrCreateCurrentPeriod(tenantId, plan, now);
  return withTenantDb(tenantId, async (db) => {
    const dup = await db.usageEvent.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: args.idempotencyKey } } });
    if (dup) return { ok: true };
    await db.usageEvent.create({ data: { tenantId, usagePeriodId: period.id, reputationItemId: args.reputationItemId ?? null, contentItemId: args.contentItemId ?? null, eventType: "usage.cache_hit", processingTier: "rules", units: 0, status: "cached", idempotencyKey: args.idempotencyKey, correlationId: args.correlationId ?? corr() } });
    await usageAudit(db, tenantId, "usage.cache_hit", { correlationId: args.correlationId });
    return { ok: true };
  });
}

// ============================ Usage summary (UI + diagnostic) ============================
export type UsageStatus = "normal" | "warning" | "critical" | "exhausted";
export interface UsageSummary {
  plan: UsagePlan; periodStart: Date; periodEnd: Date; nextReset: Date;
  basic: { used: number; limit: number | null; percent: number };
  premiumCalls: { used: number; limit: number | null; percent: number };
  premiumCost: { usedMicros: bigint; limitMicros: bigint | null; percent: number };
  status: UsageStatus;
}

function pct(used: number, limit: number | null): number { return limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0; }
function statusFromPercent(p: number): UsageStatus { return p >= 100 ? "exhausted" : p >= 80 ? "critical" : p >= 50 ? "warning" : "normal"; }

// ============================ Admin diagnostic (no secrets / raw content) ============================
export interface UsageDiagnostic {
  summary: UsageSummary;
  reservations: number;
  staleReservations: number;
  deniedCount: number;
  cacheHitRate: number; // 0..1 over the current period
  policy: { plan: UsagePlan; basicUnitsPerPeriod: number | null; premiumCallsPerPeriod: number | null; premiumCostLimitMicros: string | null; allowPaidFallback: boolean; allowGeneratedReplies: boolean };
}

export async function getUsageDiagnostic(tenantId: string, plan: string, now: Date = new Date(), staleMs = 5 * 60_000): Promise<UsageDiagnostic> {
  const summary = await getUsageSummary(tenantId, plan, now);
  const policy = resolveUsagePolicy(plan);
  const cutoff = new Date(now.getTime() - staleMs);
  const [reservations, staleReservations, deniedCount, cacheHits, basicConsumed, premiumFinal] = await withTenantDb(tenantId, (db) => Promise.all([
    db.usageEvent.count({ where: { status: "reserved" } }),
    db.usageEvent.count({ where: { status: "reserved", createdAt: { lt: cutoff } } }),
    db.usageEvent.count({ where: { status: "denied" } }),
    db.usageEvent.count({ where: { eventType: "usage.cache_hit", createdAt: { gte: summary.periodStart } } }),
    db.usageEvent.count({ where: { eventType: "usage.basic_consumed", createdAt: { gte: summary.periodStart } } }),
    db.usageEvent.count({ where: { eventType: "usage.premium_finalized", createdAt: { gte: summary.periodStart } } }),
  ]));
  const totalProcessing = cacheHits + basicConsumed + premiumFinal;
  return {
    summary, reservations, staleReservations, deniedCount,
    cacheHitRate: totalProcessing > 0 ? cacheHits / totalProcessing : 0,
    policy: { plan: policy.plan, basicUnitsPerPeriod: policy.basicUnitsPerPeriod, premiumCallsPerPeriod: policy.premiumCallsPerPeriod, premiumCostLimitMicros: policy.premiumCostLimitMicros === null ? null : policy.premiumCostLimitMicros.toString(), allowPaidFallback: policy.allowPaidFallback, allowGeneratedReplies: policy.allowGeneratedReplies },
  };
}

/** Read (creating if needed) the current period and derive the UI summary. Counters are the truth. */
export async function getUsageSummary(tenantId: string, plan: string, now: Date = new Date(), internalAccess = false): Promise<UsageSummary> {
  // V1.73 — internal admin tenant → unlimited usage display (ENTERPRISE policy).
  const policy = resolveEffectiveUsagePolicy(plan, undefined, { internalAccess });
  const period = await getOrCreateCurrentPeriod(tenantId, policy.plan, now);
  const basicPct = pct(period.basicUnitsUsed, policy.basicUnitsPerPeriod);
  const callPct = pct(period.premiumCallsUsed, policy.premiumCallsPerPeriod);
  const costPct = policy.premiumCostLimitMicros && policy.premiumCostLimitMicros > 0n
    ? Math.min(100, Number((period.premiumCostMicros * 100n) / policy.premiumCostLimitMicros)) : 0;
  const worst = Math.max(basicPct, callPct, costPct);
  return {
    plan: policy.plan, periodStart: period.periodStart, periodEnd: period.periodEnd, nextReset: period.periodEnd,
    basic: { used: period.basicUnitsUsed, limit: policy.basicUnitsPerPeriod, percent: basicPct },
    premiumCalls: { used: period.premiumCallsUsed, limit: policy.premiumCallsPerPeriod, percent: callPct },
    premiumCost: { usedMicros: period.premiumCostMicros, limitMicros: policy.premiumCostLimitMicros, percent: costPct },
    status: statusFromPercent(worst),
  };
}
