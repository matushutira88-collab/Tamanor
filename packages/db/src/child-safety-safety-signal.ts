import { ActorKind, Prisma } from "@prisma/client";
import { withTenant } from "./repositories";
import { FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError } from "./child-safety-family";
import {
  FamilyAction, authorizeFamilyAction, CHILD_SAFETY_AUDIT_EVENTS, validateChildSafetyInput,
  SafetySignalReviewStatus, SAFETY_SIGNAL_DEFAULT_REVIEW_STATUS, SAFETY_SIGNAL_DEFAULT_CONFIDENCE_BAND,
  SAFETY_SIGNAL_CREATE_FIELDS, SAFETY_SIGNAL_DECIDE_FIELDS, clampSafetySignalLimit,
  isSafetySignalType, isSafetySeverity, isSafetyConfidenceBand, isSafetySignalSourceType,
  isSafetySignalResolutionCode, isValidSourceReference, isValidOccurrenceBucket,
  type FamilyActorContext,
} from "@guardora/core";

/**
 * CS-C3 — Safety Signal service (backend, server-only). A SafetySignal records occurrence +
 * classification metadata + review state ONLY. Every op is FAMILY-gated + FamilyRole-authorized ABOVE
 * tenant RLS, tenant-scoped via withTenant/RLS (cross-tenant ids invisible → rejected; profile
 * composite FK backstop), fail-closed, content-free audited.
 *
 * DELIBERATELY DOES NOT (recipient/delivery separation, CS-C3 rule G): look up safe recipients, call
 * canReceiveSafetyInformation, create a notification/alert/incident/case, escalate, or touch any
 * consent / authority / safe-recipient / guardian-relationship record. It only reads/writes
 * `safety_signals` + the audit log. No import from the CS-C2 authorization service is present.
 */

type Tx = Prisma.TransactionClient;

function assertFamily(actor: FamilyActorContext, action: FamilyAction): void {
  const d = authorizeFamilyAction(actor, action);
  if (!d.ok) throw new FamilyForbiddenError(d.reason);
}
// Content-free audit — ids + enum values + timestamps only. NEVER label/name/note/document/raw.
async function audit(db: Tx, actor: FamilyActorContext, event: string, targetId: string, metadata?: Record<string, string | number | boolean>): Promise<void> {
  await db.auditLog.create({ data: { tenantId: actor.tenantId, event, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: "safety_signal", targetId, metadata: (metadata ?? undefined) as never } });
}
/** The actor's own membership id in this tenant (RLS-scoped). Fail-closed if not a member. */
async function actorMembershipId(db: Tx, actor: FamilyActorContext): Promise<string> {
  const m = await db.membership.findFirst({ where: { userId: actor.userId, tenantId: actor.tenantId }, select: { id: true } });
  if (!m) throw new FamilyForbiddenError("role_forbidden");
  return m.id;
}

// --- view model (content-free by construction) ------------------------------

export interface SafetySignalVM {
  id: string; protectedProfileId: string; signalType: string; severity: string; confidenceBand: string;
  sourceType: string; sourceReference: string | null; occurrenceBucket: string | null; reviewStatus: string;
  detectedAt: Date | null; receivedAt: Date; reviewedAt: Date | null; reviewedByMembershipId: string | null;
  resolutionCode: string | null; createdAt: Date; updatedAt: Date; archivedAt: Date | null;
}
const SIGNAL_SELECT = { id: true, protectedProfileId: true, signalType: true, severity: true, confidenceBand: true, sourceType: true, sourceReference: true, occurrenceBucket: true, reviewStatus: true, detectedAt: true, receivedAt: true, reviewedAt: true, reviewedByMembershipId: true, resolutionCode: true, createdAt: true, updatedAt: true, archivedAt: true } as const;

// --- create -----------------------------------------------------------------

export async function createSafetySignal(actor: FamilyActorContext, input: { protectedProfileId: string; signalType: string; severity: string; confidenceBand?: string; sourceType: string; sourceReference?: string | null; occurrenceBucket?: string | null; detectedAt?: Date }): Promise<SafetySignalVM> {
  assertFamily(actor, FamilyAction.SafetySignalCreate);
  const v = validateChildSafetyInput(input, SAFETY_SIGNAL_CREATE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$"); // rejects any raw/notes/arbitrary field
  if (!isSafetySignalType(input.signalType)) throw new FamilyValidationError("signalType");
  if (!isSafetySeverity(input.severity)) throw new FamilyValidationError("severity");
  const confidenceBand = input.confidenceBand ?? SAFETY_SIGNAL_DEFAULT_CONFIDENCE_BAND;
  if (!isSafetyConfidenceBand(confidenceBand)) throw new FamilyValidationError("confidenceBand");
  if (!isSafetySignalSourceType(input.sourceType)) throw new FamilyValidationError("sourceType");
  if (!isValidSourceReference(input.sourceReference)) throw new FamilyValidationError("sourceReference");
  if (!isValidOccurrenceBucket(input.occurrenceBucket)) throw new FamilyValidationError("occurrenceBucket");
  return withTenant(actor.tenantId, async (db) => {
    const profile = await db.protectedProfile.findFirst({ where: { id: input.protectedProfileId, tenantId: actor.tenantId }, select: { id: true, archivedAt: true } });
    if (!profile || profile.archivedAt) throw new FamilyNotFoundError("protected_profile");
    const row = await db.safetySignal.create({
      data: {
        tenantId: actor.tenantId, protectedProfileId: input.protectedProfileId,
        signalType: input.signalType, severity: input.severity, confidenceBand, sourceType: input.sourceType,
        sourceReference: input.sourceReference ?? null, occurrenceBucket: input.occurrenceBucket ?? null,
        reviewStatus: SAFETY_SIGNAL_DEFAULT_REVIEW_STATUS, detectedAt: input.detectedAt ?? null,
      },
      select: SIGNAL_SELECT,
    });
    // Occurrence + review-state ONLY: no recipient lookup, no notification, no incident, no escalation.
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.safetySignalCreated, row.id, { signalType: row.signalType, severity: row.severity, confidenceBand: row.confidenceBand, sourceType: row.sourceType });
    return row;
  });
}

// --- read / list ------------------------------------------------------------

export async function getSafetySignal(actor: FamilyActorContext, id: string): Promise<SafetySignalVM> {
  assertFamily(actor, FamilyAction.SafetySignalView);
  const row = await withTenant(actor.tenantId, (db) => db.safetySignal.findFirst({ where: { id, tenantId: actor.tenantId }, select: SIGNAL_SELECT }));
  if (!row) throw new FamilyNotFoundError("safety_signal");
  return row;
}

export interface SafetySignalListOpts { protectedProfileId?: string; signalType?: string; severity?: string; reviewStatus?: string; includeArchived?: boolean; limit?: number; offset?: number }
export interface SafetySignalPage { items: SafetySignalVM[]; limit: number; offset: number }

/** Tenant-scoped, filtered, BOUNDED, stably ordered list (receivedAt desc, id desc). No raw payloads. */
export function listSafetySignals(actor: FamilyActorContext, opts: SafetySignalListOpts = {}): Promise<SafetySignalPage> {
  assertFamily(actor, FamilyAction.SafetySignalView);
  const limit = clampSafetySignalLimit(opts.limit);
  const offset = typeof opts.offset === "number" && opts.offset > 0 ? Math.floor(opts.offset) : 0;
  const where: Prisma.SafetySignalWhereInput = {
    tenantId: actor.tenantId,
    ...(opts.protectedProfileId ? { protectedProfileId: opts.protectedProfileId } : {}),
    ...(opts.signalType ? { signalType: opts.signalType } : {}),
    ...(opts.severity ? { severity: opts.severity } : {}),
    ...(opts.reviewStatus ? { reviewStatus: opts.reviewStatus } : {}),
    ...(opts.includeArchived ? {} : { archivedAt: null }),
  };
  return withTenant(actor.tenantId, async (db) => {
    const items = await db.safetySignal.findMany({ where, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: limit, skip: offset, select: SIGNAL_SELECT });
    return { items, limit, offset };
  });
}

// --- review lifecycle (explicit; nothing auto-advances or notifies) ---------

async function reviewTransition(actor: FamilyActorContext, id: string, next: SafetySignalReviewStatus, event: string, data: Prisma.SafetySignalUpdateInput, extraAudit?: Record<string, string | number | boolean>): Promise<SafetySignalVM> {
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.safetySignal.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, archivedAt: true } });
    if (!existing) throw new FamilyNotFoundError("safety_signal");
    if (existing.archivedAt) throw new FamilyValidationError("archived"); // an archived signal is terminal
    const reviewedByMembershipId = await actorMembershipId(db, actor);
    const row = await db.safetySignal.update({ where: { id }, data: { reviewStatus: next, reviewedAt: new Date(), reviewedByMembershipId, ...data }, select: SIGNAL_SELECT });
    await audit(db, actor, event, row.id, { reviewStatus: row.reviewStatus, ...(extraAudit ?? {}) });
    return row;
  });
}

export function acknowledgeSafetySignal(actor: FamilyActorContext, id: string): Promise<SafetySignalVM> {
  assertFamily(actor, FamilyAction.SafetySignalReview);
  return reviewTransition(actor, id, SafetySignalReviewStatus.Acknowledged, CHILD_SAFETY_AUDIT_EVENTS.safetySignalAcknowledged, {});
}

export function startSafetySignalReview(actor: FamilyActorContext, id: string): Promise<SafetySignalVM> {
  assertFamily(actor, FamilyAction.SafetySignalReview);
  return reviewTransition(actor, id, SafetySignalReviewStatus.UnderReview, CHILD_SAFETY_AUDIT_EVENTS.safetySignalReviewStarted, {});
}

export function dismissSafetySignal(actor: FamilyActorContext, id: string, input: { resolutionCode?: string } = {}): Promise<SafetySignalVM> {
  assertFamily(actor, FamilyAction.SafetySignalReview);
  const v = validateChildSafetyInput(input, SAFETY_SIGNAL_DECIDE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (input.resolutionCode != null && !isSafetySignalResolutionCode(input.resolutionCode)) throw new FamilyValidationError("resolutionCode");
  return reviewTransition(actor, id, SafetySignalReviewStatus.Dismissed, CHILD_SAFETY_AUDIT_EVENTS.safetySignalDismissed, { resolutionCode: input.resolutionCode ?? null } as Prisma.SafetySignalUpdateInput, input.resolutionCode ? { resolutionCode: input.resolutionCode } : undefined);
}

/** Confirm the signal represents a real risk. NEVER auto-notifies, escalates, or creates an incident. */
export function confirmSafetySignalRisk(actor: FamilyActorContext, id: string, input: { resolutionCode?: string } = {}): Promise<SafetySignalVM> {
  assertFamily(actor, FamilyAction.SafetySignalReview);
  const v = validateChildSafetyInput(input, SAFETY_SIGNAL_DECIDE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (input.resolutionCode != null && !isSafetySignalResolutionCode(input.resolutionCode)) throw new FamilyValidationError("resolutionCode");
  return reviewTransition(actor, id, SafetySignalReviewStatus.ConfirmedRisk, CHILD_SAFETY_AUDIT_EVENTS.safetySignalConfirmed, { resolutionCode: input.resolutionCode ?? null } as Prisma.SafetySignalUpdateInput, input.resolutionCode ? { resolutionCode: input.resolutionCode } : undefined);
}

/** Soft archive (never DELETE). Idempotent. Keeps reviewedAt/By/resolutionCode + full history. */
export async function archiveSafetySignal(actor: FamilyActorContext, id: string): Promise<SafetySignalVM> {
  assertFamily(actor, FamilyAction.SafetySignalArchive);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.safetySignal.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, archivedAt: true } });
    if (!existing) throw new FamilyNotFoundError("safety_signal");
    if (existing.archivedAt) return db.safetySignal.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: SIGNAL_SELECT });
    const row = await db.safetySignal.update({ where: { id }, data: { reviewStatus: SafetySignalReviewStatus.Archived, archivedAt: new Date() }, select: SIGNAL_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.safetySignalArchived, row.id, { reviewStatus: row.reviewStatus });
    return row;
  });
}
