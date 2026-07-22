import { ActorKind, Prisma } from "@prisma/client";
import { withTenant } from "./repositories";
import { FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError } from "./child-safety-family";
import { getEffectiveRecipientAuthorization } from "./child-safety-recipient-authorization";
import {
  FamilyAction, authorizeFamilyAction, familyRoleForMembershipRole, FamilyRole, CHILD_SAFETY_AUDIT_EVENTS,
  validateChildSafetyInput,
  SafetyDeliveryStatus, SafetyDeliveryChannel, SafetyDeliveryReasonCode,
  SAFETY_DELIVERY_DEFAULT_CHANNEL, SAFETY_DELIVERY_DEFAULT_STATUS,
  isSafetyDeliveryChannel, isSafetyRecommendedActionClass, isValidDeliveryIdempotencyKey,
  isValidSafetyDeliveryTransition, isSafetyDeliveryRowEffective, isSafetyDisclosureScope,
  clampSafetyDeliveryLimit, SAFETY_DELIVERY_EVALUATE_FIELDS, SAFETY_DELIVERY_CREATE_FIELDS,
  serializeDisclosureScopes, parseDisclosureScopes, scopesWithin, SafetyDisclosureScope,
  type FamilyActorContext,
} from "@guardora/core";

/**
 * CS-C5 — Internal Delivery service (backend, server-only). Records that an already-authorized minimal
 * disclosure is PREPARED for an authorized recipient — point 7 ONLY. A delivery may exist ONLY for a
 * currently-EFFECTIVE CS-C4 recipient authorization decision (re-checked via getEffectiveRecipient-
 * Authorization); CS-C5 never re-derives the authorization chain.
 *
 * NO DELIVERY (rule P): never writes to notifications/cyberbullying_notifications, never creates an
 * incident/case/queue job/cron, never sends email/SMS/push/webhook, never calls a platform API, never
 * shows raw content, never mutates any CS-1..C4 record. Only `safety_signal_deliveries` + audit log.
 */

type Tx = Prisma.TransactionClient;

export class DeliveryNotEligibleError extends Error {
  readonly code = "NOT_ELIGIBLE";
  constructor(public readonly reasonCode: SafetyDeliveryReasonCode) { super(`delivery not eligible: ${reasonCode}`); this.name = "DeliveryNotEligibleError"; }
}

function assertFamily(actor: FamilyActorContext, action: FamilyAction): void {
  const d = authorizeFamilyAction(actor, action);
  if (!d.ok) throw new FamilyForbiddenError(d.reason);
}
async function audit(db: Tx, actor: FamilyActorContext, event: string, targetId: string, metadata?: Record<string, string | number | boolean>): Promise<void> {
  await db.auditLog.create({ data: { tenantId: actor.tenantId, event, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: "safety_signal_delivery", targetId, metadata: (metadata ?? undefined) as never } });
}
async function actorMembershipId(actor: FamilyActorContext): Promise<string | null> {
  return withTenant(actor.tenantId, (db) => db.membership.findFirst({ where: { userId: actor.userId, tenantId: actor.tenantId }, select: { id: true } }).then((m) => m?.id ?? null));
}

// --- view model (content-free) ----------------------------------------------

export interface SafetySignalDeliveryVM {
  id: string; safetySignalId: string; protectedProfileId: string; recipientAuthorizationDecisionId: string; recipientMembershipId: string;
  deliveryStatus: string; deliveryChannel: string; disclosureScope: string; signalType: string; severity: string;
  occurrenceBucket: string | null; recommendedActionClass: string | null; idempotencyKey: string;
  preparedAt: Date; availableAt: Date | null; acknowledgedAt: Date | null; acknowledgedByMembershipId: string | null;
  declinedAt: Date | null; declinedByMembershipId: string | null; failedAt: Date | null; failureReasonCode: string | null;
  revokedAt: Date | null; expiredAt: Date | null; supersededAt: Date | null; createdAt: Date; updatedAt: Date; archivedAt: Date | null;
}
const DELIVERY_SELECT = { id: true, safetySignalId: true, protectedProfileId: true, recipientAuthorizationDecisionId: true, recipientMembershipId: true, deliveryStatus: true, deliveryChannel: true, disclosureScope: true, signalType: true, severity: true, occurrenceBucket: true, recommendedActionClass: true, idempotencyKey: true, preparedAt: true, availableAt: true, acknowledgedAt: true, acknowledgedByMembershipId: true, declinedAt: true, declinedByMembershipId: true, failedAt: true, failureReasonCode: true, revokedAt: true, expiredAt: true, supersededAt: true, createdAt: true, updatedAt: true, archivedAt: true } as const;

// --- eligibility evaluation (read-only; reuses CS-C4 effective authorization) --

export interface DeliveryEligibility {
  eligible: boolean;
  reasonCode: SafetyDeliveryReasonCode;
  effectiveAuthorizationDecisionId: string | null;
  recipientMembershipId: string;
  allowedDisclosureScopes: SafetyDisclosureScope[];
  requestedDisclosureScopes: SafetyDisclosureScope[];
  evaluatedAt: Date;
  validUntil: Date | null;
}
export interface DeliveryInput { recipientAuthorizationDecisionId: string; requestedScopes?: string[]; idempotencyKey?: string; recommendedActionClass?: string; deliveryChannel?: string }

/** Read-only, deterministic delivery eligibility. Fail-closed. Reuses getEffectiveRecipientAuthorization. */
export async function evaluateSafetySignalDeliveryEligibility(actor: FamilyActorContext, input: DeliveryInput, now: Date = new Date()): Promise<DeliveryEligibility> {
  assertFamily(actor, FamilyAction.SafetyDeliveryCreate);
  const v = validateChildSafetyInput(input, SAFETY_DELIVERY_EVALUATE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (input.requestedScopes !== undefined && (!Array.isArray(input.requestedScopes) || !input.requestedScopes.every(isSafetyDisclosureScope))) throw new FamilyValidationError("requestedScopes");
  const requested = (input.requestedScopes ?? []) as SafetyDisclosureScope[];
  const base = (rc: SafetyDeliveryReasonCode, recipient = "", allowed: SafetyDisclosureScope[] = [], decisionId: string | null = null, validUntil: Date | null = null): DeliveryEligibility =>
    ({ eligible: rc === SafetyDeliveryReasonCode.ValidEffectiveAuthorization, reasonCode: rc, effectiveAuthorizationDecisionId: decisionId, recipientMembershipId: recipient, allowedDisclosureScopes: allowed, requestedDisclosureScopes: requested, evaluatedAt: now, validUntil });

  const decision = await withTenant(actor.tenantId, (db) => db.safetyRecipientAuthorizationDecision.findFirst({ where: { id: input.recipientAuthorizationDecisionId, tenantId: actor.tenantId }, select: { id: true, safetySignalId: true, protectedProfileId: true, recipientMembershipId: true, decisionStatus: true, disclosureScope: true, revokedAt: true, supersededAt: true, archivedAt: true } }));
  if (!decision) return base(SafetyDeliveryReasonCode.AuthorizationNotFound);
  if (decision.revokedAt) return base(SafetyDeliveryReasonCode.AuthorizationRevoked, decision.recipientMembershipId);
  if (decision.supersededAt) return base(SafetyDeliveryReasonCode.AuthorizationSuperseded, decision.recipientMembershipId);
  if (decision.archivedAt) return base(SafetyDeliveryReasonCode.AuthorizationArchived, decision.recipientMembershipId);
  if (decision.decisionStatus !== "authorized") return base(SafetyDeliveryReasonCode.AuthorizationNotEffective, decision.recipientMembershipId);

  // Re-check the LIVE CS-C4 effective authorization (this re-checks signal-archived + membership + CS-2 chain).
  const effective = await getEffectiveRecipientAuthorization(actor, decision.safetySignalId, decision.recipientMembershipId, now);
  if (!effective) return base(SafetyDeliveryReasonCode.AuthorizationNotEffective, decision.recipientMembershipId);
  if (effective.id !== decision.id) return base(SafetyDeliveryReasonCode.AuthorizationSuperseded, decision.recipientMembershipId);

  const allowed = parseDisclosureScopes(effective.disclosureScope).scopes;
  if (requested.length > 0 && !scopesWithin(requested, allowed)) return base(SafetyDeliveryReasonCode.ScopeNotAuthorized, decision.recipientMembershipId, [], decision.id);
  const grantedScopes = requested.length > 0 ? requested : allowed;
  return base(SafetyDeliveryReasonCode.ValidEffectiveAuthorization, decision.recipientMembershipId, grantedScopes, decision.id, effective.validUntil);
}

// --- create (prepared) ------------------------------------------------------

export async function createSafetySignalDelivery(actor: FamilyActorContext, input: DeliveryInput, now: Date = new Date()): Promise<SafetySignalDeliveryVM> {
  assertFamily(actor, FamilyAction.SafetyDeliveryCreate);
  const cv = validateChildSafetyInput(input, SAFETY_DELIVERY_CREATE_FIELDS);
  if (!cv.ok) throw new FamilyValidationError(cv.errors[0]?.field ?? "$");
  if (!isValidDeliveryIdempotencyKey(input.idempotencyKey)) throw new FamilyValidationError("idempotencyKey");
  const channel = input.deliveryChannel ?? SAFETY_DELIVERY_DEFAULT_CHANNEL;
  if (!isSafetyDeliveryChannel(channel) || channel !== SafetyDeliveryChannel.InternalInbox) throw new FamilyValidationError("deliveryChannel");
  if (input.recommendedActionClass != null && !isSafetyRecommendedActionClass(input.recommendedActionClass)) throw new FamilyValidationError("recommendedActionClass");
  const idempotencyKey = input.idempotencyKey as string;

  const decision = await withTenant(actor.tenantId, (db) => db.safetyRecipientAuthorizationDecision.findFirst({ where: { id: input.recipientAuthorizationDecisionId, tenantId: actor.tenantId }, select: { id: true, safetySignalId: true, protectedProfileId: true, recipientMembershipId: true } }));
  if (!decision) throw new DeliveryNotEligibleError(SafetyDeliveryReasonCode.AuthorizationNotFound);

  // Self-delivery: an actor may only prepare a delivery naming THEMSELVES as recipient if PrimaryGuardian.
  const actorMid = await actorMembershipId(actor);
  if (actorMid === null) throw new FamilyForbiddenError("role_forbidden");
  if (actorMid === decision.recipientMembershipId && familyRoleForMembershipRole(actor.role) !== FamilyRole.PrimaryGuardian) throw new FamilyForbiddenError("role_forbidden");

  const eligibility = await evaluateSafetySignalDeliveryEligibility(actor, { recipientAuthorizationDecisionId: input.recipientAuthorizationDecisionId, requestedScopes: input.requestedScopes }, now);
  if (!eligibility.eligible) throw new DeliveryNotEligibleError(eligibility.reasonCode);
  if (input.recommendedActionClass != null && !eligibility.allowedDisclosureScopes.includes(SafetyDisclosureScope.RecommendedActionClass)) throw new DeliveryNotEligibleError(SafetyDeliveryReasonCode.ScopeNotAuthorized);

  return withTenant(actor.tenantId, async (db) => {
    // Idempotency: same (tenant, decision, recipient, key) never creates a second row.
    const existing = await db.safetySignalDelivery.findFirst({ where: { tenantId: actor.tenantId, recipientAuthorizationDecisionId: decision.id, recipientMembershipId: decision.recipientMembershipId, idempotencyKey }, select: DELIVERY_SELECT });
    if (existing) return existing;
    const signal = await db.safetySignal.findFirst({ where: { id: decision.safetySignalId, tenantId: actor.tenantId }, select: { signalType: true, severity: true, occurrenceBucket: true } });
    if (!signal) throw new DeliveryNotEligibleError(SafetyDeliveryReasonCode.SignalArchived);
    const row = await db.safetySignalDelivery.create({
      data: {
        tenantId: actor.tenantId, safetySignalId: decision.safetySignalId, protectedProfileId: decision.protectedProfileId,
        recipientAuthorizationDecisionId: decision.id, recipientMembershipId: decision.recipientMembershipId,
        deliveryStatus: SAFETY_DELIVERY_DEFAULT_STATUS, deliveryChannel: channel,
        disclosureScope: serializeDisclosureScopes(eligibility.allowedDisclosureScopes),
        signalType: signal.signalType, severity: signal.severity, occurrenceBucket: signal.occurrenceBucket,
        recommendedActionClass: input.recommendedActionClass ?? null, idempotencyKey,
      },
      select: DELIVERY_SELECT,
    });
    const meta = { deliveryStatus: row.deliveryStatus, deliveryChannel: row.deliveryChannel, reasonCode: eligibility.reasonCode, safetySignalId: row.safetySignalId, recipientAuthorizationDecisionId: row.recipientAuthorizationDecisionId, recipientMembershipId: row.recipientMembershipId };
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.deliveryEvaluated, row.id, meta);
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.deliveryCreated, row.id, meta);
    return row;
  });
}

// --- read / list ------------------------------------------------------------

export async function getSafetySignalDelivery(actor: FamilyActorContext, id: string): Promise<SafetySignalDeliveryVM> {
  assertFamily(actor, FamilyAction.SafetyDeliveryView);
  const row = await withTenant(actor.tenantId, (db) => db.safetySignalDelivery.findFirst({ where: { id, tenantId: actor.tenantId }, select: DELIVERY_SELECT }));
  if (!row) throw new FamilyNotFoundError("safety_signal");
  return row;
}

export interface DeliveryListOpts { safetySignalId?: string; protectedProfileId?: string; recipientAuthorizationDecisionId?: string; recipientMembershipId?: string; deliveryStatus?: string; includeArchived?: boolean; limit?: number; offset?: number }
export interface DeliveryPage { items: SafetySignalDeliveryVM[]; limit: number; offset: number }

export function listSafetySignalDeliveries(actor: FamilyActorContext, opts: DeliveryListOpts = {}): Promise<DeliveryPage> {
  assertFamily(actor, FamilyAction.SafetyDeliveryView);
  const limit = clampSafetyDeliveryLimit(opts.limit);
  const offset = typeof opts.offset === "number" && opts.offset > 0 ? Math.floor(opts.offset) : 0;
  const where: Prisma.SafetySignalDeliveryWhereInput = {
    tenantId: actor.tenantId,
    ...(opts.safetySignalId ? { safetySignalId: opts.safetySignalId } : {}),
    ...(opts.protectedProfileId ? { protectedProfileId: opts.protectedProfileId } : {}),
    ...(opts.recipientAuthorizationDecisionId ? { recipientAuthorizationDecisionId: opts.recipientAuthorizationDecisionId } : {}),
    ...(opts.recipientMembershipId ? { recipientMembershipId: opts.recipientMembershipId } : {}),
    ...(opts.deliveryStatus ? { deliveryStatus: opts.deliveryStatus } : {}),
    ...(opts.includeArchived ? {} : { archivedAt: null }),
  };
  return withTenant(actor.tenantId, async (db) => {
    const items = await db.safetySignalDelivery.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset, select: DELIVERY_SELECT });
    return { items, limit, offset };
  });
}

// --- transitions (explicit; validated; no side effects) ---------------------

async function transition(actor: FamilyActorContext, id: string, action: FamilyAction, to: SafetyDeliveryStatus, event: string, mutate: (actorMid: string) => Prisma.SafetySignalDeliveryUpdateInput, recipientOnly: boolean): Promise<SafetySignalDeliveryVM> {
  assertFamily(actor, action);
  const actorMid = await actorMembershipId(actor);
  if (actorMid === null) throw new FamilyForbiddenError("role_forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.safetySignalDelivery.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, deliveryStatus: true, recipientMembershipId: true } });
    if (!existing) throw new FamilyNotFoundError("safety_signal");
    // Recipient acts (acknowledge/decline) may only touch the actor's OWN delivery.
    if (recipientOnly && existing.recipientMembershipId !== actorMid) throw new FamilyForbiddenError("role_forbidden");
    if (!isValidSafetyDeliveryTransition(existing.deliveryStatus, to)) throw new FamilyValidationError("invalid_status_transition");
    const row = await db.safetySignalDelivery.update({ where: { id }, data: { deliveryStatus: to, ...mutate(actorMid) }, select: DELIVERY_SELECT });
    await audit(db, actor, event, row.id, { deliveryStatus: row.deliveryStatus, deliveryChannel: row.deliveryChannel });
    return row;
  });
}

export function makeSafetySignalDeliveryAvailable(actor: FamilyActorContext, id: string): Promise<SafetySignalDeliveryVM> {
  return transition(actor, id, FamilyAction.SafetyDeliveryMakeAvailable, SafetyDeliveryStatus.Available, CHILD_SAFETY_AUDIT_EVENTS.deliveryAvailable, () => ({ availableAt: new Date() }), false);
}
export function acknowledgeSafetySignalDelivery(actor: FamilyActorContext, id: string): Promise<SafetySignalDeliveryVM> {
  return transition(actor, id, FamilyAction.SafetyDeliveryAcknowledge, SafetyDeliveryStatus.Acknowledged, CHILD_SAFETY_AUDIT_EVENTS.deliveryAcknowledged, (mid) => ({ acknowledgedAt: new Date(), acknowledgedByMembershipId: mid }), true);
}
export function declineSafetySignalDelivery(actor: FamilyActorContext, id: string): Promise<SafetySignalDeliveryVM> {
  return transition(actor, id, FamilyAction.SafetyDeliveryDecline, SafetyDeliveryStatus.Declined, CHILD_SAFETY_AUDIT_EVENTS.deliveryDeclined, (mid) => ({ declinedAt: new Date(), declinedByMembershipId: mid }), true);
}
export function revokeSafetySignalDelivery(actor: FamilyActorContext, id: string): Promise<SafetySignalDeliveryVM> {
  return transition(actor, id, FamilyAction.SafetyDeliveryRevoke, SafetyDeliveryStatus.Revoked, CHILD_SAFETY_AUDIT_EVENTS.deliveryRevoked, () => ({ revokedAt: new Date() }), false);
}
export function supersedeSafetySignalDelivery(actor: FamilyActorContext, id: string): Promise<SafetySignalDeliveryVM> {
  return transition(actor, id, FamilyAction.SafetyDeliveryCreate, SafetyDeliveryStatus.Superseded, CHILD_SAFETY_AUDIT_EVENTS.deliverySuperseded, () => ({ supersededAt: new Date() }), false);
}
export function archiveSafetySignalDelivery(actor: FamilyActorContext, id: string): Promise<SafetySignalDeliveryVM> {
  return transition(actor, id, FamilyAction.SafetyDeliveryArchive, SafetyDeliveryStatus.Archived, CHILD_SAFETY_AUDIT_EVENTS.deliveryArchived, () => ({ archivedAt: new Date() }), false);
}

/**
 * The single EFFECTIVE delivery for (signal, recipient), or null. Picks the newest row-effective
 * delivery, then FAIL-CLOSED re-checks the live CS-C4 authorization (which itself re-checks the signal,
 * recipient membership, and CS-2 chain). Never mutates the historical row.
 */
export async function getEffectiveSafetySignalDelivery(actor: FamilyActorContext, safetySignalId: string, recipientMembershipId: string, now: Date = new Date()): Promise<SafetySignalDeliveryVM | null> {
  assertFamily(actor, FamilyAction.SafetyDeliveryView);
  const rows = await withTenant(actor.tenantId, (db) => db.safetySignalDelivery.findMany({
    where: { tenantId: actor.tenantId, safetySignalId, recipientMembershipId, revokedAt: null, supersededAt: null, archivedAt: null, declinedAt: null, failedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: DELIVERY_SELECT,
  }));
  const rowEffective = rows.find((r) => isSafetyDeliveryRowEffective(r, now));
  if (!rowEffective) return null;
  const auth = await getEffectiveRecipientAuthorization(actor, safetySignalId, recipientMembershipId, now);
  return auth ? rowEffective : null;
}
