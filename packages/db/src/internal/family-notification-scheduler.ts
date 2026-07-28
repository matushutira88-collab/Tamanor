/**
 * FAMILY NOTIFICATIONS PHASE 3C — scheduler LEASE + RUNNER + HEALTH (owner/system, server-only).
 *
 * NOT exported from the @guardora/db barrel; invoked only by the authenticated cron route and the local command.
 *
 * Lease: a global, named, DB-backed lease (scheduler_leases, owner-only) gives OVERLAP protection across
 * concurrent cron invocations — atomic acquire, a live lease cannot be stolen, an expired lease is recoverable,
 * only the holder token can release, and a crash simply lets the lease expire. It is NOT the dedupe authority
 * (the outbox unique index is). It stores no tenant/user/source id.
 *
 * Runner: acquire → evaluate expiring invitations → evaluate expiring consents → drain the outbox in bounded
 * batches (stop on empty / batch-limit / time-budget) → release. Returns AGGREGATE counts only.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { systemDb } from "../index";
import { processFamilyNotificationOutboxBatch, getFamilyNotificationOutboxHealth, type OutboxAgeBucket } from "./family-notification-outbox-processor";
import { evaluateExpiringGuardianInvitations, evaluateExpiringConsents, countExpiryWarningWindows } from "./family-notification-expiry";

export const FAMILY_NOTIFICATIONS_SCHEDULER_LEASE_KEY = "family-notifications-scheduler";
const SCHEDULER_LEASE_MS = 4 * 60 * 1000; // 4 min (< the 5-min cadence: a crashed run's lease expires before the next-but-one tick)
const DEFAULT_EXPIRY_BATCH = 100;
const DEFAULT_OUTBOX_BATCH = 50;
const DEFAULT_MAX_OUTBOX_BATCHES = 20;
const HARD_MAX_OUTBOX_BATCHES = 100;
const DEFAULT_TIME_BUDGET_MS = 45_000;
const HARD_MAX_TIME_BUDGET_MS = 120_000;
const clamp = (n: number | undefined, def: number, max: number) => Math.max(1, Math.min(max, typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : def));

// ── DB-backed lease ──────────────────────────────────────────────────────────────────────────────
export interface SchedulerLeaseHandle { acquired: boolean; holder: string }

/** Atomically acquire (or steal-if-expired) the named lease. A LIVE lease held by anyone → acquired:false. */
export async function acquireSchedulerLease(leaseKey: string, holder: string, durationMs: number, now: Date): Promise<SchedulerLeaseHandle> {
  const expiresAt = new Date(now.getTime() + durationMs);
  const rows = await systemDb.$queryRaw<Array<{ holder: string }>>(Prisma.sql`
    INSERT INTO "scheduler_leases" ("leaseKey","holder","acquiredAt","expiresAt","heartbeatAt","createdAt","updatedAt")
    VALUES (${leaseKey}, ${holder}, ${now}, ${expiresAt}, ${now}, ${now}, ${now})
    ON CONFLICT ("leaseKey") DO UPDATE
      SET "holder" = EXCLUDED."holder", "acquiredAt" = EXCLUDED."acquiredAt", "expiresAt" = EXCLUDED."expiresAt",
          "heartbeatAt" = EXCLUDED."heartbeatAt", "updatedAt" = EXCLUDED."updatedAt"
      WHERE "scheduler_leases"."expiresAt" < ${now}
    RETURNING "holder"
  `);
  return { acquired: rows.length > 0 && rows[0]!.holder === holder, holder };
}

/** Release ONLY if the caller holds the lease (wrong token → no release). */
export async function releaseSchedulerLease(leaseKey: string, holder: string): Promise<{ released: boolean }> {
  const n = await systemDb.$executeRaw(Prisma.sql`DELETE FROM "scheduler_leases" WHERE "leaseKey" = ${leaseKey} AND "holder" = ${holder}`);
  return { released: n > 0 };
}

// ── Runner ───────────────────────────────────────────────────────────────────────────────────────
export interface RunSchedulerOptions {
  now?: Date;
  workerId?: string;
  expiryBatchSize?: number;
  outboxBatchSize?: number;
  maxOutboxBatches?: number;
  timeBudgetMs?: number;
}
export interface RunSchedulerResult {
  acquired: boolean;
  invitationsScanned: number;
  invitationsEnqueued: number;
  consentsScanned: number;
  consentsEnqueued: number;
  outboxClaimed: number;
  outboxCompleted: number;
  outboxRetried: number;
  outboxDeadLetter: number;
  notificationsCreated: number;
  duplicates: number;
  noRecipients: number;
  stoppedReason: "completed" | "lease_busy" | "time_budget" | "batch_limit";
}

const ZERO = (): Omit<RunSchedulerResult, "acquired" | "stoppedReason"> => ({
  invitationsScanned: 0, invitationsEnqueued: 0, consentsScanned: 0, consentsEnqueued: 0,
  outboxClaimed: 0, outboxCompleted: 0, outboxRetried: 0, outboxDeadLetter: 0,
  notificationsCreated: 0, duplicates: 0, noRecipients: 0,
});

/**
 * One bounded scheduler cycle. Stage order: lease → invitations → consents → outbox drain → release. Returns
 * aggregate counts + a bounded stoppedReason. No source/tenant/user/recipient id or raw error is ever returned.
 * `elapsed` (real wall-clock) is injectable for deterministic time-budget tests.
 */
export async function runFamilyNotificationScheduler(
  opts: RunSchedulerOptions = {},
  deps: { elapsedMs?: () => number } = {},
): Promise<RunSchedulerResult> {
  const now = opts.now ?? new Date();
  const workerId = opts.workerId ?? randomUUID();
  const expiryBatchSize = clamp(opts.expiryBatchSize, DEFAULT_EXPIRY_BATCH, 500);
  const outboxBatchSize = clamp(opts.outboxBatchSize, DEFAULT_OUTBOX_BATCH, 500);
  const maxOutboxBatches = clamp(opts.maxOutboxBatches, DEFAULT_MAX_OUTBOX_BATCHES, HARD_MAX_OUTBOX_BATCHES);
  const timeBudgetMs = clamp(opts.timeBudgetMs, DEFAULT_TIME_BUDGET_MS, HARD_MAX_TIME_BUDGET_MS);
  const startedAt = Date.now();
  const elapsed = deps.elapsedMs ?? (() => Date.now() - startedAt);

  const lease = await acquireSchedulerLease(FAMILY_NOTIFICATIONS_SCHEDULER_LEASE_KEY, workerId, SCHEDULER_LEASE_MS, now);
  if (!lease.acquired) return { acquired: false, stoppedReason: "lease_busy", ...ZERO() };

  const agg = ZERO();
  let stoppedReason: RunSchedulerResult["stoppedReason"] = "completed";
  try {
    const inv = await evaluateExpiringGuardianInvitations({ now, batchSize: expiryBatchSize });
    agg.invitationsScanned = inv.scanned; agg.invitationsEnqueued = inv.enqueued;
    const con = await evaluateExpiringConsents({ now, batchSize: expiryBatchSize });
    agg.consentsScanned = con.scanned; agg.consentsEnqueued = con.enqueued;

    for (let batch = 0; ; batch += 1) {
      if (batch >= maxOutboxBatches) { stoppedReason = "batch_limit"; break; }
      if (elapsed() >= timeBudgetMs) { stoppedReason = "time_budget"; break; }
      const r = await processFamilyNotificationOutboxBatch({ batchSize: outboxBatchSize, now });
      agg.outboxClaimed += r.claimed; agg.outboxCompleted += r.completed; agg.outboxRetried += r.retried;
      agg.outboxDeadLetter += r.dead_letter; agg.notificationsCreated += r.notifications_created;
      agg.duplicates += r.duplicates; agg.noRecipients += r.no_recipients;
      if (r.claimed === 0) { stoppedReason = "completed"; break; }
    }
  } finally {
    await releaseSchedulerLease(FAMILY_NOTIFICATIONS_SCHEDULER_LEASE_KEY, workerId).catch(() => {});
  }
  return { acquired: true, stoppedReason, ...agg };
}

// ── Health (aggregate only; no ids/tenants/emails/source details) ──────────────────────────────────
export type SchedulerLeaseState = "free" | "active" | "expired";
export interface FamilyNotificationSchedulerHealth {
  pending: number;
  processing: number;
  lease_expired: number;
  retry_due: number;
  dead_letter: number;
  oldestPendingAgeBucket: OutboxAgeBucket;
  invitationsInWindow: number;
  consentsInWindow: number;
  schedulerLease: SchedulerLeaseState;
}

export async function getFamilyNotificationSchedulerHealth(now: Date = new Date()): Promise<FamilyNotificationSchedulerHealth> {
  const [outbox, windows, leaseRow] = await Promise.all([
    getFamilyNotificationOutboxHealth(now),
    countExpiryWarningWindows(now),
    systemDb.schedulerLease.findUnique({ where: { leaseKey: FAMILY_NOTIFICATIONS_SCHEDULER_LEASE_KEY }, select: { expiresAt: true } }),
  ]);
  const schedulerLease: SchedulerLeaseState = !leaseRow ? "free" : leaseRow.expiresAt.getTime() > now.getTime() ? "active" : "expired";
  return { ...outbox, invitationsInWindow: windows.invitationsInWindow, consentsInWindow: windows.consentsInWindow, schedulerLease };
}
