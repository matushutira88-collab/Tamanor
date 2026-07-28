/**
 * FAMILY NOTIFICATIONS PHASE 3A — durable delivery OUTBOX (enqueue side + shared operational vocabulary).
 *
 * This module is DELIBERATELY NOT exported from the @guardora/db barrel. It holds only the pieces that the
 * canonical domain transition needs to enqueue an event ATOMICALLY inside its own transaction — plus the bounded
 * constants and code catalogues shared with the processor. It imports NOTHING from the recipient-authorization
 * kernel (the processor does that), so the canonical delivery transition can depend on the enqueue without a
 * circular import.
 *
 * Enqueue is transaction-safe and deterministic:
 *   - the caller supplies ONLY bounded routing (tenant + source + a persisted eventVersion) — never recipients,
 *     title/message, severity, route, metadata, status, attempt, or lock state;
 *   - deduplication is by the DB unique index (tenant, dedupeKey); insertion uses createMany skip-duplicates
 *     (ON CONFLICT DO NOTHING) — never race-prone check-then-insert;
 *   - for THIS sprint only `family_delivery_available` is accepted (every other type fails closed at compile time
 *     via the input union and at runtime via the guard).
 */
import { createHash } from "node:crypto";
import type { TenantTx } from "../tenant-db";

// ── Bounded operational constants (retry / lease / batch) ────────────────────────────────────────
export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_BASE_RETRY_DELAY_MS = 60_000; // 1 min
export const OUTBOX_MAX_RETRY_DELAY_MS = 3_600_000; // 1 h (bounded ceiling; never unbounded)
export const OUTBOX_LEASE_DURATION_MS = 300_000; // 5 min processing lease
export const OUTBOX_DEFAULT_BATCH_SIZE = 50;
export const OUTBOX_MAX_BATCH_SIZE = 500;

/** Deterministic, bounded exponential backoff for retry #attempt (1-based). Capped at the max delay. */
export function outboxRetryDelayMs(attemptCount: number): number {
  const n = Math.max(1, Math.floor(attemptCount));
  const raw = OUTBOX_BASE_RETRY_DELAY_MS * 2 ** (n - 1);
  return Math.min(OUTBOX_MAX_RETRY_DELAY_MS, raw);
}

// ── Bounded code catalogues (NO raw exception / Prisma / SQL text is ever persisted) ─────────────
/** Terminal success classification stored in safeReasonCode. */
export const OUTBOX_SAFE_REASON = {
  delivered: "delivered",
  already_delivered: "already_delivered",
  no_recipients: "no_recipients",
  source_gone: "source_gone",
  not_applicable: "not_applicable",
} as const;
export type OutboxSafeReason = (typeof OUTBOX_SAFE_REASON)[keyof typeof OUTBOX_SAFE_REASON];

/** Bounded error codes stored in lastErrorCode (retry OR dead-letter). Never contains ids/PII/exception text. */
export const OUTBOX_ERROR_CODE = {
  processing_error: "processing_error", // transient (retryable) — DB/evaluator/service blip
  malformed_event: "malformed_event", // permanent — unparseable bounded source
  unsupported_type: "unsupported_type", // permanent — not wired this phase
  invalid_event_version: "invalid_event_version", // permanent — bad persisted marker
  contradictory_linkage: "contradictory_linkage", // permanent — ambiguous canonical linkage
  max_attempts_exceeded: "max_attempts_exceeded", // permanent — retries exhausted
} as const;
export type OutboxErrorCode = (typeof OUTBOX_ERROR_CODE)[keyof typeof OUTBOX_ERROR_CODE];

// ── Source typing (only the delivery-available source is enqueueable this phase) ─────────────────
/** The canonical source kind string persisted in `sourceType`. */
export const OUTBOX_SOURCE_TYPE = {
  safety_signal_delivery: "safety_signal_delivery",
} as const;

/** Enqueue input — ONLY family_delivery_available in Phase 3A (compile-time closed union). */
export type EnqueueableFamilyOutboxInput = {
  tenantId: string;
  notificationType: "family_delivery_available";
  source: { deliveryId: string };
  eventVersion: string;
  occurredAt: Date;
};

export interface EnqueueOutboxResult {
  enqueued: boolean;
  duplicate: boolean;
  outboxEventId?: string;
}

const EVENT_VERSION_RE = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Deterministic dedupe key: sha256 of the bounded identity tuple (tenant, type, sourceType, sourceId,
 * eventVersion). Pure — depends on NOTHING volatile (no recipients, no retry/worker clock, no attempt number,
 * no email/content). The SAME canonical transition (same persisted eventVersion) always yields the SAME key, so
 * the DB unique index collapses re-enqueues to one row; a genuinely new lifecycle version yields a new key.
 */
export function familyNotificationOutboxDedupeKey(input: {
  tenantId: string;
  notificationType: string;
  sourceType: string;
  sourceId: string;
  eventVersion: string;
}): string {
  const canonical = [
    input.tenantId,
    input.notificationType,
    input.sourceType,
    input.sourceId,
    input.eventVersion,
  ]
    .map((p) => String(p).replace(/\|/g, "\\|"))
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

// ── Test-only fault seam (never set by any production caller) ─────────────────────────────────────
let enqueueFaultForTests = false;
/** TEST ONLY. Forces the next enqueue to throw BEFORE inserting, so a test can prove the enclosing domain
 *  transaction rolls back. No production code path sets this. */
export function __setOutboxEnqueueFaultForTests(on: boolean): void {
  enqueueFaultForTests = on;
}

/**
 * Enqueue exactly one durable Family notification outbox event inside the caller's transaction `tx`.
 * Transaction-safe + idempotent: uses createMany({ skipDuplicates }) → INSERT … ON CONFLICT (tenantId,
 * dedupeKey) DO NOTHING. A duplicate (same canonical eventVersion) is a no-op that returns duplicate:true. The
 * row is created with the default lifecycle (status=pending, attemptCount=0) and is immediately eligible
 * (nextAttemptAt = occurredAt). The caller supplies NO recipients/content/status/lock state.
 */
export async function enqueueFamilyNotificationOutboxEventTx(
  tx: TenantTx,
  input: EnqueueableFamilyOutboxInput,
): Promise<EnqueueOutboxResult> {
  if (enqueueFaultForTests) throw new Error("__outbox_enqueue_fault_for_tests");
  // Fail closed: only the one wired type is enqueueable this phase.
  if (input.notificationType !== "family_delivery_available") throw new Error("outbox_unsupported_type");
  if (!EVENT_VERSION_RE.test(input.eventVersion)) throw new Error("outbox_invalid_event_version");
  const sourceType = OUTBOX_SOURCE_TYPE.safety_signal_delivery;
  const sourceId = input.source.deliveryId;
  if (!sourceId) throw new Error("outbox_invalid_source");

  const dedupeKey = familyNotificationOutboxDedupeKey({
    tenantId: input.tenantId,
    notificationType: input.notificationType,
    sourceType,
    sourceId,
    eventVersion: input.eventVersion,
  });

  const res = await tx.familyNotificationOutboxEvent.createMany({
    data: [
      {
        tenantId: input.tenantId,
        notificationType: input.notificationType,
        sourceType,
        sourceId,
        eventVersion: input.eventVersion,
        dedupeKey,
        occurredAt: input.occurredAt,
        nextAttemptAt: input.occurredAt, // immediately eligible
      },
    ],
    skipDuplicates: true,
  });
  const enqueued = res.count === 1;
  // The unique index is the final authority; look up the id (works for both the just-inserted and pre-existing
  // row) without leaking it outside the trusted server boundary.
  const row = await tx.familyNotificationOutboxEvent.findFirst({
    where: { tenantId: input.tenantId, dedupeKey },
    select: { id: true },
  });
  return { enqueued, duplicate: !enqueued, outboxEventId: row?.id };
}
