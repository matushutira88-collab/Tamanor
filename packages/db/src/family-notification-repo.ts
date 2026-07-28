import { Prisma, NotificationType as PNotifType, NotificationSeverity as PNotifSev } from "@prisma/client";
import {
  FAMILY_NOTIFICATION_TYPES, FAMILY_NOTIFICATION_METADATA_KEYS,
  isFamilyNotificationType, familyNotificationSpec, familyToDbSeverity, familyNotificationDismissible,
  familyNotificationDedupeKey, buildFamilyNotificationMetadata,
  type FamilyNotificationType, type FamilyNotificationMetadata, type FamilyActorContext,
} from "@guardora/core";
import { withTenant } from "./repositories";
import type { TenantTx } from "./tenant-db";

/**
 * FAMILY NOTIFICATIONS V1 — Phase 2 persistence + read/mutation services on the EXISTING tenant-scoped
 * Notification model (RLS-enforced via withTenant; dedupe via the DB unique (tenantId, dedupeKey)). This is the
 * safe API future canonical trigger paths call — it enforces the PERSISTENCE invariants (non-null recipient,
 * catalogue-derived fields, strict allow-listed metadata, per-recipient deterministic dedupe, transaction-safe
 * idempotency). Recipient AUTHORIZATION (who is eligible) is the separate resolver's responsibility; this module
 * NEVER decides eligibility and NEVER falls back to "all members".
 *
 * Business notification behaviour is untouched: Family reads/writes are always filtered to the 13 Family types.
 */

const FAMILY_TYPE_SET: ReadonlySet<string> = new Set(FAMILY_NOTIFICATION_TYPES);
const FAMILY_TYPES_PN = FAMILY_NOTIFICATION_TYPES as unknown as PNotifType[];
const DISMISSIBLE_FAMILY_TYPES_PN = FAMILY_NOTIFICATION_TYPES.filter(familyNotificationDismissible) as unknown as PNotifType[];

// ── Strict privacy validator (defence-in-depth, beyond the soft generic sanitizer) ──────────────
const FORBIDDEN_KEY = /message|content|transcript|\btext\b|body|comment|attachment|screenshot|file|child|guardian|name|email|token|dob|date.?of.?birth|age|birth|location|note|reason.?text|reviewer|authority.?note|consent.?note|evidence|narrative|platform.?subject|stripe|customer|invoice|price|secret|password/i;
const ALLOWED_KEYS: ReadonlySet<string> = new Set(FAMILY_NOTIFICATION_METADATA_KEYS);

/**
 * Fail-closed: the persisted metadata may contain ONLY the exact Family allow-list keys, all scalar. Any key
 * outside the list, any forbidden-resembling key, and any nested object/array is REJECTED (throws). This is the
 * last line of defence — a Family notification can never carry a message, name, email, token, note or raw content.
 */
export function assertFamilyNotificationMetadata(meta: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(meta)) {
    if (!ALLOWED_KEYS.has(k)) throw new Error(`family_notif_metadata:key_not_allowed:${k.slice(0, 40)}`);
    if (FORBIDDEN_KEY.test(k)) throw new Error(`family_notif_metadata:forbidden_key:${k.slice(0, 40)}`);
    if (v !== null && (typeof v === "object" || Array.isArray(v))) throw new Error(`family_notif_metadata:non_scalar:${k.slice(0, 40)}`);
  }
}

// ── Creation primitive (transaction-aware) ───────────────────────────────────────
export interface CreateFamilyNotificationInput {
  tenantId: string;
  type: string;
  entityId: string;
  profileId?: string | null;
  /** Lifecycle/event discriminator — a NEW version = a new notification; the SAME version = an idempotent retry. */
  eventVersion: string | number;
  safeReasonCode?: string | null;
  occurredAt?: Date | null;
  /**
   * The RESOLVED, server-authoritative eligible recipient user IDs (from the Family recipient resolver). This
   * primitive enforces persistence invariants only; it NEVER derives or widens recipients. Empty ⇒ zero rows.
   */
  recipientUserIds: readonly string[];
}
export interface CreateFamilyNotificationResult { created: number; recipients: number }

/**
 * Create one Family notification per RESOLVED recipient, inside the caller's transaction `tx` (so it is atomic
 * with the triggering domain event and a rollback leaves NO orphan). Idempotency is transaction-safe via
 * `createMany({ skipDuplicates: true })` — a retry of the same (recipient, event, version) inserts nothing and
 * NEVER aborts the surrounding transaction (no caught unique-violation inside an open tx). Fail-closed on an
 * unknown type or a null/blank recipient. All catalogue fields (severity/title/message/route) + strict metadata
 * are derived here; the caller cannot override them.
 */
export async function createFamilyNotificationTx(tx: TenantTx, input: CreateFamilyNotificationInput): Promise<CreateFamilyNotificationResult> {
  if (!isFamilyNotificationType(input.type)) throw new Error(`family_notif:unknown_type:${String(input.type).slice(0, 40)}`);
  const spec = familyNotificationSpec(input.type);
  const recipients = [...new Set(input.recipientUserIds)].filter((u) => typeof u === "string" && u.length > 0).sort();
  if (recipients.length !== new Set(input.recipientUserIds).size) throw new Error("family_notif:null_or_blank_recipient");
  if (recipients.length === 0) return { created: 0, recipients: 0 };

  const rows = recipients.map((recipientUserId) => {
    const metadata: FamilyNotificationMetadata = buildFamilyNotificationMetadata({
      type: input.type as FamilyNotificationType,
      entityId: input.entityId,
      profileId: input.profileId ?? null,
      createdAt: input.occurredAt ?? null,
      safeReasonCode: input.safeReasonCode ?? null,
    });
    assertFamilyNotificationMetadata(metadata as unknown as Record<string, unknown>);
    return {
      tenantId: input.tenantId,
      userId: recipientUserId,                 // ALWAYS non-null for a Family notification
      type: input.type as PNotifType,
      severity: familyToDbSeverity(spec.severity) as PNotifSev,
      titleKey: spec.titleKey,                 // catalogue-controlled; caller cannot supply
      messageKey: spec.messageKey,             // catalogue-controlled
      metadata: metadata as unknown as Prisma.InputJsonValue,
      dedupeKey: familyNotificationDedupeKey({ type: input.type as FamilyNotificationType, recipientUserId, entityType: spec.entityType, entityId: input.entityId, version: input.eventVersion }),
    } satisfies Prisma.NotificationCreateManyInput;
  });

  const res = await tx.notification.createMany({ data: rows, skipDuplicates: true });
  return { created: res.count, recipients: recipients.length };
}

/** Non-transactional convenience: opens a tenant-scoped transaction and creates. Prefer the *Tx form inside a
 *  canonical domain transaction so notification creation is atomic with the triggering event. */
export async function createFamilyNotification(input: CreateFamilyNotificationInput): Promise<CreateFamilyNotificationResult> {
  return withTenant(input.tenantId, (db) => createFamilyNotificationTx(db, input));
}

// ── Read / list ──────────────────────────────────────────────────────────────────
export interface FamilyNotificationView {
  id: string;
  type: FamilyNotificationType;
  severity: PNotifSev;
  titleKey: string;
  messageKey: string;
  createdAt: Date;
  read: boolean;
  entityType: string | null;
  safeRoute: string | null;
  profileId: string | null;
  /** A malformed/legacy row is surfaced as unavailable rather than rendering arbitrary content. */
  unavailable: boolean;
}

const LIST_SELECT = { id: true, type: true, severity: true, titleKey: true, messageKey: true, metadata: true, createdAt: true, readAt: true } satisfies Prisma.NotificationSelect;

function toView(row: Prisma.NotificationGetPayload<{ select: typeof LIST_SELECT }>): FamilyNotificationView {
  const base = { id: row.id, type: row.type as FamilyNotificationType, severity: row.severity, titleKey: row.titleKey, messageKey: row.messageKey, createdAt: row.createdAt, read: row.readAt != null };
  const m = row.metadata as unknown;
  // Safe projection: only known scalar fields; anything unexpected ⇒ unavailable (never render arbitrary content).
  if (!m || typeof m !== "object" || Array.isArray(m)) return { ...base, entityType: null, safeRoute: null, profileId: null, unavailable: true };
  const meta = m as Record<string, unknown>;
  const entityType = typeof meta.entityType === "string" ? meta.entityType : null;
  const safeRoute = typeof meta.safeRoute === "string" && /^\/family(\/[a-z]+)?$/.test(meta.safeRoute) ? meta.safeRoute : null;
  const profileId = typeof meta.profileId === "string" ? meta.profileId : null;
  const unavailable = !isFamilyNotificationType(row.type) || safeRoute === null || entityType === null;
  return { ...base, entityType, safeRoute, profileId, unavailable };
}

export interface ListFamilyNotificationsOpts { limit?: number; before?: Date; unreadOnly?: boolean }

/**
 * The signed-in Family recipient's notifications — newest-first with a stable id tie-break, EXCLUDING dismissed
 * rows, filtered to the 13 Family types + this recipient in the active tenant. Business + tenant-wide (userId
 * null) notifications can never appear here. Keyset paginated by (createdAt, id). Returns a safe projection.
 */
export function listFamilyNotifications(actor: FamilyActorContext, opts: ListFamilyNotificationsOpts = {}): Promise<FamilyNotificationView[]> {
  const take = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  return withTenant(actor.tenantId, async (db) => {
    const rows = await db.notification.findMany({
      where: {
        tenantId: actor.tenantId, userId: actor.userId, type: { in: FAMILY_TYPES_PN }, dismissedAt: null,
        ...(opts.unreadOnly ? { readAt: null } : {}),
        ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take, select: LIST_SELECT,
    });
    return rows.map(toView);
  });
}

/** Unread Family notifications for the signed-in recipient (active tenant, Family types, not read, not dismissed). */
export function familyUnreadNotificationCount(actor: FamilyActorContext): Promise<number> {
  return withTenant(actor.tenantId, (db) => db.notification.count({
    where: { tenantId: actor.tenantId, userId: actor.userId, type: { in: FAMILY_TYPES_PN }, readAt: null, dismissedAt: null },
  }));
}

// ── Mutations (server-authoritative; own-recipient + tenant scoped) ──────────────
/** Mark ONE Family notification read (own-recipient, active tenant, Family type, not dismissed). Idempotent. Returns rows changed. */
export function markFamilyNotificationRead(actor: FamilyActorContext, notificationId: string, now: Date = new Date()): Promise<number> {
  return withTenant(actor.tenantId, async (db) =>
    (await db.notification.updateMany({ where: { id: notificationId, tenantId: actor.tenantId, userId: actor.userId, type: { in: FAMILY_TYPES_PN }, dismissedAt: null, readAt: null }, data: { readAt: now } })).count);
}

/** Mark ALL of the signed-in recipient's non-dismissed Family notifications read (active tenant only). Returns count changed. */
export function markAllFamilyNotificationsRead(actor: FamilyActorContext, now: Date = new Date()): Promise<number> {
  return withTenant(actor.tenantId, async (db) =>
    (await db.notification.updateMany({ where: { tenantId: actor.tenantId, userId: actor.userId, type: { in: FAMILY_TYPES_PN }, dismissedAt: null, readAt: null }, data: { readAt: now } })).count);
}

export type DismissFamilyNotificationResult = { ok: true; changed: number } | { ok: false; reason: "not_dismissible_or_not_found" };

/**
 * Soft-dismiss a Family notification (sets dismissedAt; NEVER deletes — the audit row stays). Allowed ONLY for
 * own-recipient, active tenant, a DISMISSIBLE Family type (urgent safety types are not dismissible). Idempotent:
 * a repeat sets nothing more. A non-dismissible or non-owned/other-tenant id fails closed WITHOUT revealing existence.
 */
export function dismissFamilyNotification(actor: FamilyActorContext, notificationId: string, now: Date = new Date()): Promise<DismissFamilyNotificationResult> {
  return withTenant(actor.tenantId, async (db) => {
    const already = await db.notification.count({ where: { id: notificationId, tenantId: actor.tenantId, userId: actor.userId, type: { in: DISMISSIBLE_FAMILY_TYPES_PN }, dismissedAt: { not: null } } });
    if (already > 0) return { ok: true, changed: 0 } as const; // idempotent repeat
    const changed = (await db.notification.updateMany({ where: { id: notificationId, tenantId: actor.tenantId, userId: actor.userId, type: { in: DISMISSIBLE_FAMILY_TYPES_PN }, dismissedAt: null }, data: { dismissedAt: now } })).count;
    return changed > 0 ? { ok: true, changed } as const : { ok: false, reason: "not_dismissible_or_not_found" } as const;
  });
}

/** Whether a string is one of the 13 Family notification types (for source/guard use). */
export function isFamilyNotificationDbType(v: unknown): boolean {
  return typeof v === "string" && FAMILY_TYPE_SET.has(v);
}
