/**
 * Child Safety Reviewer Workspace V1 — the operational service layer (SYSTEM-scoped, systemDb).
 *
 * Read + review over the ACCEPTED canonical incident domain (CS-C15A/B/C). It never changes detection,
 * decision, or intervention behavior. Every function is tenant-isolated by an explicit `tenantId`
 * (these are SYSTEM tables — RLS is not the enforcement, explicit scoping + composite (id, tenantId) FKs
 * are), permission-checked against the actor's role, append-only for review actions, and content-free in
 * audit/timeline (raw content never exists in a SafetySignal, and reviewer note bodies never leave the
 * detail/notes read path — never logged, audited, or put on the timeline).
 */
import { ActorKind } from "@prisma/client";
import {
  Role,
  ChildSafetyIncidentStatus, isTerminalChildSafetyIncidentStatus,
  ChildSafetyIncidentSort, ChildSafetyIncidentListFilter,
  ChildSafetyReviewStatus, ChildSafetyReviewEventType,
  canViewChildSafetyReview, canManageChildSafetyReview,
  canTransitionChildSafetyReviewStatus, resolvedIncidentStatusFor,
  CHILD_SAFETY_SEVERITY_RANK, CHILD_SAFETY_URGENCY_RANK, CHILD_SAFETY_OPEN_STATUSES,
  CHILD_SAFETY_REVIEW_AUDIT_EVENTS, clampPageSize, CHILD_SAFETY_NOTE_MAX_LEN,
} from "@guardora/core";
import { systemDb } from "./index";

/** The human acting in the reviewer workspace. Tenant + identity + role come from the authenticated session. */
export interface ReviewerActor {
  tenantId: string;
  userId: string;
  role: Role;
}

/** A fail-closed, non-leaky authorization error (the web layer maps this to 403). */
export class ChildSafetyReviewForbiddenError extends Error {
  constructor(public readonly reason: string) { super("child_safety_review_forbidden"); }
}
/** A not-found / cross-tenant error (the web layer maps this to 404 — never reveals existence in another tenant). */
export class ChildSafetyReviewNotFoundError extends Error {
  constructor() { super("child_safety_review_not_found"); }
}
class ReviewInputError extends Error {}

const MATCH_CAP = 2000; // bounds the candidate scan for the ranked (severity/urgency) sorts.
const rank = (m: Record<string, number>, v: string): number => m[v] ?? -1;
const urgencyForSeverity = (s: string): string => (s === "critical" ? "immediate" : s === "high" ? "elevated" : "routine");

function assertView(actor: ReviewerActor): void {
  if (!canViewChildSafetyReview(actor.role)) throw new ChildSafetyReviewForbiddenError("view");
}
function assertManage(actor: ReviewerActor): void {
  if (!canManageChildSafetyReview(actor.role)) throw new ChildSafetyReviewForbiddenError("manage");
}
async function audit(tenantId: string, actorUserId: string, event: string, incidentId: string, metadata: Record<string, string | number | boolean>): Promise<void> {
  await systemDb.auditLog.create({ data: { tenantId, event, actorKind: ActorKind.human, actorUserId, targetType: "child_safety_incident", targetId: incidentId, metadata: metadata as never } }).catch(() => {});
}
/** Load an incident STRICTLY within the actor's tenant, or throw not-found (never cross-tenant). */
async function requireIncident(tenantId: string, incidentId: string) {
  const inc = await systemDb.childSafetyIncident.findFirst({ where: { id: incidentId, tenantId } });
  if (!inc) throw new ChildSafetyReviewNotFoundError();
  return inc;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. INCIDENT LIST — pagination + sort + filter + search. Content-free.
// ─────────────────────────────────────────────────────────────────────────────

export interface IncidentListItem {
  id: string; protectedProfileId: string; status: string; riskFamily: string; severity: string;
  urgency: string; escalationState: string; signalCount: number; assignedReviewerId: string | null;
  openedAt: string; lastSignalAt: string; createdAt: string; updatedAt: string;
}
export interface IncidentListInput {
  profileId?: string; severity?: string; urgency?: string; escalationState?: string; status?: string;
  listFilter?: ChildSafetyIncidentListFilter; search?: string;
  createdFrom?: Date; createdTo?: Date; updatedFrom?: Date; updatedTo?: Date;
  sort?: ChildSafetyIncidentSort; page?: number; pageSize?: number;
}
export interface IncidentListResult { items: IncidentListItem[]; total: number; page: number; pageSize: number; hasMore: boolean; }

function buildIncidentWhere(tenantId: string, input: IncidentListInput): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId };
  if (input.profileId) where.protectedProfileId = input.profileId;
  if (input.severity) where.severity = input.severity;
  if (input.urgency) where.urgency = input.urgency;
  if (input.escalationState) where.escalationState = input.escalationState;
  if (input.status) where.status = input.status;
  // Search is an EXACT id lookup (incident id OR protected profile id) — never a content search.
  if (input.search) where.OR = [{ id: input.search }, { protectedProfileId: input.search }];
  // Coarse status bucket.
  switch (input.listFilter) {
    case ChildSafetyIncidentListFilter.Open: where.status = { in: [...CHILD_SAFETY_OPEN_STATUSES] }; break;
    case ChildSafetyIncidentListFilter.Escalated: where.escalationState = "escalated"; break;
    case ChildSafetyIncidentListFilter.Resolved: where.status = ChildSafetyIncidentStatus.Resolved; break;
    case ChildSafetyIncidentListFilter.Dismissed: where.status = ChildSafetyIncidentStatus.Dismissed; break;
    default: break;
  }
  const createdAt: Record<string, Date> = {};
  if (input.createdFrom) createdAt.gte = input.createdFrom;
  if (input.createdTo) createdAt.lte = input.createdTo;
  if (Object.keys(createdAt).length) where.createdAt = createdAt;
  const updatedAt: Record<string, Date> = {};
  if (input.updatedFrom) updatedAt.gte = input.updatedFrom;
  if (input.updatedTo) updatedAt.lte = input.updatedTo;
  if (Object.keys(updatedAt).length) where.updatedAt = updatedAt;
  return where;
}

const toListItem = (r: {
  id: string; protectedProfileId: string; status: string; riskFamily: string; severity: string; urgency: string;
  escalationState: string; signalCount: number; assignedReviewerId: string | null; openedAt: Date; lastSignalAt: Date; createdAt: Date; updatedAt: Date;
}): IncidentListItem => ({
  id: r.id, protectedProfileId: r.protectedProfileId, status: r.status, riskFamily: r.riskFamily, severity: r.severity,
  urgency: r.urgency, escalationState: r.escalationState, signalCount: r.signalCount, assignedReviewerId: r.assignedReviewerId,
  openedAt: r.openedAt.toISOString(), lastSignalAt: r.lastSignalAt.toISOString(), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});

/** Paginated, sorted, filtered incident list. Newest/oldest paginate efficiently at any scale; the ranked
 *  (severity/urgency) sorts operate over the most-recent {@link MATCH_CAP} matches (a documented V1 bound). */
export async function listChildSafetyIncidents(actor: ReviewerActor, input: IncidentListInput = {}): Promise<IncidentListResult> {
  assertView(actor);
  const where = buildIncidentWhere(actor.tenantId, input);
  const pageSize = clampPageSize(input.pageSize);
  const page = input.page && input.page > 0 ? Math.floor(input.page) : 1;
  const skip = (page - 1) * pageSize;
  const total = await systemDb.childSafetyIncident.count({ where });
  const sort = input.sort ?? ChildSafetyIncidentSort.Newest;

  if (sort === ChildSafetyIncidentSort.Newest || sort === ChildSafetyIncidentSort.Oldest) {
    const rows = await systemDb.childSafetyIncident.findMany({
      where, orderBy: [{ createdAt: sort === ChildSafetyIncidentSort.Newest ? "desc" : "asc" }, { id: "asc" }], skip, take: pageSize,
    });
    return { items: rows.map(toListItem), total, page, pageSize, hasMore: skip + rows.length < total };
  }

  // Ranked sorts: fetch a bounded candidate window, sort deterministically by rank in memory, slice the page.
  const candidates = await systemDb.childSafetyIncident.findMany({ where, orderBy: [{ lastSignalAt: "desc" }, { id: "asc" }], take: MATCH_CAP });
  const key = sort === ChildSafetyIncidentSort.HighestSeverity ? CHILD_SAFETY_SEVERITY_RANK : CHILD_SAFETY_URGENCY_RANK;
  const field = sort === ChildSafetyIncidentSort.HighestSeverity ? "severity" : "urgency";
  candidates.sort((a, b) => rank(key, b[field]) - rank(key, a[field]) || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));
  const pageRows = candidates.slice(skip, skip + pageSize);
  return { items: pageRows.map(toListItem), total, page, pageSize, hasMore: skip + pageRows.length < total };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. INCIDENT DETAIL — incident + signals + timeline + escalations + notifications
//    + guardian delivery + recovery + audit refs + execution ledger summary.
// ─────────────────────────────────────────────────────────────────────────────

export interface TimelineEntry { at: string; type: string; actorUserId?: string; detail: Record<string, string | number | boolean>; }

const TIMELINE_TYPE_ORDER: Record<string, number> = {
  incident_created: 0, signal_linked: 1, severity_increased: 2, urgency_increased: 3,
  escalation_triggered: 4, notification_sent: 5, guardian_delivery: 6, recovery_repair: 7,
  reviewer_assigned: 8, reviewer_unassigned: 9, status_changed: 10, reviewer_note: 11,
};

/** Build the deterministic chronological timeline purely from canonical records + review events + audit. */
export function buildIncidentTimeline(sources: {
  incident: { openedAt: Date };
  signals: Array<{ safetySignalId: string; linkedAt: Date; signalType: string; severity: string; confidenceBand: string }>;
  escalations: Array<{ id: string; escalationType: string; reasonCode: string; urgency: string; triggeredAt: Date }>;
  notifications: Array<{ id: string; severity: string; type: string; createdAt: Date }>;
  deliveries: Array<{ id: string; deliveryStatus: string; recommendedActionClass: string | null; preparedAt: Date }>;
  reviewEvents: Array<{ id: string; eventType: string; actorUserId: string; fromValue: string | null; toValue: string | null; createdAt: Date }>;
  recoveryRepairs: Array<{ id: string; step: string; at: Date }>;
}): TimelineEntry[] {
  const out: Array<TimelineEntry & { _id: string }> = [];
  out.push({ at: sources.incident.openedAt.toISOString(), type: "incident_created", detail: {}, _id: "inc" });

  // Signals in deterministic order → link + monotonic severity/urgency increases.
  const orderedSignals = [...sources.signals].sort((a, b) => a.linkedAt.getTime() - b.linkedAt.getTime() || a.safetySignalId.localeCompare(b.safetySignalId));
  let sevRank = -1; let urgRank = -1;
  for (const s of orderedSignals) {
    out.push({ at: s.linkedAt.toISOString(), type: "signal_linked", detail: { signalType: s.signalType, severity: s.severity, confidenceBand: s.confidenceBand }, _id: `sig:${s.safetySignalId}` });
    const sr = rank(CHILD_SAFETY_SEVERITY_RANK, s.severity);
    if (sr > sevRank) { if (sevRank >= 0) out.push({ at: s.linkedAt.toISOString(), type: "severity_increased", detail: { to: s.severity }, _id: `sev:${s.safetySignalId}` }); sevRank = sr; }
    const u = urgencyForSeverity(s.severity); const ur = rank(CHILD_SAFETY_URGENCY_RANK, u);
    if (ur > urgRank) { if (urgRank >= 0) out.push({ at: s.linkedAt.toISOString(), type: "urgency_increased", detail: { to: u }, _id: `urg:${s.safetySignalId}` }); urgRank = ur; }
  }
  for (const e of sources.escalations) out.push({ at: e.triggeredAt.toISOString(), type: "escalation_triggered", detail: { escalationType: e.escalationType, reasonCode: e.reasonCode, urgency: e.urgency }, _id: `esc:${e.id}` });
  for (const n of sources.notifications) out.push({ at: n.createdAt.toISOString(), type: "notification_sent", detail: { severity: n.severity, notificationType: n.type }, _id: `ntf:${n.id}` });
  for (const d of sources.deliveries) out.push({ at: d.preparedAt.toISOString(), type: "guardian_delivery", detail: { deliveryStatus: d.deliveryStatus, ...(d.recommendedActionClass ? { recommendedActionClass: d.recommendedActionClass } : {}) }, _id: `dlv:${d.id}` });
  for (const r of sources.recoveryRepairs) out.push({ at: r.at.toISOString(), type: "recovery_repair", detail: { step: r.step }, _id: `rep:${r.id}` });
  for (const ev of sources.reviewEvents) {
    const type = ev.eventType === ChildSafetyReviewEventType.Assigned ? "reviewer_assigned"
      : ev.eventType === ChildSafetyReviewEventType.Unassigned ? "reviewer_unassigned"
      : ev.eventType === ChildSafetyReviewEventType.NoteAdded ? "reviewer_note"
      : "status_changed";
    const detail: Record<string, string> = {};
    if (ev.fromValue) detail.from = ev.fromValue;
    if (ev.toValue) detail.to = ev.toValue; // for note_added, toValue is the opaque note id (never the body)
    if (ev.eventType === ChildSafetyReviewEventType.Reopened) detail.reopened = "true";
    out.push({ at: ev.createdAt.toISOString(), type, actorUserId: ev.actorUserId, detail, _id: `rev:${ev.id}` });
  }

  out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (TIMELINE_TYPE_ORDER[a.type] ?? 99) - (TIMELINE_TYPE_ORDER[b.type] ?? 99) || a._id.localeCompare(b._id));
  return out.map(({ _id: _drop, ...e }) => e);
}

export async function getChildSafetyIncidentDetail(actor: ReviewerActor, incidentId: string) {
  assertView(actor);
  const incident = await requireIncident(actor.tenantId, incidentId);
  const tenantId = actor.tenantId;

  const links = await systemDb.childSafetyIncidentSignal.findMany({ where: { tenantId, incidentId }, orderBy: [{ linkedAt: "asc" }, { id: "asc" }], select: { safetySignalId: true, linkedAt: true } });
  const signalIds = links.map((l) => l.safetySignalId);
  const signals = signalIds.length
    ? await systemDb.safetySignal.findMany({ where: { tenantId, id: { in: signalIds } }, select: { id: true, signalType: true, severity: true, confidenceBand: true, receivedAt: true, reviewStatus: true } })
    : [];
  const sigById = new Map(signals.map((s) => [s.id, s]));
  const linkedSignals = links.map((l) => {
    const s = sigById.get(l.safetySignalId);
    return { safetySignalId: l.safetySignalId, linkedAt: l.linkedAt, signalType: s?.signalType ?? "unknown", severity: s?.severity ?? "unknown", confidenceBand: s?.confidenceBand ?? "unknown", reviewStatus: s?.reviewStatus ?? "unknown" };
  });

  const escalations = await systemDb.childSafetyEscalation.findMany({ where: { tenantId, incidentId }, orderBy: [{ triggeredAt: "asc" }, { id: "asc" }], select: { id: true, escalationType: true, status: true, urgency: true, reasonCode: true, triggeredAt: true, acknowledgedAt: true, resolvedAt: true } });
  const escalationIds = escalations.map((e) => e.id);
  const notifications = escalationIds.length
    ? await systemDb.notification.findMany({ where: { tenantId, dedupeKey: { in: escalationIds.map((id) => `cs_escalation:${id}`) } }, select: { id: true, type: true, severity: true, createdAt: true, readAt: true } })
    : [];
  const deliveries = signalIds.length
    ? await systemDb.safetySignalDelivery.findMany({ where: { tenantId, safetySignalId: { in: signalIds } }, orderBy: [{ preparedAt: "asc" }, { id: "asc" }], select: { id: true, safetySignalId: true, deliveryStatus: true, deliveryChannel: true, recommendedActionClass: true, preparedAt: true, availableAt: true, acknowledgedAt: true, declinedAt: true } })
    : [];
  const ledgers = signalIds.length
    ? await systemDb.childSafetyIntervention.findMany({ where: { tenantId, safetySignalId: { in: signalIds } }, select: { safetySignalId: true, outcome: true, reviewStatus: true, incidentStatus: true, escalationStatus: true, deliveryStatus: true, attemptCount: true, lastFailureClass: true, completedAt: true } })
    : [];
  const auditRefs = signalIds.length
    ? await systemDb.auditLog.findMany({ where: { tenantId, targetId: { in: signalIds } }, orderBy: [{ createdAt: "asc" }], select: { id: true, event: true, createdAt: true } })
    : [];
  const recoveryRepairs = auditRefs.filter((a) => a.event === "child_safety.intervention.ledger_repaired").map((a) => ({ id: a.id, step: "ledger", at: a.createdAt }));
  const reviewEvents = await systemDb.childSafetyReviewEvent.findMany({ where: { tenantId, incidentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, eventType: true, actorUserId: true, fromValue: true, toValue: true, createdAt: true } });
  const notes = await listChildSafetyReviewerNotes(actor, incidentId);

  const timeline = buildIncidentTimeline({
    incident: { openedAt: incident.openedAt },
    signals: linkedSignals.map((s) => ({ safetySignalId: s.safetySignalId, linkedAt: s.linkedAt, signalType: s.signalType, severity: s.severity, confidenceBand: s.confidenceBand })),
    escalations: escalations.map((e) => ({ id: e.id, escalationType: e.escalationType, reasonCode: e.reasonCode, urgency: e.urgency, triggeredAt: e.triggeredAt })),
    notifications: notifications.map((n) => ({ id: n.id, severity: n.severity, type: n.type, createdAt: n.createdAt })),
    deliveries: deliveries.map((d) => ({ id: d.id, deliveryStatus: d.deliveryStatus, recommendedActionClass: d.recommendedActionClass, preparedAt: d.preparedAt })),
    reviewEvents,
    recoveryRepairs,
  });

  // Execution ledger summary (per-signal execution state — NOT the incident record).
  const ledgerSummary = {
    signals: ledgers.length,
    completed: ledgers.filter((l) => l.completedAt !== null).length,
    delivered: ledgers.filter((l) => l.deliveryStatus === "done").length,
    escalated: ledgers.filter((l) => l.escalationStatus === "done").length,
    lastFailureClasses: Array.from(new Set(ledgers.map((l) => l.lastFailureClass).filter((c): c is string => !!c))),
    recoveryRepairs: recoveryRepairs.length,
  };
  const guardianDelivery = {
    total: deliveries.length,
    byStatus: deliveries.reduce<Record<string, number>>((acc, d) => { acc[d.deliveryStatus] = (acc[d.deliveryStatus] ?? 0) + 1; return acc; }, {}),
    channels: Array.from(new Set(deliveries.map((d) => d.deliveryChannel))),
  };

  return {
    incident: {
      id: incident.id, protectedProfileId: incident.protectedProfileId, status: incident.status, riskFamily: incident.riskFamily,
      severity: incident.severity, urgency: incident.urgency, escalationState: incident.escalationState, signalCount: incident.signalCount,
      assignedReviewerId: incident.assignedReviewerId, resolutionCode: incident.resolutionCode,
      openedAt: incident.openedAt.toISOString(), lastSignalAt: incident.lastSignalAt.toISOString(),
      lastReviewedAt: incident.lastReviewedAt?.toISOString() ?? null, closedAt: incident.closedAt?.toISOString() ?? null,
      createdAt: incident.createdAt.toISOString(), updatedAt: incident.updatedAt.toISOString(),
    },
    signals: linkedSignals.map((s) => ({ safetySignalId: s.safetySignalId, linkedAt: s.linkedAt.toISOString(), signalType: s.signalType, severity: s.severity, confidenceBand: s.confidenceBand, reviewStatus: s.reviewStatus })),
    escalations: escalations.map((e) => ({ id: e.id, escalationType: e.escalationType, status: e.status, urgency: e.urgency, reasonCode: e.reasonCode, triggeredAt: e.triggeredAt.toISOString(), acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null, resolvedAt: e.resolvedAt?.toISOString() ?? null })),
    notifications: notifications.map((n) => ({ id: n.id, type: n.type, severity: n.severity, createdAt: n.createdAt.toISOString(), read: n.readAt !== null })),
    guardianDelivery,
    recoveryStatus: { repairs: recoveryRepairs.length, incomplete: ledgers.filter((l) => l.completedAt === null).length },
    auditReferences: auditRefs.map((a) => ({ id: a.id, event: a.event, at: a.createdAt.toISOString() })),
    ledgerSummary,
    timeline,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. REVIEW ACTIONS — assign / unassign / note / status. Append-only + audited.
// ─────────────────────────────────────────────────────────────────────────────

export async function assignChildSafetyIncident(actor: ReviewerActor, incidentId: string, assigneeUserId: string): Promise<{ assignedReviewerId: string }> {
  assertManage(actor);
  if (!assigneeUserId) throw new ReviewInputError("assignee_required");
  const inc = await requireIncident(actor.tenantId, incidentId);
  const previous = inc.assignedReviewerId;
  await systemDb.childSafetyIncident.update({ where: { id: incidentId }, data: { assignedReviewerId: assigneeUserId, lastReviewedAt: new Date() } });
  await systemDb.childSafetyReviewEvent.create({ data: { tenantId: actor.tenantId, incidentId, eventType: ChildSafetyReviewEventType.Assigned, actorUserId: actor.userId, fromValue: previous, toValue: assigneeUserId } });
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_REVIEW_AUDIT_EVENTS.assigned, incidentId, { assignee: assigneeUserId });
  return { assignedReviewerId: assigneeUserId };
}

export async function unassignChildSafetyIncident(actor: ReviewerActor, incidentId: string): Promise<{ assignedReviewerId: null }> {
  assertManage(actor);
  const inc = await requireIncident(actor.tenantId, incidentId);
  if (inc.assignedReviewerId === null) return { assignedReviewerId: null }; // idempotent
  await systemDb.childSafetyIncident.update({ where: { id: incidentId }, data: { assignedReviewerId: null, lastReviewedAt: new Date() } });
  await systemDb.childSafetyReviewEvent.create({ data: { tenantId: actor.tenantId, incidentId, eventType: ChildSafetyReviewEventType.Unassigned, actorUserId: actor.userId, fromValue: inc.assignedReviewerId, toValue: null } });
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_REVIEW_AUDIT_EVENTS.unassigned, incidentId, {});
  return { assignedReviewerId: null };
}

export async function addChildSafetyReviewerNote(actor: ReviewerActor, incidentId: string, body: string): Promise<{ noteId: string }> {
  assertManage(actor);
  const trimmed = (body ?? "").trim();
  if (!trimmed) throw new ReviewInputError("note_empty");
  if (trimmed.length > CHILD_SAFETY_NOTE_MAX_LEN) throw new ReviewInputError("note_too_long");
  await requireIncident(actor.tenantId, incidentId);
  const note = await systemDb.childSafetyReviewerNote.create({ data: { tenantId: actor.tenantId, incidentId, authorUserId: actor.userId, body: trimmed }, select: { id: true } });
  // Timeline marker only — the note BODY is never written to the event or the audit log.
  await systemDb.childSafetyReviewEvent.create({ data: { tenantId: actor.tenantId, incidentId, eventType: ChildSafetyReviewEventType.NoteAdded, actorUserId: actor.userId, toValue: note.id } });
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_REVIEW_AUDIT_EVENTS.noteAdded, incidentId, { noteId: note.id });
  return { noteId: note.id };
}

/** Append-only note list for an incident (author + timestamp + body). Reviewer-internal read path only. */
export async function listChildSafetyReviewerNotes(actor: ReviewerActor, incidentId: string): Promise<Array<{ id: string; authorUserId: string; body: string; createdAt: string }>> {
  assertView(actor);
  const rows = await systemDb.childSafetyReviewerNote.findMany({ where: { tenantId: actor.tenantId, incidentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, authorUserId: true, body: true, createdAt: true } });
  return rows.map((n) => ({ id: n.id, authorUserId: n.authorUserId, body: n.body, createdAt: n.createdAt.toISOString() }));
}

export async function setChildSafetyReviewStatus(actor: ReviewerActor, incidentId: string, to: ChildSafetyReviewStatus): Promise<{ status: string }> {
  assertManage(actor);
  const inc = await requireIncident(actor.tenantId, incidentId);
  if (!canTransitionChildSafetyReviewStatus(inc.status, to)) throw new ReviewInputError(`invalid_transition:${inc.status}->${to}`);
  const isReopen = to === ChildSafetyReviewStatus.Reopened;
  const resolved = resolvedIncidentStatusFor(to);
  const now = new Date();
  const terminal = isTerminalChildSafetyIncidentStatus(resolved);
  await systemDb.childSafetyIncident.update({
    where: { id: incidentId },
    data: {
      status: resolved, lastReviewedAt: now,
      closedAt: terminal ? now : null, // reopening a finished incident clears closedAt
      resolutionCode: to === ChildSafetyReviewStatus.Resolved ? "resolved" : to === ChildSafetyReviewStatus.Dismissed ? "dismissed" : null,
    },
  });
  await systemDb.childSafetyReviewEvent.create({ data: { tenantId: actor.tenantId, incidentId, eventType: isReopen ? ChildSafetyReviewEventType.Reopened : ChildSafetyReviewEventType.StatusChanged, actorUserId: actor.userId, fromValue: inc.status, toValue: resolved } });
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_REVIEW_AUDIT_EVENTS.statusChanged, incidentId, { from: inc.status, to: resolved });
  return { status: resolved };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. DASHBOARD SUMMARY — all computed from canonical tables.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewerDashboard {
  openIncidents: number; escalated: number; critical: number; resolvedToday: number;
  avgResponseMs: number | null; avgResolutionMs: number | null;
  signalsLast24h: number; guardianDeliveriesLast24h: number; guardianDeliveriesTotal: number;
  topRiskFamilies: Array<{ riskFamily: string; count: number }>;
}

export async function getChildSafetyReviewerDashboard(actor: ReviewerActor, now: Date = new Date()): Promise<ReviewerDashboard> {
  assertView(actor);
  const tenantId = actor.tenantId;
  const since24h = new Date(now.getTime() - 24 * 3600 * 1000);
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [openIncidents, escalated, critical, resolvedToday, signalsLast24h, guardianDeliveriesLast24h, guardianDeliveriesTotal, families] = await Promise.all([
    systemDb.childSafetyIncident.count({ where: { tenantId, status: { in: [...CHILD_SAFETY_OPEN_STATUSES] } } }),
    systemDb.childSafetyIncident.count({ where: { tenantId, escalationState: "escalated" } }),
    systemDb.childSafetyIncident.count({ where: { tenantId, severity: "critical", status: { in: [...CHILD_SAFETY_OPEN_STATUSES] } } }),
    systemDb.childSafetyIncident.count({ where: { tenantId, status: ChildSafetyIncidentStatus.Resolved, closedAt: { gte: startOfDay } } }),
    systemDb.safetySignal.count({ where: { tenantId, receivedAt: { gte: since24h } } }),
    systemDb.safetySignalDelivery.count({ where: { tenantId, preparedAt: { gte: since24h } } }),
    systemDb.safetySignalDelivery.count({ where: { tenantId } }),
    systemDb.childSafetyIncident.groupBy({ by: ["riskFamily"], where: { tenantId }, _count: { _all: true } }),
  ]);

  const topRiskFamilies = families
    .map((f) => ({ riskFamily: f.riskFamily, count: f._count._all }))
    .sort((a, b) => b.count - a.count || a.riskFamily.localeCompare(b.riskFamily))
    .slice(0, 5);

  // Average response time = first review pickup (assigned OR status_changed) − incident opened.
  // Average resolution time = closedAt − openedAt for terminal incidents. Both bounded to this tenant.
  const [firstEvents, terminalIncidents] = await Promise.all([
    systemDb.childSafetyReviewEvent.findMany({ where: { tenantId, eventType: { in: [ChildSafetyReviewEventType.Assigned, ChildSafetyReviewEventType.StatusChanged, ChildSafetyReviewEventType.Reopened] } }, orderBy: [{ createdAt: "asc" }], select: { incidentId: true, createdAt: true } }),
    systemDb.childSafetyIncident.findMany({ where: { tenantId, closedAt: { not: null } }, select: { openedAt: true, closedAt: true } }),
  ]);
  const firstByIncident = new Map<string, Date>();
  for (const e of firstEvents) if (!firstByIncident.has(e.incidentId)) firstByIncident.set(e.incidentId, e.createdAt);
  let respSum = 0, respN = 0;
  if (firstByIncident.size) {
    const openedRows = await systemDb.childSafetyIncident.findMany({ where: { tenantId, id: { in: Array.from(firstByIncident.keys()) } }, select: { id: true, openedAt: true } });
    for (const r of openedRows) { const first = firstByIncident.get(r.id)!; const d = first.getTime() - r.openedAt.getTime(); if (d >= 0) { respSum += d; respN++; } }
  }
  let resSum = 0, resN = 0;
  for (const t of terminalIncidents) { if (t.closedAt) { const d = t.closedAt.getTime() - t.openedAt.getTime(); if (d >= 0) { resSum += d; resN++; } } }

  return {
    openIncidents, escalated, critical, resolvedToday,
    avgResponseMs: respN ? Math.round(respSum / respN) : null,
    avgResolutionMs: resN ? Math.round(resSum / resN) : null,
    signalsLast24h, guardianDeliveriesLast24h, guardianDeliveriesTotal, topRiskFamilies,
  };
}
