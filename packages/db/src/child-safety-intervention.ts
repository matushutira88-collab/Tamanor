/**
 * CS-C15 / CS-C15B — End-to-End Protective Intervention orchestrator, now DURABLE and RESUMABLE.
 *
 * After the CS-C6 gateway persists an accepted, MINIMIZED SafetySignal, this connects it to the REAL
 * protective services and records a durable per-signal execution ledger (child_safety_interventions)
 * so the flow is safely resumable after a partial failure without repeating any side effect:
 *
 *   accepted signal → canonical authorization chain → deterministic decision
 *     → [1] durable state (create/resume)  → [2] review (SafetySignal review workflow)
 *     → [3] incident correlate/create/link → [4] urgent internal escalation
 *     → [5] authorized guardian delivery (CS-C15A) → [6] complete → safe receipt
 *
 * Reuses `evaluateRecipientAuthorization` (the full canonical chain), the SafetySignal review model,
 * and `createSafetySignalDelivery` (idempotency-keyed), acting as the tenant's OWNER member. The
 * child-safety "incident" is a deterministic correlation of signals (same tenant + profile + risk
 * family within the 30-day window) anchored in the durable ledger — the cyberbullying Incident /
 * escalation SERVICES are NOT reused (they are bound to cyberbullying's ProtectedSubject /
 * SecurityDetection, a CS-C0 domain boundary). Raw content never enters (a SafetySignal is content-free
 * by construction); no evidence is ever attached; cross-tenant is impossible (RLS + explicit tenantId).
 */
import { ActorKind } from "@prisma/client";
import {
  decideIntervention, riskFamilyOf, INCIDENT_CORRELATION_WINDOW_MS, ChildSafetyOutcome,
  SafetySeverity, SafetyUrgency, RiskType, isFamilyPlanId,
  ChildSafetyEscalationType, escalationReasonForRisk,
  type FamilyActorContext, type InterventionDecision,
} from "@guardora/core";
import { systemDb } from "./index";
import { evaluateRecipientAuthorization, createRecipientAuthorizationDecision } from "./child-safety-recipient-authorization";
import { createSafetySignalDelivery, getEffectiveSafetySignalDelivery } from "./child-safety-delivery";
import { correlateAndLinkSignal, findIncidentForSignal, findActiveGroupIncident } from "./child-safety-incident";
import { createOrReuseEscalation, getChildSafetyEscalation } from "./child-safety-escalation";

export const INTERVENTION_DECISION_VERSION = "cs-c15b-v1";
const MAX_ATTEMPTS = 6;
const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Bounded, non-secret failure classification. */
export type InterventionFailureClass = "none" | "retryable" | "terminal";

export interface InterventionResult {
  outcome: ChildSafetyOutcome;
  processingState: "completed" | "processing";
  delivered: boolean;
  deliveryId: string | null;
  reviewed: boolean;
  incidentId: string | null;
  escalated: boolean;
  recipientsConsidered: number;
  recipientsAuthorized: number;
  attemptCount: number;
  lastFailureClass: InterventionFailureClass;
}

/** Injectable failure point (tests only) — forces a retryable failure at one step to prove recovery. */
export type InterventionFailAt = "review" | "incident" | "escalation" | "delivery" | "completion";

function urgencyFromSeverity(sev: string): SafetyUrgency {
  if (sev === SafetySeverity.Critical) return SafetyUrgency.Immediate;
  if (sev === SafetySeverity.High) return SafetyUrgency.Elevated;
  return SafetyUrgency.Routine;
}
async function audit(tenantId: string, event: string, targetId: string, metadata: Record<string, string | number | boolean>): Promise<void> {
  await systemDb.auditLog.create({ data: { tenantId, event, actorKind: ActorKind.system, targetType: "safety_signal", targetId, metadata: metadata as never } }).catch(() => {});
}
class StepFailure extends Error { constructor(public readonly cls: InterventionFailureClass) { super(cls); } }

export async function interveneOnAcceptedSafetySignal(
  input: { signalId: string; tenantId: string; now?: Date; failAt?: InterventionFailAt },
): Promise<InterventionResult> {
  const now = input.now ?? new Date();
  const empty: InterventionResult = { outcome: ChildSafetyOutcome.NoAction, processingState: "completed", delivered: false, deliveryId: null, reviewed: false, incidentId: null, escalated: false, recipientsConsidered: 0, recipientsAuthorized: 0, attemptCount: 0, lastFailureClass: "none" };

  const signal = await systemDb.safetySignal.findFirst({
    where: { id: input.signalId, tenantId: input.tenantId, archivedAt: null },
    select: { id: true, protectedProfileId: true, signalType: true, severity: true, confidenceBand: true, receivedAt: true },
  });
  if (!signal) return empty;

  const family = riskFamilyOf(signal.signalType as RiskType);
  const correlationKey = `${input.tenantId}:${signal.protectedProfileId}:${family}`;
  const urgency = urgencyFromSeverity(signal.severity);

  // [1] Durable state — create on first run, resume otherwise. Exactly one per accepted signal.
  const state = await systemDb.childSafetyIntervention.upsert({
    where: { safetySignalId: signal.id },
    create: {
      tenantId: input.tenantId, safetySignalId: signal.id, protectedProfileId: signal.protectedProfileId,
      decisionVersion: INTERVENTION_DECISION_VERSION, outcome: ChildSafetyOutcome.NoAction, correlationKey,
      severity: signal.severity, urgency,
    },
    update: {},
  });
  const resumed = state.attemptCount > 0;

  // Completed already → return the stored result verbatim (no side effect re-runs).
  if (state.completedAt) {
    return {
      outcome: state.outcome as ChildSafetyOutcome, processingState: "completed",
      delivered: state.deliveryStatus === "done", deliveryId: state.deliveryRef, reviewed: state.reviewStatus === "done",
      incidentId: state.incidentRef, escalated: state.escalationStatus === "done",
      recipientsConsidered: 0, recipientsAuthorized: 0, attemptCount: state.attemptCount, lastFailureClass: (state.lastFailureClass as InterventionFailureClass) ?? "none",
    };
  }

  await audit(input.tenantId, resumed ? "child_safety.intervention.resumed" : "child_safety.intervention.started", signal.id, { outcome: state.outcome, attempt: state.attemptCount });

  // Resolve authorization via the canonical chain (owner member acts on behalf of the tenant).
  const owner = await systemDb.membership.findFirst({ where: { tenantId: input.tenantId, role: "owner" }, select: { userId: true } });
  const tenantRow = await systemDb.tenant.findUnique({ where: { id: input.tenantId }, select: { workspaceKind: true, plan: true } });
  const actor: FamilyActorContext | null = owner && tenantRow?.workspaceKind === "family" && isFamilyPlanId(tenantRow.plan)
    ? { tenantId: input.tenantId, userId: owner.userId, role: "owner", workspaceKind: "family" } : null;
  const candidates = actor
    ? await systemDb.guardianRelationship.findMany({ where: { tenantId: input.tenantId, protectedProfileId: signal.protectedProfileId, status: "verified", revokedAt: null, archivedAt: null }, select: { id: true, guardianMembershipId: true, guardianRole: true, createdAt: true } })
    : [];
  candidates.sort((a, b) => (b.guardianRole === "primary" ? 1 : 0) - (a.guardianRole === "primary" ? 1 : 0) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const authorized: { relationshipId: string; recipientMembershipId: string }[] = [];
  for (const c of candidates) {
    const r = await evaluateRecipientAuthorization(actor!, { safetySignalId: signal.id, recipientMembershipId: c.guardianMembershipId, guardianRelationshipId: c.id }, now).catch(() => null);
    if (r?.authorized) authorized.push({ relationshipId: c.id, recipientMembershipId: c.guardianMembershipId });
  }
  const authOk = authorized.length > 0;

  // Existing correlated REAL incident (canonical), for the decision — not the ledger.
  const windowStart = new Date(now.getTime() - INCIDENT_CORRELATION_WINDOW_MS);
  const activeIncident = await findActiveGroupIncident(input.tenantId, signal.protectedProfileId, family, INCIDENT_CORRELATION_WINDOW_MS, now).catch(() => null);
  const priorCount = await systemDb.safetySignal.count({ where: { tenantId: input.tenantId, protectedProfileId: signal.protectedProfileId, archivedAt: null, receivedAt: { gte: windowStart, lt: signal.receivedAt } } }).catch(() => 0);

  const decision: InterventionDecision = decideIntervention({
    riskType: signal.signalType as RiskType, severity: signal.severity as SafetySeverity, urgency,
    confidenceBand: signal.confidenceBand as never,
    hasValidGuardianAuthority: authOk, hasRecipientAuthorization: authOk, recipientSafe: authOk, consentValid: authOk, hasAuthorizedRecipient: authOk,
    repeatedSignalCount: priorCount, existingActiveIncidentId: activeIncident?.id ?? null, alreadyEscalated: activeIncident?.escalationState === "escalated",
  });

  // Which steps are REQUIRED by the decision (the rest are marked "skipped" once).
  const reviewRequired = decision.outcome !== ChildSafetyOutcome.NoAction;
  const incidentRequired = decision.createOrUpdateIncident;
  // An urgent-escalation outcome must always resolve to the canonical escalation for its incident.
  // `decision.escalate` is false once the incident is already escalated (policy: fire once), but this
  // signal's ledger must still REUSE that existing escalation — `createOrReuseEscalation` is exactly-once
  // per (incident, type), so re-running it just returns the winner (no duplicate escalation/notification).
  const escalationRequired = decision.escalate || decision.outcome === ChildSafetyOutcome.UrgentEscalation;
  const deliveryRequired = decision.notifyGuardian && authOk;

  const patch: Record<string, unknown> = { outcome: decision.outcome, attemptCount: { increment: 1 }, lastFailureClass: null, nextRetryAt: null };
  let incidentRef: string | null = state.incidentRef;
  let escalated = state.escalationStatus === "done";
  let deliveryId: string | null = state.deliveryRef;

  try {
    // [2] REVIEW — the SafetySignal IS the review item (canonical reviewStatus workflow). Idempotent.
    if (state.reviewStatus === "pending") {
      if (input.failAt === "review") throw new StepFailure("retryable");
      patch.reviewStatus = reviewRequired ? "done" : "skipped";
      patch.reviewRef = reviewRequired ? signal.id : null;
      if (reviewRequired) await audit(input.tenantId, "child_safety.intervention.review_persisted", signal.id, { reviewRef: signal.id });
    }

    // [3] INCIDENT — REAL canonical ChildSafetyIncident correlate/create + exactly-once signal link.
    //     Canonical-record-aware: a ledger "done" is trusted only when the real link actually exists.
    const incidentVerifiedDone = state.incidentStatus === "done" && !!state.incidentRef && (await findIncidentForSignal(input.tenantId, signal.id).catch(() => null)) === state.incidentRef;
    if (incidentVerifiedDone) {
      incidentRef = state.incidentRef;
    } else if (incidentRequired) {
      if (input.failAt === "incident") throw new StepFailure("retryable");
      const r = await correlateAndLinkSignal({
        tenantId: input.tenantId, protectedProfileId: signal.protectedProfileId, safetySignalId: signal.id,
        riskFamily: family, severity: signal.severity, urgency, signalAt: signal.receivedAt, windowMs: INCIDENT_CORRELATION_WINDOW_MS, now,
      });
      incidentRef = r.incidentId;
      patch.incidentStatus = "done";
      patch.incidentRef = r.incidentId;
      if (state.incidentStatus === "done" && state.incidentRef !== r.incidentId) await audit(input.tenantId, "child_safety.intervention.ledger_repaired", signal.id, { step: "incident", incidentRef: r.incidentId });
    } else if (state.incidentStatus === "pending") {
      patch.incidentStatus = "skipped";
    }

    // [4] URGENT ESCALATION — REAL canonical ChildSafetyEscalation + internal notification. Internal
    //     only, exactly-once per (incident, type). Canonical-record-aware recovery.
    const escalationVerifiedDone = state.escalationStatus === "done" && !!state.escalationRef && !!(await getChildSafetyEscalation(input.tenantId, state.escalationRef).catch(() => null));
    if (escalationVerifiedDone) {
      escalated = true;
    } else if (escalationRequired) {
      if (input.failAt === "escalation") throw new StepFailure("retryable");
      const incId = (patch.incidentRef as string | null) ?? incidentRef;
      if (!incId) throw new StepFailure("retryable"); // escalation requires a real incident first
      const esc = await createOrReuseEscalation({
        tenantId: input.tenantId, incidentId: incId, escalationType: ChildSafetyEscalationType.UrgentInternal, urgency,
        reasonCode: escalationReasonForRisk(signal.signalType as RiskType, signal.severity as SafetySeverity, priorCount >= 3),
        riskFamily: family, severity: signal.severity, now,
      });
      escalated = true;
      patch.escalationStatus = "done";
      patch.escalationRef = esc.escalationId;
      if (state.escalationStatus === "done" && state.escalationRef !== esc.escalationId) await audit(input.tenantId, "child_safety.intervention.ledger_repaired", signal.id, { step: "escalation", escalationRef: esc.escalationId });
    } else if (state.escalationStatus === "pending") {
      patch.escalationStatus = "skipped";
    }

    // [5] GUARDIAN DELIVERY — only to an authorized safe recipient, idempotent (CS-C15A path).
    if (state.deliveryStatus === "pending") {
      if (deliveryRequired && actor) {
        if (input.failAt === "delivery") throw new StepFailure("retryable");
        const target = authorized[0]!;
        const existing = await getEffectiveSafetySignalDelivery(actor, signal.id, target.recipientMembershipId, now);
        if (existing) { deliveryId = existing.id; }
        else {
          const dec = await createRecipientAuthorizationDecision(actor, { safetySignalId: signal.id, recipientMembershipId: target.recipientMembershipId, guardianRelationshipId: target.relationshipId }, now);
          const del = await createSafetySignalDelivery(actor, { recipientAuthorizationDecisionId: dec.id, idempotencyKey: `intv_${signal.id}_${target.recipientMembershipId}`.slice(0, 120) }, now);
          deliveryId = del.id;
          await audit(input.tenantId, "child_safety.delivery.created", signal.id, { deliveryId: del.id });
        }
        patch.deliveryStatus = "done";
        patch.deliveryRef = deliveryId;
      } else {
        patch.deliveryStatus = "skipped";
        if (!deliveryRequired && decision.outcome !== ChildSafetyOutcome.NoAction) await audit(input.tenantId, "child_safety.intervention.authorization_blocked", signal.id, { outcome: decision.outcome });
      }
    }

    // [6] COMPLETE.
    if (input.failAt === "completion") throw new StepFailure("retryable");
    patch.completedAt = now;
  } catch (e) {
    // Persist progress-so-far + bounded failure; a retry resumes at the first still-pending step.
    const cls: InterventionFailureClass = e instanceof StepFailure ? e.cls : "retryable";
    const attempts = state.attemptCount + 1;
    const terminal = cls === "terminal" || attempts >= MAX_ATTEMPTS;
    patch.lastFailureClass = terminal ? "terminal" : "retryable";
    patch.nextRetryAt = terminal ? null : new Date(now.getTime() + Math.min(60_000, 1000 * 2 ** attempts));
    if (terminal) patch.completedAt = now; // stop retrying (bounded); side effects already-done are preserved
    const saved = await systemDb.childSafetyIntervention.update({ where: { id: state.id }, data: patch as never, select: FULL_SELECT });
    await audit(input.tenantId, terminal ? "child_safety.intervention.terminal_failure" : "child_safety.intervention.retryable_failure", signal.id, { attempt: saved.attemptCount, failure: patch.lastFailureClass as string });
    return toResult(saved, terminal ? "completed" : "processing", candidates.length, authorized.length);
  }

  const saved = await systemDb.childSafetyIntervention.update({ where: { id: state.id }, data: patch as never, select: FULL_SELECT });
  await audit(input.tenantId, "child_safety.intervention.completed", signal.id, { outcome: saved.outcome, delivered: saved.deliveryStatus === "done", incident: saved.incidentStatus === "done", escalated: saved.escalationStatus === "done" });
  return toResult(saved, "completed", candidates.length, authorized.length);
}

const FULL_SELECT = { id: true, outcome: true, reviewStatus: true, incidentStatus: true, incidentRef: true, escalationStatus: true, deliveryStatus: true, deliveryRef: true, attemptCount: true, lastFailureClass: true, completedAt: true } as const;
function toResult(s: { outcome: string; reviewStatus: string; incidentStatus: string; incidentRef: string | null; escalationStatus: string; deliveryStatus: string; deliveryRef: string | null; attemptCount: number; lastFailureClass: string | null; completedAt: Date | null }, processingState: "completed" | "processing", considered: number, authorizedN: number): InterventionResult {
  return {
    outcome: s.outcome as ChildSafetyOutcome, processingState,
    delivered: s.deliveryStatus === "done", deliveryId: s.deliveryRef, reviewed: s.reviewStatus === "done",
    incidentId: s.incidentStatus === "done" ? s.incidentRef : null, escalated: s.escalationStatus === "done",
    recipientsConsidered: considered, recipientsAuthorized: authorizedN, attemptCount: s.attemptCount, lastFailureClass: (s.lastFailureClass as InterventionFailureClass) ?? "none",
  };
}
