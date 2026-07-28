/**
 * FAMILY NOTIFICATIONS PHASE 3C — deterministic expiry EVALUATORS (owner/system, server-only).
 *
 * NOT exported from the @guardora/db barrel. Two pure-ish, deterministic scanners that find sources entering
 * their warning window and enqueue EXACTLY ONE bounded expiry event per (source, expiry version) — the outbox
 * unique index is the final dedupe authority, so re-scans and concurrent runs collapse to one event. They:
 *   - take an explicit `now` (deterministic tests);
 *   - scan cross-tenant as the OWNER (systemDb) with a bounded batch (default 100, hard max 500), ordered by
 *     (expiry, id) via the Phase 3C composite indexes, with optional keyset continuation;
 *   - enqueue through the owner outbox wrapper with an explicit tenantId per row;
 *   - NEVER read token/email/message (invitations) or notes/evidence/reason (consents) — narrow projections only;
 *   - NEVER mutate the source (no warningSentAt), NEVER create a notification row directly;
 *   - return AGGREGATE counts only.
 *
 * Eligibility boundary (UTC instants): expiry > now AND expiry <= now + warningWindow. Already-expired sources
 * never produce an "expiring" event.
 */
import { systemDb } from "../index";
import {
  enqueueFamilyNotificationOutboxEventOwnerTx,
  INVITATION_WARNING_WINDOW_MS, CONSENT_WARNING_WINDOW_MS,
  invitationExpiringEventVersion, consentExpiringEventVersion,
} from "./family-notification-outbox";
import type { TenantTx } from "../tenant-db";

const EXPIRY_DEFAULT_BATCH = 100;
const EXPIRY_MAX_BATCH = 500;
function boundExpiryBatch(n: number | undefined): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : EXPIRY_DEFAULT_BATCH;
  return Math.max(1, Math.min(EXPIRY_MAX_BATCH, v));
}

export interface ExpiryEvaluationResult {
  scanned: number;
  eligible: number;
  enqueued: number;
  duplicates: number;
  skipped: number;
}
export interface ExpiryEvaluatorOptions {
  now?: Date;
  batchSize?: number;
  cursor?: { afterExpiresAt: Date; afterId: string }; // keyset continuation (deterministic; never skips equal-expiry rows)
}

// The owner enqueue wrapper takes a transaction-client; systemDb (PrismaClient) is structurally compatible for the
// bounded operations it uses (createMany skip-duplicates + findFirst), and each enqueue is self-atomic. Resolved
// LAZILY (inside the functions) — never at module top-level, to avoid a circular-import TDZ on `systemDb`.
const ownerTx = (): TenantTx => systemDb as unknown as TenantTx;

/**
 * INVITATIONS entering the final 24h before `expiresAt`. Eligible = still `pending`, expiresAt in (now, cutoff].
 * One warning per (invitation, expiresAt) — an extended expiry yields a new eventVersion (a new warning later).
 */
export async function evaluateExpiringGuardianInvitations(opts: ExpiryEvaluatorOptions = {}): Promise<ExpiryEvaluationResult> {
  const now = opts.now ?? new Date();
  const batchSize = boundExpiryBatch(opts.batchSize);
  const cutoff = new Date(now.getTime() + INVITATION_WARNING_WINDOW_MS);
  const res: ExpiryEvaluationResult = { scanned: 0, eligible: 0, enqueued: 0, duplicates: 0, skipped: 0 };

  // NARROW projection — only the fields required to prove eligibility. NEVER token/tokenHash/email/message.
  const rows = await systemDb.familyGuardianInvitation.findMany({
    where: {
      status: "pending",
      expiresAt: { gt: now, lte: cutoff },
      ...(opts.cursor ? { OR: [{ expiresAt: { gt: opts.cursor.afterExpiresAt } }, { expiresAt: opts.cursor.afterExpiresAt, id: { gt: opts.cursor.afterId } }] } : {}),
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { id: true, tenantId: true, expiresAt: true },
  });

  for (const inv of rows) {
    res.scanned += 1;
    if (!inv.tenantId || !inv.expiresAt) { res.skipped += 1; continue; } // defensive; the WHERE already guarantees these
    res.eligible += 1;
    const enq = await enqueueFamilyNotificationOutboxEventOwnerTx(ownerTx(), {
      tenantId: inv.tenantId,
      notificationType: "family_guardian_invitation_expiring",
      source: { invitationId: inv.id },
      eventVersion: invitationExpiringEventVersion(inv.expiresAt.getTime()),
      occurredAt: now,
    });
    enq.enqueued ? (res.enqueued += 1) : (res.duplicates += 1);
  }
  return res;
}

/**
 * CONSENTS entering the final 14 days before `validUntil`. Eligible = effective (active, not revoked, not
 * archived, has an expiry), validUntil in (now, cutoff]. One warning per (consent, validUntil); a renewed consent
 * is a NEW record → a new sourceId + event.
 */
export async function evaluateExpiringConsents(opts: ExpiryEvaluatorOptions = {}): Promise<ExpiryEvaluationResult> {
  const now = opts.now ?? new Date();
  const batchSize = boundExpiryBatch(opts.batchSize);
  const cutoff = new Date(now.getTime() + CONSENT_WARNING_WINDOW_MS);
  const res: ExpiryEvaluationResult = { scanned: 0, eligible: 0, enqueued: 0, duplicates: 0, skipped: 0 };

  // NARROW projection — only eligibility fields. NEVER notes/evidence/reason/guardian-email/scope details.
  const rows = await systemDb.consentRecord.findMany({
    where: {
      consentStatus: "active",
      revokedAt: null,
      archivedAt: null,
      validUntil: { gt: now, lte: cutoff },
      ...(opts.cursor ? { OR: [{ validUntil: { gt: opts.cursor.afterExpiresAt } }, { validUntil: opts.cursor.afterExpiresAt, id: { gt: opts.cursor.afterId } }] } : {}),
    },
    orderBy: [{ validUntil: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { id: true, tenantId: true, validUntil: true },
  });

  for (const c of rows) {
    res.scanned += 1;
    if (!c.tenantId || !c.validUntil) { res.skipped += 1; continue; }
    res.eligible += 1;
    const enq = await enqueueFamilyNotificationOutboxEventOwnerTx(ownerTx(), {
      tenantId: c.tenantId,
      notificationType: "family_consent_expiring",
      source: { consentRecordId: c.id },
      eventVersion: consentExpiringEventVersion(c.validUntil.getTime()),
      occurredAt: now,
    });
    enq.enqueued ? (res.enqueued += 1) : (res.duplicates += 1);
  }
  return res;
}

/** Aggregate warning-window counts (owner; no ids/tenants) for operational health. */
export async function countExpiryWarningWindows(now: Date = new Date()): Promise<{ invitationsInWindow: number; consentsInWindow: number }> {
  const [invitationsInWindow, consentsInWindow] = await Promise.all([
    systemDb.familyGuardianInvitation.count({ where: { status: "pending", expiresAt: { gt: now, lte: new Date(now.getTime() + INVITATION_WARNING_WINDOW_MS) } } }),
    systemDb.consentRecord.count({ where: { consentStatus: "active", revokedAt: null, archivedAt: null, validUntil: { gt: now, lte: new Date(now.getTime() + CONSENT_WARNING_WINDOW_MS) } } }),
  ]);
  return { invitationsInWindow, consentsInWindow };
}
