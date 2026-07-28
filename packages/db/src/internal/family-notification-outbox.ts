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
  family_guardian_invitation: "family_guardian_invitation",
  guardian_authority_record: "guardian_authority_record",
  recipient_authorization_decision: "recipient_authorization_decision",
} as const;

/**
 * The SINGLE source of truth for which Family notification types are enqueueable and their canonical sourceType +
 * the id field carrying the sourceId. Phase 3B1 supports exactly SIX types; the other seven have no entry and so
 * fail closed at enqueue AND fail as a malformed combination in the processor. Both the enqueue service and the
 * processor route through this map so they can never drift.
 */
export const OUTBOX_TYPE_SOURCE = {
  family_delivery_available: { sourceType: OUTBOX_SOURCE_TYPE.safety_signal_delivery, idKey: "deliveryId" },
  family_delivery_acknowledged: { sourceType: OUTBOX_SOURCE_TYPE.safety_signal_delivery, idKey: "deliveryId" },
  family_delivery_declined: { sourceType: OUTBOX_SOURCE_TYPE.safety_signal_delivery, idKey: "deliveryId" },
  family_guardian_invitation_accepted: { sourceType: OUTBOX_SOURCE_TYPE.family_guardian_invitation, idKey: "invitationId" },
  family_authority_changed: { sourceType: OUTBOX_SOURCE_TYPE.guardian_authority_record, idKey: "guardianAuthorityRecordId" },
  family_recipient_authorization_changed: { sourceType: OUTBOX_SOURCE_TYPE.recipient_authorization_decision, idKey: "authorizationDecisionId" },
} as const;
export type EnqueueableOutboxType = keyof typeof OUTBOX_TYPE_SOURCE;
export const SUPPORTED_OUTBOX_TYPES: readonly string[] = Object.keys(OUTBOX_TYPE_SOURCE);

/** Enqueue input — the SIX supported types (compile-time closed union; the caller supplies only bounded ids). */
export type EnqueueableFamilyOutboxInput =
  | { tenantId: string; notificationType: "family_delivery_available" | "family_delivery_acknowledged" | "family_delivery_declined"; source: { deliveryId: string }; eventVersion: string; occurredAt: Date }
  | { tenantId: string; notificationType: "family_guardian_invitation_accepted"; source: { invitationId: string }; eventVersion: string; occurredAt: Date }
  | { tenantId: string; notificationType: "family_authority_changed"; source: { guardianAuthorityRecordId: string }; eventVersion: string; occurredAt: Date }
  | { tenantId: string; notificationType: "family_recipient_authorization_changed"; source: { authorizationDecisionId: string }; eventVersion: string; occurredAt: Date };

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
  // Fail closed: only the SIX mapped types are enqueueable; the derivation of sourceType/sourceId is internal —
  // the caller never supplies an arbitrary sourceType.
  const mapping = (OUTBOX_TYPE_SOURCE as Record<string, { sourceType: string; idKey: string } | undefined>)[input.notificationType];
  if (!mapping) throw new Error("outbox_unsupported_type");
  if (!EVENT_VERSION_RE.test(input.eventVersion)) throw new Error("outbox_invalid_event_version");
  const sourceType = mapping.sourceType;
  const sourceId = (input.source as Record<string, string | undefined>)[mapping.idKey];
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

// ── Authority materiality (explicit bounded-field comparison; never a bare updatedAt inequality) ─────
/** EFFECTIVE authority = status "verified" only (pending/rejected/suspended/revoked/expired are NOT effective). */
const AUTHORITY_EFFECTIVE_STATUS = "verified";
const isAuthorityEffective = (status: string | null | undefined): boolean => status === AUTHORITY_EFFECTIVE_STATUS;

export interface AuthoritySnapshot { authorityStatus: string; authorityLevel: string | null }
export interface AuthorityAfter extends AuthoritySnapshot { updatedAt: Date }

/**
 * True when the transition materially changes the guardian's EFFECTIVE authority: effectiveness flipped
 * (became/ceased effective), OR the granted scope (authorityLevel) changed WHILE effective. A pure technical
 * update (no effectiveness or in-effect scope change) is NOT material. `before === null` = a fresh record
 * (e.g. grant creating a verified authority).
 */
export function isMaterialAuthorityChange(before: AuthoritySnapshot | null, after: AuthoritySnapshot): boolean {
  const effBefore = before ? isAuthorityEffective(before.authorityStatus) : false;
  const effAfter = isAuthorityEffective(after.authorityStatus);
  if (effBefore !== effAfter) return true; // became or ceased effective
  if (effAfter && before && before.authorityLevel !== after.authorityLevel) return true; // in-effect scope change
  return false;
}

/**
 * Enqueue `family_authority_changed` IFF the transition is material (explicit effective-authority comparison).
 * eventVersion is the persisted, post-transition `updatedAt` — written exactly once by this canonical transition
 * (non-material/idempotent transitions never reach here, so it is stable per material event; the outbox unique
 * index remains the final dedupe authority). Returns whether it was deemed material (+ enqueue result).
 */
export async function enqueueAuthorityChangedIfMaterialTx(
  tx: TenantTx,
  args: { tenantId: string; guardianAuthorityRecordId: string; before: AuthoritySnapshot | null; after: AuthorityAfter; occurredAt?: Date },
): Promise<{ material: boolean; enqueued: boolean; duplicate: boolean }> {
  if (!isMaterialAuthorityChange(args.before, args.after)) return { material: false, enqueued: false, duplicate: false };
  const res = await enqueueFamilyNotificationOutboxEventTx(tx, {
    tenantId: args.tenantId,
    notificationType: "family_authority_changed",
    source: { guardianAuthorityRecordId: args.guardianAuthorityRecordId },
    eventVersion: String(args.after.updatedAt.getTime()),
    occurredAt: args.occurredAt ?? args.after.updatedAt,
  });
  return { material: true, enqueued: res.enqueued, duplicate: res.duplicate };
}
