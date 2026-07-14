/**
 * V1.44B — GLOBAL paid-AI daily hard cap (cross-tenant, system-scope). Backed by the
 * `global_ai_usage_periods` table via the OWNER connection (systemDb) so the cap is MULTI-INSTANCE
 * SAFE (an atomic guarded UPDATE, row-lock serialized). This module is the ONLY sanctioned access
 * point; it is never imported by tenant-facing web request code (boundary-tested). No RLS, no
 * tenantId — the table holds only aggregate counters, never content or PII.
 */
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { systemDb } from "./index";

const gid = () => `gap_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export type GlobalReserveResult = { ok: true; reservedMicros: bigint } | { ok: false; reason: string };

/**
 * Atomically reserve one global paid call + its estimated cost against the per-UTC-day/per-provider
 * caps. Fail-closed: 0 rows updated ⇒ a cap would be exceeded ⇒ denied BEFORE any provider HTTP.
 */
export async function reserveGlobalDailyCall(
  provider: string, estMicros: bigint, caps: { callLimit: number; costLimitMicros: number }, now: Date = new Date(),
): Promise<GlobalReserveResult> {
  const periodStart = dayStart(now);
  await systemDb.$executeRaw(Prisma.sql`
    INSERT INTO "global_ai_usage_periods" ("id","periodStart","provider","updatedAt")
    VALUES (${gid()}, ${periodStart}, ${provider}, now())
    ON CONFLICT ("periodStart","provider") DO NOTHING`);
  const updated = await systemDb.$executeRaw(Prisma.sql`
    UPDATE "global_ai_usage_periods"
    SET "callsUsed" = "callsUsed" + 1, "costMicros" = "costMicros" + ${estMicros}, "updatedAt" = now()
    WHERE "periodStart" = ${periodStart} AND "provider" = ${provider}
      AND "callsUsed" + 1 <= ${caps.callLimit}
      AND "costMicros" + ${estMicros} <= ${caps.costLimitMicros}`);
  if (updated === 0) {
    const row = await systemDb.globalAiUsagePeriod.findUnique({ where: { periodStart_provider: { periodStart, provider } } });
    const reason = row && row.callsUsed + 1 > caps.callLimit ? "global_daily_call_limit" : "global_daily_cost_limit";
    return { ok: false, reason };
  }
  return { ok: true, reservedMicros: estMicros };
}

/** Adjust the reserved global cost to the actual reported cost (call count unchanged). */
export async function finalizeGlobalDailyCall(provider: string, reservedMicros: bigint, actualMicros: bigint, now: Date = new Date()): Promise<void> {
  const delta = actualMicros - reservedMicros;
  if (delta === 0n) return;
  const periodStart = dayStart(now);
  await systemDb.$executeRaw(Prisma.sql`
    UPDATE "global_ai_usage_periods" SET "costMicros" = GREATEST("costMicros" + ${delta}, 0), "updatedAt" = now()
    WHERE "periodStart" = ${periodStart} AND "provider" = ${provider}`);
}

/** Release a global reservation that never billed (tenant reserve failed / provider failed unbilled). */
export async function releaseGlobalDailyCall(provider: string, reservedMicros: bigint, now: Date = new Date()): Promise<void> {
  const periodStart = dayStart(now);
  await systemDb.$executeRaw(Prisma.sql`
    UPDATE "global_ai_usage_periods"
    SET "callsUsed" = GREATEST("callsUsed" - 1, 0), "costMicros" = GREATEST("costMicros" - ${reservedMicros}, 0), "updatedAt" = now()
    WHERE "periodStart" = ${periodStart} AND "provider" = ${provider}`);
}

/** Diagnostic snapshot for today's provider counters (system-scope; no secrets). */
export async function getGlobalDailyUsage(provider: string, now: Date = new Date()): Promise<{ callsUsed: number; costMicros: bigint }> {
  const periodStart = dayStart(now);
  const row = await systemDb.globalAiUsagePeriod.findUnique({ where: { periodStart_provider: { periodStart, provider } } });
  return { callsUsed: row?.callsUsed ?? 0, costMicros: row?.costMicros ?? 0n };
}
