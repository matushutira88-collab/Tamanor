/**
 * FAMILY NOTIFICATION CENTER V1 — authenticated, server-rendered route (URL `/family/notifications`). The Family
 * route-group layout already enforces an active FAMILY session + membership; here the tenant + user come ONLY
 * from that session (never from the client). The initial page + unread count are fetched server-side via the
 * verified Family services; only the two allowed query params (view, cursor) are read, and both are safely
 * normalized. Data is dynamic (force-dynamic) and never cached.
 */
import type { Metadata } from "next";
import { listFamilyNotifications, familyUnreadNotificationCount } from "@guardora/db";
import { requireFamilyConsole } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader } from "@/components/dashboard/ui";
import { familyNotifDict } from "../../family-notifications-i18n";
import { familyNotificationCardVM } from "../../family-notification-view";
import { decodeFamilyNotificationCursor, encodeFamilyNotificationCursor, normalizeFamilyNotificationView } from "../../family-notification-cursor";
import { FamilyNotificationCenter } from "./notification-center";
import { FAMILY_NOTIFICATIONS_PAGE_SIZE } from "./center-shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications", robots: { index: false, follow: false } };

type SP = { view?: string; cursor?: string };

export default async function FamilyNotificationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { actor } = await requireFamilyConsole();
  const t = familyNotifDict(await getLocale());
  const sp = await searchParams;
  const view = normalizeFamilyNotificationView(sp.view);
  const key = decodeFamilyNotificationCursor(sp.cursor); // invalid/forged → null → first page (never throws)

  const [rows, unreadCount] = await Promise.all([
    listFamilyNotifications(actor, {
      limit: FAMILY_NOTIFICATIONS_PAGE_SIZE,
      unreadOnly: view === "unread",
      ...(key ? { before: key.before, beforeId: key.beforeId } : {}),
    }),
    familyUnreadNotificationCount(actor),
  ]);
  const items = rows.map((r) => familyNotificationCardVM(r, t));
  const last = rows.length === FAMILY_NOTIFICATIONS_PAGE_SIZE ? rows[rows.length - 1]! : null;
  const nextCursor = last ? encodeFamilyNotificationCursor(last.createdAt, last.id) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t.center.title} description={t.center.description} />
      <FamilyNotificationCenter t={t} view={view} initialItems={items} initialNextCursor={nextCursor} unreadCount={unreadCount} />
    </div>
  );
}
