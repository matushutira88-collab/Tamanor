import { ActorKind, Prisma } from "@prisma/client";
import {
  Permission, Role, can, CYBERBULLYING_AUDIT_EVENTS, IncidentCategory,
  CyberbullyingNotificationType, CyberbullyingNotificationSeverity, NOTIFICATION_SEVERITY, NotificationEntityType,
  notificationDedupKey, RecipientPurpose, type IncidentActorContext,
} from "@guardora/core";
import { withTenant } from "./repositories";

/**
 * C10 — Notification foundation (GENERAL, tenant-scoped) + the single authoritative
 * recipient resolver. A notification is an internal in-app message; it never proves
 * access (the CTA re-checks on open) and never carries confidential text. Recipients
 * are resolved from active membership + permission + incident scope, so a user can
 * never be notified about an incident they can't open. Dedup is by
 * (tenant, recipient, key) so a repeated SLA run is idempotent.
 */

type Tx = Prisma.TransactionClient;
const DOMAIN = IncidentCategory.Cyberbullying;
const MANAGE_ROLES = [Role.Owner, Role.Admin] as string[];

export class NotificationError extends Error {
  constructor(public readonly code: "forbidden" | "not_found" | "invalid_recipient") { super(`notification: ${code}`); this.name = "NotificationError"; }
}

// --- Recipient resolution (authoritative) ----------------------------------

interface IncidentScope { assignee: string | null; participants: string[] }
async function loadIncidentScope(db: Tx, tenantId: string, incidentId: string): Promise<IncidentScope | null> {
  const inc = await db.incident.findFirst({
    where: { id: incidentId, tenantId, domain: DOMAIN },
    select: { id: true, cyberbullyingDetail: { select: { assignedReviewerUserId: true } }, participants: { where: { userId: { not: null } }, select: { userId: true } } },
  });
  if (!inc) return null;
  return { assignee: inc.cyberbullyingDetail?.assignedReviewerUserId ?? null, participants: inc.participants.map((p) => p.userId!).filter(Boolean) };
}
async function rolesFor(db: Tx, tenantId: string, userIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await db.membership.findMany({ where: { tenantId, userId: { in: ids } }, select: { userId: true, role: true } });
  return new Map(rows.map((r) => [r.userId, String(r.role)]));
}
async function manageMembers(db: Tx, tenantId: string): Promise<string[]> {
  const rows = await db.membership.findMany({ where: { tenantId, role: { in: MANAGE_ROLES as never } }, select: { userId: true }, take: 200 });
  return rows.map((r) => r.userId);
}

/** Sources contributing candidates for each purpose. */
function sourcesFor(purpose: RecipientPurpose, isOverdue: boolean): { target: boolean; assignee: boolean; participants: boolean; managers: boolean } {
  switch (purpose) {
    case RecipientPurpose.Assignment: return { target: true, assignee: false, participants: false, managers: false };
    case RecipientPurpose.TaskAssignment: return { target: true, assignee: false, participants: false, managers: false };
    case RecipientPurpose.TaskDueSoon: return { target: true, assignee: true, participants: false, managers: false };
    case RecipientPurpose.TaskOverdue: return { target: true, assignee: true, participants: false, managers: true };
    case RecipientPurpose.FollowUp: return { target: false, assignee: true, participants: true, managers: isOverdue };
    case RecipientPurpose.CriticalRisk: return { target: false, assignee: true, participants: true, managers: true };
    case RecipientPurpose.Escalation: return { target: true, assignee: true, participants: false, managers: true };
    case RecipientPurpose.Reopen: return { target: false, assignee: true, participants: true, managers: false };
    default: return { target: false, assignee: false, participants: false, managers: false };
  }
}

/**
 * The single recipient resolver. Returns validated recipient userIds: each is an
 * active tenant member, holds `cyberbullying:review`, and is in the incident's scope
 * (owner/admin tenant-wide, or a participant/assignee). Explicit targets get NO scope
 * bypass. Excludes `excludeUserId` (usually the actor). Bounded.
 */
export async function resolveIncidentRecipientsTx(
  db: Tx, tenantId: string, incidentId: string, purpose: RecipientPurpose,
  opts: { targetUserId?: string | null; targetRole?: string | null; isOverdue?: boolean; excludeUserId?: string | null } = {},
): Promise<string[]> {
  const scope = await loadIncidentScope(db, tenantId, incidentId);
  if (!scope) return [];
  const src = sourcesFor(purpose, !!opts.isOverdue);
  const candidates = new Set<string>();
  if (src.assignee && scope.assignee) candidates.add(scope.assignee);
  if (src.participants) scope.participants.forEach((u) => candidates.add(u));
  if (src.managers) (await manageMembers(db, tenantId)).forEach((u) => candidates.add(u));
  if (src.target) {
    if (opts.targetUserId) candidates.add(opts.targetUserId);
    if (opts.targetRole) {
      const rows = await db.membership.findMany({ where: { tenantId, role: opts.targetRole as never }, select: { userId: true }, take: 200 });
      rows.forEach((r) => candidates.add(r.userId));
    }
  }
  candidates.delete("");
  if (opts.excludeUserId) candidates.delete(opts.excludeUserId);

  const roles = await rolesFor(db, tenantId, [...candidates, scope.assignee ?? ""].filter(Boolean));
  const inScopeUsers = new Set([...scope.participants, scope.assignee].filter(Boolean) as string[]);
  const out: string[] = [];
  for (const userId of candidates) {
    const role = roles.get(userId);
    if (!role) continue; // not an active member of this tenant
    if (!can(role as Role, Permission.CyberbullyingReview)) continue; // viewer/no-review excluded
    const tenantWide = MANAGE_ROLES.includes(role);
    if (!tenantWide && !inScopeUsers.has(userId)) continue; // can't open this incident ⇒ never notified
    out.push(userId);
  }
  return out.slice(0, 200);
}

/** Whether a single explicit recipient is valid for an incident (escalation target check). */
export async function isValidIncidentRecipientTx(db: Tx, tenantId: string, incidentId: string, userId: string): Promise<boolean> {
  const scope = await loadIncidentScope(db, tenantId, incidentId);
  if (!scope) return false;
  const roles = await rolesFor(db, tenantId, [userId]);
  const role = roles.get(userId);
  if (!role || !can(role as Role, Permission.CyberbullyingReview)) return false;
  if (MANAGE_ROLES.includes(role)) return true;
  return new Set([...scope.participants, scope.assignee].filter(Boolean)).has(userId);
}

// --- Notification creation (dedup, tx-composable) ---------------------------

export interface NotifySpec {
  type: CyberbullyingNotificationType;
  entityType: NotificationEntityType;
  entityId: string;
  incidentId?: string | null;
  discriminator?: string | number;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Create one notification (deduped). Returns true if newly created. Uses CHECK-then-
 * insert (not a caught unique violation): a P2002 inside a Postgres transaction aborts
 * the WHOLE transaction (25P02), which would roll back the triggering domain op — so a
 * duplicate must never reach the INSERT. The unique index stays as a concurrency
 * backstop. The dedupKey makes a repeated evaluation idempotent.
 */
export async function createNotificationTx(db: Tx, tenantId: string, actorUserId: string | null, recipientUserId: string, spec: NotifySpec): Promise<boolean> {
  const dedupKey = notificationDedupKey(spec.type, spec.entityType, spec.entityId, spec.discriminator ?? "");
  const existing = await db.cyberbullyingNotification.findFirst({ where: { tenantId, recipientUserId, deduplicationKey: dedupKey }, select: { id: true } });
  if (existing) return false; // already delivered (dedup) — no INSERT, no transaction abort
  await db.cyberbullyingNotification.create({ data: {
    tenantId, recipientUserId, type: spec.type, severity: NOTIFICATION_SEVERITY[spec.type], entityType: spec.entityType, entityId: spec.entityId,
    incidentId: spec.incidentId ?? null, deduplicationKey: dedupKey, metadata: (spec.metadata ?? undefined) as never,
  } });
  // Sanitized audit — type/severity/entity only; never text.
  await db.auditLog.create({ data: { tenantId, event: CYBERBULLYING_AUDIT_EVENTS.notificationCreated, actorKind: actorUserId ? ActorKind.human : ActorKind.system, actorUserId, targetType: "notification", targetId: recipientUserId, metadata: { type: spec.type, severity: NOTIFICATION_SEVERITY[spec.type], entityType: spec.entityType } as never } });
  return true;
}

/** Resolve recipients for a purpose and create a deduped notification for each (tx-composable). */
export async function notifyIncidentTx(db: Tx, actor: IncidentActorContext, incidentId: string, purpose: RecipientPurpose, spec: NotifySpec, opts: { targetUserId?: string | null; targetRole?: string | null; isOverdue?: boolean; excludeActor?: boolean } = {}): Promise<number> {
  const recipients = await resolveIncidentRecipientsTx(db, actor.tenantId, incidentId, purpose, { targetUserId: opts.targetUserId, targetRole: opts.targetRole, isOverdue: opts.isOverdue, excludeUserId: opts.excludeActor === false ? null : actor.userId });
  let created = 0;
  for (const r of recipients) if (await createNotificationTx(db, actor.tenantId, actor.userId, r, spec)) created++;
  return created;
}

// --- Read model + read/dismiss (own notifications only) --------------------

export interface NotificationVM {
  id: string; type: string; severity: string; entityType: string; entityId: string; incidentId: string | null;
  createdAt: string; readAt: string | null; dismissedAt: string | null;
}
function toVM(n: { id: string; type: string; severity: string; entityType: string; entityId: string; incidentId: string | null; createdAt: Date; readAt: Date | null; dismissedAt: Date | null }): NotificationVM {
  return { id: n.id, type: n.type, severity: n.severity, entityType: n.entityType, entityId: n.entityId, incidentId: n.incidentId, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null, dismissedAt: n.dismissedAt?.toISOString() ?? null };
}

const NOTIF_PAGE = 20;
const NOTIF_MAX = 100;

export async function listCyberbullyingNotifications(actor: IncidentActorContext, opts: { filter?: "all" | "unread"; page?: number; pageSize?: number } = {}): Promise<{ items: NotificationVM[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(NOTIF_MAX, Math.max(1, opts.pageSize ?? NOTIF_PAGE));
  const where: Prisma.CyberbullyingNotificationWhereInput = { tenantId: actor.tenantId, recipientUserId: actor.userId, dismissedAt: null, ...(opts.filter === "unread" ? { readAt: null } : {}) };
  return withTenant(actor.tenantId, async (db) => {
    const [rows, total] = await Promise.all([
      db.cyberbullyingNotification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, type: true, severity: true, entityType: true, entityId: true, incidentId: true, createdAt: true, readAt: true, dismissedAt: true } }),
      db.cyberbullyingNotification.count({ where }),
    ]);
    return { items: rows.map(toVM), total, page, pageSize };
  });
}

/** Unread, non-dismissed count for the bell. One efficient query. */
export async function countUnreadNotifications(actor: IncidentActorContext): Promise<number> {
  return withTenant(actor.tenantId, (db) => db.cyberbullyingNotification.count({ where: { tenantId: actor.tenantId, recipientUserId: actor.userId, readAt: null, dismissedAt: null } }));
}

async function ownNotification(db: Tx, actor: IncidentActorContext, notificationId: string): Promise<{ id: string }> {
  const n = await db.cyberbullyingNotification.findFirst({ where: { id: notificationId, tenantId: actor.tenantId, recipientUserId: actor.userId }, select: { id: true } });
  if (!n) throw new NotificationError("not_found"); // cross-user / cross-tenant ⇒ not found (fail-closed)
  return n;
}

export async function markCyberbullyingNotificationRead(actor: IncidentActorContext, notificationId: string): Promise<void> {
  await withTenant(actor.tenantId, async (db) => {
    await ownNotification(db, actor, notificationId);
    await db.cyberbullyingNotification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
    await db.auditLog.create({ data: { tenantId: actor.tenantId, event: CYBERBULLYING_AUDIT_EVENTS.notificationRead, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: "notification", targetId: notificationId, metadata: {} as never } });
  });
}

export async function markNotificationUnread(actor: IncidentActorContext, notificationId: string): Promise<void> {
  await withTenant(actor.tenantId, async (db) => {
    await ownNotification(db, actor, notificationId);
    await db.cyberbullyingNotification.update({ where: { id: notificationId }, data: { readAt: null } });
  });
}

/** Dismiss (never deletes — the row stays auditable). */
export async function dismissNotification(actor: IncidentActorContext, notificationId: string): Promise<void> {
  await withTenant(actor.tenantId, async (db) => {
    await ownNotification(db, actor, notificationId);
    await db.cyberbullyingNotification.update({ where: { id: notificationId }, data: { dismissedAt: new Date(), readAt: new Date() } });
    await db.auditLog.create({ data: { tenantId: actor.tenantId, event: CYBERBULLYING_AUDIT_EVENTS.notificationDismissed, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: "notification", targetId: notificationId, metadata: {} as never } });
  });
}

/** Bounded bulk mark-read for the caller's own notifications. */
export async function markAllCyberbullyingNotificationsRead(actor: IncidentActorContext): Promise<number> {
  return withTenant(actor.tenantId, async (db) => {
    const res = await db.cyberbullyingNotification.updateMany({ where: { tenantId: actor.tenantId, recipientUserId: actor.userId, readAt: null, dismissedAt: null }, data: { readAt: new Date() } });
    return res.count;
  });
}
