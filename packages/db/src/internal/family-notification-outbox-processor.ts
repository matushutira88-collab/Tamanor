/**
 * FAMILY NOTIFICATIONS PHASE 3A — durable delivery outbox PROCESSOR + health (trusted server boundary).
 *
 * NOT exported from the @guardora/db barrel. Invoked only by the local maintenance CLI (and tests). Runs as the
 * owner (systemDb, BYPASSRLS) so it can claim across tenants, but EVERY statement carries an explicit tenant
 * constraint and the actual notification rows are written by the PUBLIC safe entry point
 * `createAuthorizedFamilyNotification` (which re-opens a tenant-scoped, RLS-enforced transaction and re-evaluates
 * current authorization). The processor NEVER constructs recipients or notification content itself.
 *
 * Guarantees: at-least-once event processing with exactly-once OBSERVABLE notification rows. Idempotency comes
 * from two independent DB unique indexes — the outbox (tenant, dedupeKey) collapses duplicate events, and the
 * notification (tenant, dedupeKey) collapses duplicate rows — so a crash between "notifications committed" and
 * "event marked completed" is recovered by simply reprocessing (the re-run returns all-duplicates → completed,
 * no second rows). Claiming uses FOR UPDATE SKIP LOCKED so concurrent workers take DISJOINT rows.
 */
import { Prisma } from "@prisma/client";
import { systemDb } from "../index";
import {
  OUTBOX_MAX_ATTEMPTS, OUTBOX_LEASE_DURATION_MS, OUTBOX_DEFAULT_BATCH_SIZE, OUTBOX_MAX_BATCH_SIZE,
  OUTBOX_SAFE_REASON, OUTBOX_ERROR_CODE, OUTBOX_SOURCE_TYPE, outboxRetryDelayMs,
  type OutboxSafeReason, type OutboxErrorCode,
} from "./family-notification-outbox";
import {
  createAuthorizedFamilyNotification as realCreateAuthorizedFamilyNotification,
  type AuthorizedFamilyNotificationCreationResult,
} from "./family-notification-authorization";

const EVENT_VERSION_RE = /^[A-Za-z0-9._:-]{1,64}$/;

function boundBatch(n: number | undefined): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : OUTBOX_DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(OUTBOX_MAX_BATCH_SIZE, v));
}

interface ClaimedRow {
  id: string;
  tenantId: string;
  notificationType: string;
  sourceType: string;
  sourceId: string;
  eventVersion: string;
  occurredAt: Date;
  attemptCount: number; // value AFTER the claim's +1 increment
}

export interface ProcessOutboxOptions {
  batchSize?: number;
  now?: Date;
  workerId?: string; // informational only (not persisted; leases are time-based, not owner-based)
}

export interface ProcessOutboxResult {
  claimed: number;
  completed: number;
  retried: number;
  dead_letter: number;
  notifications_created: number;
  duplicates: number;
  no_recipients: number;
}

/** Injectable for tests (fault injection / determinism). Production always uses the real safe entry point. */
export interface OutboxProcessorDeps {
  createAuthorizedFamilyNotification?: (input: {
    tenantId: string;
    source: { type: "family_delivery_available"; deliveryId: string; eventVersion: string; occurredAt?: Date };
    safeReasonCode?: string | null;
    now?: Date;
  }) => Promise<AuthorizedFamilyNotificationCreationResult>;
}

type Outcome =
  | { kind: "completed"; safeReasonCode: OutboxSafeReason; created: number; duplicates: number; noRecipients: boolean }
  | { kind: "retry"; errorCode: OutboxErrorCode }
  | { kind: "dead_letter"; errorCode: OutboxErrorCode };

/**
 * Claim a bounded batch (pending-and-due OR lease-expired), process each with current-authorization semantics,
 * and durably classify the outcome. Returns AGGREGATE counts only — never ids/tenants/recipients.
 */
export async function processFamilyNotificationOutboxBatch(
  opts: ProcessOutboxOptions = {},
  deps: OutboxProcessorDeps = {},
): Promise<ProcessOutboxResult> {
  const now = opts.now ?? new Date();
  const batchSize = boundBatch(opts.batchSize);
  const createFn = deps.createAuthorizedFamilyNotification ?? realCreateAuthorizedFamilyNotification;
  const leaseExpiry = new Date(now.getTime() + OUTBOX_LEASE_DURATION_MS);

  // CLAIM — atomic move to `processing`, take a time-based lease, bump attemptCount. Two workers get DISJOINT
  // rows (SKIP LOCKED); a crashed worker's row is reclaimable once its lease expires.
  const claimed = await systemDb.$queryRaw<ClaimedRow[]>(Prisma.sql`
    UPDATE "family_notification_outbox_events" AS e
    SET "status" = 'processing', "lockedAt" = ${now}, "lockExpiresAt" = ${leaseExpiry},
        "attemptCount" = e."attemptCount" + 1, "updatedAt" = ${now}
    WHERE e."id" IN (
      SELECT c."id" FROM "family_notification_outbox_events" c
      WHERE (c."status" = 'pending' AND c."nextAttemptAt" <= ${now})
         OR (c."status" = 'processing' AND c."lockExpiresAt" < ${now})
      ORDER BY c."nextAttemptAt" ASC, c."createdAt" ASC, c."id" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING e."id", e."tenantId", e."notificationType", e."sourceType", e."sourceId",
              e."eventVersion", e."occurredAt", e."attemptCount"
  `);

  const agg: ProcessOutboxResult = { claimed: claimed.length, completed: 0, retried: 0, dead_letter: 0, notifications_created: 0, duplicates: 0, no_recipients: 0 };

  for (const ev of claimed) {
    const outcome = await processOne(ev, now, createFn);
    if (outcome.kind === "completed") {
      agg.completed += 1;
      agg.notifications_created += outcome.created;
      agg.duplicates += outcome.duplicates;
      if (outcome.noRecipients) agg.no_recipients += 1;
      await systemDb.$executeRaw(Prisma.sql`
        UPDATE "family_notification_outbox_events"
        SET "status" = 'completed', "completedAt" = ${now}, "safeReasonCode" = ${outcome.safeReasonCode},
            "lastErrorCode" = NULL, "lockedAt" = NULL, "lockExpiresAt" = NULL, "updatedAt" = ${now}
        WHERE "id" = ${ev.id} AND "tenantId" = ${ev.tenantId}`);
    } else if (outcome.kind === "retry" && ev.attemptCount < OUTBOX_MAX_ATTEMPTS) {
      agg.retried += 1;
      const nextAttemptAt = new Date(now.getTime() + outboxRetryDelayMs(ev.attemptCount));
      await systemDb.$executeRaw(Prisma.sql`
        UPDATE "family_notification_outbox_events"
        SET "status" = 'pending', "nextAttemptAt" = ${nextAttemptAt}, "lastErrorCode" = ${outcome.errorCode},
            "lockedAt" = NULL, "lockExpiresAt" = NULL, "updatedAt" = ${now}
        WHERE "id" = ${ev.id} AND "tenantId" = ${ev.tenantId}`);
    } else {
      // Permanent failure OR retries exhausted → dead-letter (retained for audit; never deleted).
      const errorCode: OutboxErrorCode = outcome.kind === "retry" ? OUTBOX_ERROR_CODE.max_attempts_exceeded : outcome.errorCode;
      agg.dead_letter += 1;
      await systemDb.$executeRaw(Prisma.sql`
        UPDATE "family_notification_outbox_events"
        SET "status" = 'dead_letter', "lastErrorCode" = ${errorCode},
            "lockedAt" = NULL, "lockExpiresAt" = NULL, "updatedAt" = ${now}
        WHERE "id" = ${ev.id} AND "tenantId" = ${ev.tenantId}`);
    }
  }

  return agg;
}

async function processOne(
  ev: ClaimedRow,
  now: Date,
  createFn: NonNullable<OutboxProcessorDeps["createAuthorizedFamilyNotification"]>,
): Promise<Outcome> {
  // Bounded parse/validate — a malformed or not-yet-wired event dead-letters (never retried forever).
  if (ev.notificationType !== "family_delivery_available") return { kind: "dead_letter", errorCode: OUTBOX_ERROR_CODE.unsupported_type };
  if (ev.sourceType !== OUTBOX_SOURCE_TYPE.safety_signal_delivery || !ev.sourceId) return { kind: "dead_letter", errorCode: OUTBOX_ERROR_CODE.malformed_event };
  if (!EVENT_VERSION_RE.test(ev.eventVersion)) return { kind: "dead_letter", errorCode: OUTBOX_ERROR_CODE.invalid_event_version };

  let result: AuthorizedFamilyNotificationCreationResult;
  try {
    result = await createFn({
      tenantId: ev.tenantId,
      source: { type: "family_delivery_available", deliveryId: ev.sourceId, eventVersion: ev.eventVersion, occurredAt: ev.occurredAt },
      now,
    });
  } catch {
    // Any thrown error is treated as transient (bounded code only; NO raw exception text is persisted).
    return { kind: "retry", errorCode: OUTBOX_ERROR_CODE.processing_error };
  }

  if (result.ok) {
    if (result.eligibleRecipientCount === 0) {
      return { kind: "completed", safeReasonCode: OUTBOX_SAFE_REASON.no_recipients, created: 0, duplicates: result.duplicateCount, noRecipients: true };
    }
    const safeReasonCode = result.createdCount > 0 ? OUTBOX_SAFE_REASON.delivered : OUTBOX_SAFE_REASON.already_delivered;
    return { kind: "completed", safeReasonCode, created: result.createdCount, duplicates: result.duplicateCount, noRecipients: false };
  }

  // Resolver failures: transient vs terminal-but-safe vs permanent-malformed.
  switch (result.reason) {
    case "resolver_error":
      return { kind: "retry", errorCode: OUTBOX_ERROR_CODE.processing_error };
    case "unsupported_type":
      return { kind: "dead_letter", errorCode: OUTBOX_ERROR_CODE.unsupported_type };
    case "authorization_ambiguous":
      return { kind: "dead_letter", errorCode: OUTBOX_ERROR_CODE.contradictory_linkage };
    case "source_not_found":
      // The delivery no longer exists → no notification is owed. Terminal-safe.
      return { kind: "completed", safeReasonCode: OUTBOX_SAFE_REASON.source_gone, created: 0, duplicates: 0, noRecipients: true };
    default:
      // workspace/tenant/profile mismatch or invalid source state → the source no longer requires a
      // notification. Terminal-safe (retrying cannot make it valid).
      return { kind: "completed", safeReasonCode: OUTBOX_SAFE_REASON.not_applicable, created: 0, duplicates: 0, noRecipients: true };
  }
}

// ── Read-only operational health (aggregate counts only; NO ids/tenants/recipients) ───────────────
export type OutboxAgeBucket = "none" | "lt_1m" | "lt_1h" | "lt_1d" | "gte_1d";
export interface OutboxHealth {
  pending: number;
  processing: number;
  lease_expired: number;
  retry_due: number;
  dead_letter: number;
  oldestPendingAgeBucket: OutboxAgeBucket;
}

function ageBucket(oldest: Date | null, now: Date): OutboxAgeBucket {
  if (!oldest) return "none";
  const ms = now.getTime() - oldest.getTime();
  if (ms < 60_000) return "lt_1m";
  if (ms < 3_600_000) return "lt_1h";
  if (ms < 86_400_000) return "lt_1d";
  return "gte_1d";
}

export async function getFamilyNotificationOutboxHealth(now: Date = new Date()): Promise<OutboxHealth> {
  const [pending, processing, lease_expired, retry_due, dead_letter, oldestPending] = await Promise.all([
    systemDb.familyNotificationOutboxEvent.count({ where: { status: "pending" } }),
    systemDb.familyNotificationOutboxEvent.count({ where: { status: "processing", lockExpiresAt: { gte: now } } }),
    systemDb.familyNotificationOutboxEvent.count({ where: { status: "processing", lockExpiresAt: { lt: now } } }),
    systemDb.familyNotificationOutboxEvent.count({ where: { status: "pending", nextAttemptAt: { lte: now } } }),
    systemDb.familyNotificationOutboxEvent.count({ where: { status: "dead_letter" } }),
    systemDb.familyNotificationOutboxEvent.findFirst({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  return { pending, processing, lease_expired, retry_due, dead_letter, oldestPendingAgeBucket: ageBucket(oldestPending?.createdAt ?? null, now) };
}
