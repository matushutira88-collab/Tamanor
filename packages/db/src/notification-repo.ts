import { Prisma, NotificationType as PNotifType, NotificationSeverity as PNotifSev } from "@prisma/client";
import {
  DEFAULT_NOTIFICATION_SEVERITY, sanitizeNotificationMetadata,
  type NotificationType, type NotificationSeverity,
} from "@guardora/core";
import { withTenant } from "./repositories";

/**
 * V1.70 (Release B / B2) — tenant-scoped notification repository. Every call runs inside withTenant, so
 * RLS (enable + FORCE + tenant_isolation policy) guarantees a member can never read/write another tenant's
 * notifications. Creation is DEDUPE-aware (unique (tenantId, dedupeKey) → a repeating cycle no-ops instead
 * of spamming) and metadata is sanitized (no tokens/payloads). Delivery: userId=null is tenant-wide (all
 * members see it); a specific userId targets one member.
 */

export type CreateNotificationInput = {
  tenantId: string;
  userId?: string | null;
  type: NotificationType;
  severity?: NotificationSeverity;
  titleKey: string;
  messageKey: string;
  metadata?: Record<string, unknown>;
  dedupeKey: string;
};
export type CreateNotificationResult = { created: boolean; id: string | null };

const LIST_SELECT = {
  id: true, type: true, severity: true, titleKey: true, messageKey: true, metadata: true,
  createdAt: true, readAt: true,
} satisfies Prisma.NotificationSelect;
export type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof LIST_SELECT }>;

/** Rows a given member may see: tenant-wide (userId null) OR addressed to them. */
function visibleTo(userId: string | null | undefined): Prisma.NotificationWhereInput {
  return userId ? { OR: [{ userId: null }, { userId }] } : { userId: null };
}

/**
 * Create a notification. On a (tenantId, dedupeKey) conflict it is a NO-OP (created:false) — the dedupe
 * guard. On any other DB error it THROWS, so callers on hot paths (sync / moderation / webhook) MUST wrap
 * this best-effort (`.catch`) — a notification failure must never break those paths. Metadata is sanitized.
 */
export async function createNotification(input: CreateNotificationInput): Promise<CreateNotificationResult> {
  try {
    return await withTenant(input.tenantId, async (db) => {
      const row = await db.notification.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          type: input.type as PNotifType,
          severity: (input.severity ?? DEFAULT_NOTIFICATION_SEVERITY[input.type]) as PNotifSev,
          titleKey: input.titleKey,
          messageKey: input.messageKey,
          metadata: sanitizeNotificationMetadata(input.metadata) as Prisma.InputJsonValue,
          dedupeKey: input.dedupeKey,
        },
        select: { id: true },
      });
      return { created: true, id: row.id };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { created: false, id: null };
    throw e;
  }
}

/** Unread count for a member (tenant-wide + addressed). Drives the nav badge. */
export async function unreadNotificationCount(tenantId: string, userId: string): Promise<number> {
  return withTenant(tenantId, (db) => db.notification.count({ where: { tenantId, readAt: null, ...visibleTo(userId) } }));
}

/** Paginated inbox (newest first), keyset by createdAt. `before` continues after the oldest shown. */
export async function listNotifications(
  tenantId: string, userId: string, opts: { limit?: number; before?: Date; unreadOnly?: boolean } = {},
): Promise<NotificationRow[]> {
  return withTenant(tenantId, (db) => db.notification.findMany({
    where: {
      tenantId, ...visibleTo(userId),
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(opts.limit ?? 30, 1), 100),
    select: LIST_SELECT,
  }));
}

/** Mark one notification read (only if visible to this member). Returns rows changed (0 = not visible). */
export async function markNotificationRead(tenantId: string, id: string, userId: string, now: Date = new Date()): Promise<number> {
  return withTenant(tenantId, async (db) =>
    (await db.notification.updateMany({ where: { id, tenantId, readAt: null, ...visibleTo(userId) }, data: { readAt: now } })).count);
}

/** Mark all of a member's visible notifications read. Returns the count changed. */
export async function markAllNotificationsRead(tenantId: string, userId: string, now: Date = new Date()): Promise<number> {
  return withTenant(tenantId, async (db) =>
    (await db.notification.updateMany({ where: { tenantId, readAt: null, ...visibleTo(userId) }, data: { readAt: now } })).count);
}

/** Stamp emailSentAt (idempotent — only sets it once). Used by the critical-email path. */
export async function markNotificationEmailSent(tenantId: string, id: string, now: Date = new Date()): Promise<void> {
  await withTenant(tenantId, (db) => db.notification.updateMany({ where: { id, tenantId, emailSentAt: null }, data: { emailSentAt: now } }));
}
