import { ActorKind, Prisma } from "@prisma/client";
import { withTenant } from "./repositories";
import { FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError, isActiveGuardianRelationship } from "./child-safety-family";
import { getEffectiveGuardianAuthority, getEffectiveConsent, getEffectiveSafeRecipientEligibility } from "./child-safety-consent";
import {
  FamilyAction, authorizeFamilyAction, familyRoleForMembershipRole, FamilyRole, CHILD_SAFETY_AUDIT_EVENTS,
  validateChildSafetyInput, evaluateCanReceiveSafetyInformation, ConsentType,
  RecipientAuthorizationDecisionStatus, RecipientAuthorizationReasonCode, SafetyDisclosureScope,
  reasonCodeForDenyReason, maxDisclosureScopesForSignal, serializeDisclosureScopes, scopesWithin,
  isRecipientEligibleFamilyRole, isRecipientAuthorizationDecisionRowEffective, isSafetyDisclosureScope,
  clampRecipientAuthorizationLimit, RECIPIENT_AUTHORIZATION_EVALUATE_FIELDS, RECIPIENT_AUTHORIZATION_CREATE_FIELDS,
  type FamilyActorContext,
} from "@guardora/core";

/**
 * CS-C4 — Authorized Recipient Resolution & Disclosure Decisions (backend, server-only). Computes and
 * RECORDS whether a membership is an authorized recipient of a specific disclosure scope for a
 * SafetySignal — point 6 ONLY. It reuses the CS-C2 effective evaluators (never duplicates/weakens them).
 *
 * NO DELIVERY (rule L): never creates a notification/cyberbullying_notification/incident/case/queue job,
 * never sends email/SMS/push/webhook, never calls a platform API, never shows raw content. `evaluate*`
 * does not write to the DB. No CS-1/C2/C3 record is ever mutated. All values are safe enums / record ids.
 *
 * CS-C4 uses `ConsentType.Guardian` as the required consent type for recipient authorization.
 */

const REQUIRED_CONSENT_TYPE = ConsentType.Guardian;
type Tx = Prisma.TransactionClient;

function assertFamily(actor: FamilyActorContext, action: FamilyAction): void {
  const d = authorizeFamilyAction(actor, action);
  if (!d.ok) throw new FamilyForbiddenError(d.reason);
}
async function audit(db: Tx, actor: FamilyActorContext, event: string, targetId: string, metadata?: Record<string, string | number | boolean>): Promise<void> {
  await db.auditLog.create({ data: { tenantId: actor.tenantId, event, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: "recipient_authorization_decision", targetId, metadata: (metadata ?? undefined) as never } });
}
async function actorMembershipId(actor: FamilyActorContext): Promise<string | null> {
  return withTenant(actor.tenantId, (db) => db.membership.findFirst({ where: { userId: actor.userId, tenantId: actor.tenantId }, select: { id: true } }).then((m) => m?.id ?? null));
}

// --- view model (content-free) ----------------------------------------------

export interface RecipientAuthorizationDecisionVM {
  id: string; safetySignalId: string; protectedProfileId: string; recipientMembershipId: string;
  guardianRelationshipId: string | null; guardianAuthorityRecordId: string | null; consentRecordId: string | null; safeRecipientAssessmentId: string | null;
  decisionStatus: string; disclosureScope: string; reasonCode: string;
  evaluatedAt: Date; validUntil: Date | null; revokedAt: Date | null; supersededAt: Date | null;
  createdAt: Date; updatedAt: Date; archivedAt: Date | null;
}
const DECISION_SELECT = { id: true, safetySignalId: true, protectedProfileId: true, recipientMembershipId: true, guardianRelationshipId: true, guardianAuthorityRecordId: true, consentRecordId: true, safeRecipientAssessmentId: true, decisionStatus: true, disclosureScope: true, reasonCode: true, evaluatedAt: true, validUntil: true, revokedAt: true, supersededAt: true, createdAt: true, updatedAt: true, archivedAt: true } as const;

// --- evaluate (no DB writes; reuses CS-2 effective evaluators) ---------------

export interface RecipientAuthorizationEvaluation {
  authorized: boolean;
  decisionStatus: RecipientAuthorizationDecisionStatus;
  reasonCode: RecipientAuthorizationReasonCode;
  allowedDisclosureScopes: SafetyDisclosureScope[];
  recordIds: {
    safetySignalId: string; protectedProfileId: string; recipientMembershipId: string;
    guardianRelationshipId: string | null; guardianAuthorityRecordId: string | null; consentRecordId: string | null; safeRecipientAssessmentId: string | null;
  };
  evaluatedAt: Date;
  validUntil: Date | null;
}

export interface RecipientAuthorizationInput {
  safetySignalId: string; recipientMembershipId: string; guardianRelationshipId: string;
  requestedScopes?: string[]; validUntil?: Date;
}

function deny(reasonCode: RecipientAuthorizationReasonCode, ids: RecipientAuthorizationEvaluation["recordIds"], now: Date): RecipientAuthorizationEvaluation {
  return { authorized: false, decisionStatus: RecipientAuthorizationDecisionStatus.Denied, reasonCode, allowedDisclosureScopes: [], recordIds: ids, evaluatedAt: now, validUntil: null };
}
function minDate(dates: (Date | null)[]): Date | null {
  const present = dates.filter((d): d is Date => d !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

/**
 * PURE authorization computation (no DB writes). Loads the signal/membership/relationship (RLS) and
 * reuses the CS-C2 effective evaluators, then applies the CS-C4 chain + disclosure policy. Fail-closed.
 */
export async function evaluateRecipientAuthorization(actor: FamilyActorContext, input: RecipientAuthorizationInput, now: Date = new Date()): Promise<RecipientAuthorizationEvaluation> {
  assertFamily(actor, FamilyAction.SafetyRecipientAuthorizationEvaluate);
  const v = validateChildSafetyInput(input, RECIPIENT_AUTHORIZATION_EVALUATE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (input.requestedScopes !== undefined && (!Array.isArray(input.requestedScopes) || !input.requestedScopes.every(isSafetyDisclosureScope))) throw new FamilyValidationError("requestedScopes");

  const emptyIds = { safetySignalId: input.safetySignalId, protectedProfileId: "", recipientMembershipId: input.recipientMembershipId, guardianRelationshipId: null, guardianAuthorityRecordId: null, consentRecordId: null, safeRecipientAssessmentId: null };

  // Load signal + membership + relationship in one RLS transaction (reads only).
  const loaded = await withTenant(actor.tenantId, async (db) => {
    const signal = await db.safetySignal.findFirst({ where: { id: input.safetySignalId, tenantId: actor.tenantId }, select: { id: true, protectedProfileId: true, severity: true, signalType: true, archivedAt: true } });
    if (!signal) return { kind: "no_signal" as const };
    const membership = await db.membership.findFirst({ where: { id: input.recipientMembershipId, tenantId: actor.tenantId }, select: { id: true, role: true } });
    const relationship = await db.guardianRelationship.findFirst({ where: { id: input.guardianRelationshipId, tenantId: actor.tenantId }, select: { id: true, status: true, relationshipType: true, protectedProfileId: true, guardianMembershipId: true, revokedAt: true, archivedAt: true } });
    return { kind: "ok" as const, signal, membership, relationship };
  });
  if (loaded.kind === "no_signal") return deny(RecipientAuthorizationReasonCode.TenantMismatch, emptyIds, now);

  const { signal, membership, relationship } = loaded;
  const ids = { ...emptyIds, protectedProfileId: signal.protectedProfileId, guardianRelationshipId: relationship?.id ?? null };
  if (signal.archivedAt) return deny(RecipientAuthorizationReasonCode.SignalArchived, ids, now);
  if (!membership) return deny(RecipientAuthorizationReasonCode.InactiveMembership, ids, now);
  if (!isRecipientEligibleFamilyRole(familyRoleForMembershipRole(membership.role))) return deny(RecipientAuthorizationReasonCode.RecipientRoleNotAllowed, ids, now);
  if (!relationship) return deny(RecipientAuthorizationReasonCode.NoActiveGuardianRelationship, ids, now);
  if (relationship.protectedProfileId !== signal.protectedProfileId) return deny(RecipientAuthorizationReasonCode.ProfileMismatch, ids, now);
  if (relationship.guardianMembershipId !== input.recipientMembershipId) return deny(RecipientAuthorizationReasonCode.NoActiveGuardianRelationship, ids, now);

  // Reuse CS-C2 effective evaluators (each opens its own RLS transaction — NOT nested).
  const authority = await getEffectiveGuardianAuthority(actor, input.guardianRelationshipId, now);
  const consent = await getEffectiveConsent(actor, signal.protectedProfileId, REQUIRED_CONSENT_TYPE, now);
  const assessment = await getEffectiveSafeRecipientEligibility(actor, input.guardianRelationshipId, now);
  const snapshotIds = { ...ids, guardianAuthorityRecordId: authority?.id ?? null, consentRecordId: consent?.id ?? null, safeRecipientAssessmentId: assessment?.id ?? null };

  const chain = evaluateCanReceiveSafetyInformation({
    workspaceKind: actor.workspaceKind,
    relationshipActive: isActiveGuardianRelationship(relationship),
    relationshipType: relationship.relationshipType,
    membershipActiveSameTenant: true,
    authorityActive: authority !== null,
    consentEffective: consent !== null,
    assessmentApproved: assessment !== null,
  });
  if (!chain.ok) return deny(reasonCodeForDenyReason(chain.reasons[0] ?? "assessment_not_approved"), snapshotIds, now);

  // AUTHORIZED — apply the deterministic disclosure policy, clamped to any requested subset.
  const maxScopes = maxDisclosureScopesForSignal(signal.severity, signal.signalType);
  let allowed: SafetyDisclosureScope[];
  if (input.requestedScopes && input.requestedScopes.length > 0) {
    const requested = input.requestedScopes as SafetyDisclosureScope[];
    if (!scopesWithin(requested, maxScopes)) return deny(RecipientAuthorizationReasonCode.ConsentScopeInsufficient, snapshotIds, now);
    allowed = requested;
  } else {
    allowed = maxScopes;
  }
  const validUntil = minDate([authority?.validUntil ?? null, consent?.validUntil ?? null, assessment?.validUntil ?? null, input.validUntil ?? null]);
  return { authorized: true, decisionStatus: RecipientAuthorizationDecisionStatus.Authorized, reasonCode: RecipientAuthorizationReasonCode.CompleteAuthorizationChain, allowedDisclosureScopes: allowed, recordIds: snapshotIds, evaluatedAt: now, validUntil };
}

// --- create (records the decision; self-authorization gate) -----------------

export async function createRecipientAuthorizationDecision(actor: FamilyActorContext, input: RecipientAuthorizationInput, now: Date = new Date()): Promise<RecipientAuthorizationDecisionVM> {
  assertFamily(actor, FamilyAction.SafetyRecipientAuthorizationCreate);
  const cv = validateChildSafetyInput(input, RECIPIENT_AUTHORIZATION_CREATE_FIELDS);
  if (!cv.ok) throw new FamilyValidationError(cv.errors[0]?.field ?? "$");
  // Self-authorization: an actor may only author a decision naming THEMSELVES as recipient if they are
  // a PrimaryGuardian (and the independent chain still has to be complete). Otherwise fail closed.
  const actorMid = await actorMembershipId(actor);
  if (actorMid === null) throw new FamilyForbiddenError("role_forbidden");
  if (actorMid === input.recipientMembershipId && familyRoleForMembershipRole(actor.role) !== FamilyRole.PrimaryGuardian) {
    throw new FamilyForbiddenError("role_forbidden"); // no self-authorization by role alone
  }

  const result = await evaluateRecipientAuthorization(actor, input, now);
  return withTenant(actor.tenantId, async (db) => {
    const row = await db.safetyRecipientAuthorizationDecision.create({
      data: {
        tenantId: actor.tenantId,
        safetySignalId: result.recordIds.safetySignalId, protectedProfileId: result.recordIds.protectedProfileId,
        recipientMembershipId: result.recordIds.recipientMembershipId,
        guardianRelationshipId: result.recordIds.guardianRelationshipId, guardianAuthorityRecordId: result.recordIds.guardianAuthorityRecordId,
        consentRecordId: result.recordIds.consentRecordId, safeRecipientAssessmentId: result.recordIds.safeRecipientAssessmentId,
        decisionStatus: result.decisionStatus, disclosureScope: serializeDisclosureScopes(result.allowedDisclosureScopes),
        reasonCode: result.reasonCode, evaluatedAt: result.evaluatedAt, validUntil: result.validUntil,
      },
      select: DECISION_SELECT,
    });
    // Content-free audit: evaluated + created + authorized/denied. NO delivery of any kind.
    const meta = { decisionStatus: row.decisionStatus, reasonCode: row.reasonCode, safetySignalId: row.safetySignalId, recipientMembershipId: row.recipientMembershipId };
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.recipientAuthorizationEvaluated, row.id, meta);
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.recipientAuthorizationCreated, row.id, meta);
    await audit(db, actor, result.authorized ? CHILD_SAFETY_AUDIT_EVENTS.recipientAuthorizationAuthorized : CHILD_SAFETY_AUDIT_EVENTS.recipientAuthorizationDenied, row.id, meta);
    return row;
  });
}

// --- read / list ------------------------------------------------------------

export async function getRecipientAuthorizationDecision(actor: FamilyActorContext, id: string): Promise<RecipientAuthorizationDecisionVM> {
  assertFamily(actor, FamilyAction.SafetyRecipientAuthorizationView);
  const row = await withTenant(actor.tenantId, (db) => db.safetyRecipientAuthorizationDecision.findFirst({ where: { id, tenantId: actor.tenantId }, select: DECISION_SELECT }));
  if (!row) throw new FamilyNotFoundError("safe_recipient_assessment"); // reuse kind label; content-free
  return row;
}

export interface RecipientAuthorizationListOpts { safetySignalId?: string; protectedProfileId?: string; recipientMembershipId?: string; decisionStatus?: string; includeArchived?: boolean; limit?: number; offset?: number }
export interface RecipientAuthorizationPage { items: RecipientAuthorizationDecisionVM[]; limit: number; offset: number }

export function listRecipientAuthorizationDecisions(actor: FamilyActorContext, opts: RecipientAuthorizationListOpts = {}): Promise<RecipientAuthorizationPage> {
  assertFamily(actor, FamilyAction.SafetyRecipientAuthorizationView);
  const limit = clampRecipientAuthorizationLimit(opts.limit);
  const offset = typeof opts.offset === "number" && opts.offset > 0 ? Math.floor(opts.offset) : 0;
  const where: Prisma.SafetyRecipientAuthorizationDecisionWhereInput = {
    tenantId: actor.tenantId,
    ...(opts.safetySignalId ? { safetySignalId: opts.safetySignalId } : {}),
    ...(opts.protectedProfileId ? { protectedProfileId: opts.protectedProfileId } : {}),
    ...(opts.recipientMembershipId ? { recipientMembershipId: opts.recipientMembershipId } : {}),
    ...(opts.decisionStatus ? { decisionStatus: opts.decisionStatus } : {}),
    ...(opts.includeArchived ? {} : { archivedAt: null }),
  };
  return withTenant(actor.tenantId, async (db) => {
    const items = await db.safetyRecipientAuthorizationDecision.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset, select: DECISION_SELECT });
    return { items, limit, offset };
  });
}

/**
 * The single EFFECTIVE authorization for (signal, recipient), or null. Picks the newest non-revoked/
 * -superseded/-archived AUTHORIZED, time-valid row — then FAIL-CLOSED RE-EVALUATES the live CS-C2 chain,
 * so a decision whose consent/authority/relationship/assessment was later revoked (or whose signal was
 * archived) is NOT effective. Never mutates the historical row.
 */
export async function getEffectiveRecipientAuthorization(actor: FamilyActorContext, safetySignalId: string, recipientMembershipId: string, now: Date = new Date()): Promise<RecipientAuthorizationDecisionVM | null> {
  assertFamily(actor, FamilyAction.SafetyRecipientAuthorizationView);
  const rows = await withTenant(actor.tenantId, (db) => db.safetyRecipientAuthorizationDecision.findMany({
    where: { tenantId: actor.tenantId, safetySignalId, recipientMembershipId, decisionStatus: RecipientAuthorizationDecisionStatus.Authorized, revokedAt: null, supersededAt: null, archivedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: DECISION_SELECT,
  }));
  const rowEffective = rows.find((r) => isRecipientAuthorizationDecisionRowEffective(r, now));
  if (!rowEffective || !rowEffective.guardianRelationshipId) return null;
  // Re-evaluate the live chain — a stale AUTHORIZED must not remain effective after a downstream revoke.
  const live = await evaluateRecipientAuthorization(actor, { safetySignalId, recipientMembershipId, guardianRelationshipId: rowEffective.guardianRelationshipId }, now);
  return live.authorized ? rowEffective : null;
}

// --- revoke / supersede (history preserved) ---------------------------------

export async function revokeRecipientAuthorizationDecision(actor: FamilyActorContext, id: string): Promise<RecipientAuthorizationDecisionVM> {
  assertFamily(actor, FamilyAction.SafetyRecipientAuthorizationRevoke);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.safetyRecipientAuthorizationDecision.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, revokedAt: true } });
    if (!existing) throw new FamilyNotFoundError("safe_recipient_assessment");
    if (existing.revokedAt) return db.safetyRecipientAuthorizationDecision.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: DECISION_SELECT });
    const row = await db.safetyRecipientAuthorizationDecision.update({ where: { id }, data: { decisionStatus: RecipientAuthorizationDecisionStatus.Revoked, revokedAt: new Date(), reasonCode: RecipientAuthorizationReasonCode.AuthorizationRevoked }, select: DECISION_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.recipientAuthorizationRevoked, row.id, { decisionStatus: row.decisionStatus, reasonCode: row.reasonCode });
    return row;
  });
}

/** Mark an existing decision SUPERSEDED (a newer decision replaces it). The historical row is kept. */
export async function supersedeRecipientAuthorizationDecision(actor: FamilyActorContext, id: string): Promise<RecipientAuthorizationDecisionVM> {
  assertFamily(actor, FamilyAction.SafetyRecipientAuthorizationCreate);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.safetyRecipientAuthorizationDecision.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, supersededAt: true, revokedAt: true } });
    if (!existing) throw new FamilyNotFoundError("safe_recipient_assessment");
    if (existing.supersededAt) return db.safetyRecipientAuthorizationDecision.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: DECISION_SELECT });
    const row = await db.safetyRecipientAuthorizationDecision.update({ where: { id }, data: { decisionStatus: RecipientAuthorizationDecisionStatus.Superseded, supersededAt: new Date(), reasonCode: RecipientAuthorizationReasonCode.SupersededByNewDecision }, select: DECISION_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.recipientAuthorizationSuperseded, row.id, { decisionStatus: row.decisionStatus, reasonCode: row.reasonCode });
    return row;
  });
}
