/**
 * CS-C15C — the canonical internal ChildSafetyEscalation service. Creates a real escalation record
 * linked to a real ChildSafetyIncident, exactly once per (incident, escalationType), and fires exactly
 * one INTERNAL notification through the existing canonical notification path (idempotent by dedupe key).
 * INTERNAL ONLY — no external authority / police / school / emergency reporting. Content-free (coarse
 * family/severity/urgency/reason + opaque incident/escalation refs). SYSTEM-scoped (systemDb).
 */
import { Prisma, ActorKind } from "@prisma/client";
import { systemDb } from "./index";
import { createNotification } from "./notification-repo";
// PHASE 3B2 — a material escalation (a NEW escalation record → incident escalationState "escalated") atomically
// enqueues one bounded family_incident_escalated event in the SAME owner transaction (explicit tenantId, no
// escalation reason/notes). Escalation never broadens recipients — the processor re-uses the same linked-signal
// visibility. Reused/idempotent escalations enqueue nothing.
import { enqueueFamilyNotificationOutboxEventOwnerTx } from "./internal/family-notification-outbox";

const isUnique = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

async function audit(tenantId: string, event: string, targetId: string, metadata: Record<string, string | number | boolean>): Promise<void> {
  await systemDb.auditLog.create({ data: { tenantId, event, actorKind: ActorKind.system, targetType: "child_safety_escalation", targetId, metadata: metadata as never } }).catch(() => {});
}

export const CHILD_SAFETY_ESCALATION_EVENTS = {
  created: "child_safety.escalation.created",
  reused: "child_safety.escalation.reused",
  notificationCreated: "child_safety.escalation.notification_created",
  notificationReused: "child_safety.escalation.notification_reused",
} as const;

export interface EscalationResult {
  escalationId: string;
  createdEscalation: boolean;
  notificationCreated: boolean;
}

/** Read an escalation in tenant context (system read). */
export async function getChildSafetyEscalation(tenantId: string, escalationId: string) {
  return systemDb.childSafetyEscalation.findFirst({ where: { id: escalationId, tenantId }, select: { id: true, incidentId: true, escalationType: true, status: true, reasonCode: true } });
}

/**
 * Create-or-reuse the internal escalation for an incident + type (exactly-once), then create-or-reuse
 * the internal notification (idempotent). Retry-safe and concurrency-safe (unique `(incidentId,
 * escalationType)` + notification dedupe key converge simultaneous attempts to one of each).
 */
export async function createOrReuseEscalation(input: {
  tenantId: string;
  incidentId: string;
  escalationType: string;
  urgency: string;
  reasonCode: string;
  riskFamily: string;
  severity: string;
  now?: Date;
}): Promise<EscalationResult> {
  const now = input.now ?? new Date();
  // The incident MUST exist in this tenant (fail-closed; also enforced by the composite FK).
  const incident = await systemDb.childSafetyIncident.findFirst({ where: { id: input.incidentId, tenantId: input.tenantId }, select: { id: true } });
  if (!incident) throw new Error("child_safety_escalation:incident_not_found");

  let escalationId: string;
  let createdEscalation: boolean;
  const existing = await systemDb.childSafetyEscalation.findFirst({ where: { tenantId: input.tenantId, incidentId: input.incidentId, escalationType: input.escalationType }, select: { id: true } });
  if (existing) {
    escalationId = existing.id;
    createdEscalation = false;
  } else {
    try {
      // Atomic: create the escalation record, flip the incident to escalated, AND enqueue the durable event as
      // ONE owner transaction. If the enqueue fails, the whole escalation transition rolls back — a materially
      // escalated incident is never left without its notification event. eventVersion = the immutable escalation
      // record id (append-only per (incident, type); a new escalation → new id → new event; retry → same).
      escalationId = await systemDb.$transaction(async (tx) => {
        const row = await tx.childSafetyEscalation.create({ data: { tenantId: input.tenantId, incidentId: input.incidentId, escalationType: input.escalationType, urgency: input.urgency, reasonCode: input.reasonCode, status: "triggered" }, select: { id: true } });
        await tx.childSafetyIncident.update({ where: { id: input.incidentId }, data: { escalationState: "escalated" } });
        await enqueueFamilyNotificationOutboxEventOwnerTx(tx, {
          tenantId: input.tenantId,
          notificationType: "family_incident_escalated",
          source: { incidentId: input.incidentId },
          eventVersion: `escalated:${row.id}`,
          occurredAt: now,
        });
        return row.id;
      });
      createdEscalation = true;
    } catch (e) {
      if (!isUnique(e)) throw e;
      const winner = await systemDb.childSafetyEscalation.findFirst({ where: { tenantId: input.tenantId, incidentId: input.incidentId, escalationType: input.escalationType }, select: { id: true } });
      if (!winner) throw e;
      escalationId = winner.id;
      createdEscalation = false;
    }
  }

  // Exactly one INTERNAL notification through the canonical path (idempotent by dedupe key). Minimized
  // content only — coarse family/severity/urgency + reason + opaque internal refs; never raw content.
  const notif = await createNotification({
    tenantId: input.tenantId,
    type: "child_safety_escalation",
    severity: "critical",
    titleKey: "notif.child_safety_escalation.title",
    messageKey: "notif.child_safety_escalation.body",
    dedupeKey: `cs_escalation:${escalationId}`,
    metadata: { riskFamily: input.riskFamily, severity: input.severity, urgency: input.urgency, reasonCode: input.reasonCode, incidentRef: input.incidentId, escalationRef: escalationId },
  }).catch(() => ({ created: false, id: null }));

  await audit(input.tenantId, createdEscalation ? CHILD_SAFETY_ESCALATION_EVENTS.created : CHILD_SAFETY_ESCALATION_EVENTS.reused, escalationId, { incidentId: input.incidentId, reasonCode: input.reasonCode });
  await audit(input.tenantId, notif.created ? CHILD_SAFETY_ESCALATION_EVENTS.notificationCreated : CHILD_SAFETY_ESCALATION_EVENTS.notificationReused, escalationId, {});

  return { escalationId, createdEscalation, notificationCreated: notif.created };
}
