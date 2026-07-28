"use server";

/**
 * FAMILY NOTIFICATION CENTER V1 — server actions. Every action is server-authoritative: the tenantId + userId
 * come ONLY from the authenticated Family session (requireFamilyActor), NEVER from the client. The client submits
 * a notificationId at most; it never chooses tenant, user, type, severity, dismissibility, or a destination URL.
 * Each action delegates to the verified Family services (own-recipient + tenant + Family-type scoped) and returns
 * a BOUNDED result (never a raw error / id / metadata). Read the shared Notification table only via those services.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  markFamilyNotificationRead, markAllFamilyNotificationsRead, dismissFamilyNotification,
  loadFamilyNotificationTypeForOpen, listFamilyNotifications,
} from "@guardora/db";
import { familyNotificationCta } from "@guardora/core";
import { requireFamilyActor } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { familyNotifDict } from "../../family-notifications-i18n";
import { familyNotificationCardVM, IMPLEMENTED_FAMILY_CTA_ROUTES } from "../../family-notification-view";
import { decodeFamilyNotificationCursor, encodeFamilyNotificationCursor, normalizeFamilyNotificationView } from "../../family-notification-cursor";
import { FAMILY_NOTIFICATIONS_PAGE_SIZE, type CenterActionState, type FamilyNotificationPage } from "./center-shared";

const CENTER = "/family/notifications";
const nid = (fd: FormData): string => String(fd.get("notificationId") ?? "").trim();

/** Mark ONE own Family notification read. Idempotent; cross-user/tenant/non-Family fail closed (bounded). */
export async function markFamilyNotificationReadAction(_prev: CenterActionState, fd: FormData): Promise<CenterActionState> {
  const { actor } = await requireFamilyActor();
  const id = nid(fd);
  if (!id) return { status: "error" };
  try { await markFamilyNotificationRead(actor, id); } catch { return { status: "error" }; }
  revalidatePath(CENTER);
  return { status: "read" };
}

/** Mark ALL of the signed-in recipient's non-dismissed Family notifications read (current tenant only). */
export async function markAllFamilyNotificationsReadAction(_prev: CenterActionState, _fd: FormData): Promise<CenterActionState> {
  const { actor } = await requireFamilyActor();
  try { await markAllFamilyNotificationsRead(actor); } catch { return { status: "error" }; }
  revalidatePath(CENTER);
  return { status: "readall" };
}

/** Soft-dismiss an eligible own Family notification. Urgent/non-dismissible + cross-user/tenant fail closed. */
export async function dismissFamilyNotificationAction(_prev: CenterActionState, fd: FormData): Promise<CenterActionState> {
  const { actor } = await requireFamilyActor();
  const id = nid(fd);
  if (!id) return { status: "error" };
  try { const r = await dismissFamilyNotification(actor, id); if (!r.ok) return { status: "error" }; }
  catch { return { status: "error" }; }
  revalidatePath(CENTER);
  return { status: "dismissed" };
}

/**
 * Safe open: the client submits ONLY the notificationId. The server narrow-loads the OWN Family notification's
 * TYPE, derives the destination from the catalogue (never client input / metadata href), re-validates it against
 * the implemented-route allow-list, marks the row read, and redirects to the internal list page. An unavailable /
 * unauthorized / non-allow-listed destination falls back to the center with a bounded status (no id, no leak).
 */
export async function openFamilyNotificationAction(fd: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const id = nid(fd);
  if (!id) redirect(`${CENTER}?e=open`);
  const loaded = await loadFamilyNotificationTypeForOpen(actor, id);
  if (!loaded.ok) redirect(`${CENTER}?e=open`);
  const route = familyNotificationCta(loaded.type);
  if (!IMPLEMENTED_FAMILY_CTA_ROUTES.has(route)) redirect(`${CENTER}?e=open`);
  // Opening a notification marks it read (documented policy: an explicit open is an acknowledgement).
  try { await markFamilyNotificationRead(actor, id); } catch { /* non-fatal: still navigate */ }
  revalidatePath(CENTER);
  redirect(route); // an internal, allow-listed, id-free Family list route
}

/**
 * Load ONE more bounded page for the client's "Load more" (keyset by the client's opaque cursor). Returns the SAFE
 * view models + the next opaque cursor (null when exhausted). Session-authoritative; the client never supplies a
 * tenant/user/filter beyond the two allowed values; an invalid cursor safely starts from the first page.
 */
export async function fetchMoreFamilyNotificationsAction(view: string, cursor: string): Promise<FamilyNotificationPage> {
  const { actor } = await requireFamilyActor();
  const dict = familyNotifDict(await getLocale());
  const key = decodeFamilyNotificationCursor(cursor);
  const rows = await listFamilyNotifications(actor, {
    limit: FAMILY_NOTIFICATIONS_PAGE_SIZE,
    unreadOnly: normalizeFamilyNotificationView(view) === "unread",
    ...(key ? { before: key.before, beforeId: key.beforeId } : {}),
  });
  const items = rows.map((r) => familyNotificationCardVM(r, dict));
  const last = rows.length === FAMILY_NOTIFICATIONS_PAGE_SIZE ? rows[rows.length - 1]! : null;
  return { items, nextCursor: last ? encodeFamilyNotificationCursor(last.createdAt, last.id) : null };
}
