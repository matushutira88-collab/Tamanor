import { requireSession } from "@/server/auth";
import { listNotifications, type NotificationRow } from "@guardora/db";
import type { NotificationType, NotificationSeverity } from "@guardora/core";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { markNotificationReadAction, markAllNotificationsReadAction } from "./actions";

export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<NotificationSeverity, "ok" | "warn" | "danger" | "neutral"> = {
  info: "neutral", warning: "warn", critical: "danger",
};

export default async function NotificationsPage() {
  const session = await requireSession();
  const t = await getT();
  const c = t.notifications;
  const items: NotificationRow[] = await listNotifications(session.tenantId, session.userId, { limit: 50 });
  const hasUnread = items.some((n) => n.readAt === null);

  return (
    <>
      <PageHeader
        eyebrow="🔔"
        title={c.title}
        description={c.subtitle}
        action={
          hasUnread ? (
            <form action={markAllNotificationsReadAction}>
              <button type="submit" className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:border-[var(--color-border-strong)]">
                {c.markAllRead}
              </button>
            </form>
          ) : null
        }
      />

      {items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-[var(--color-muted)]" data-testid="notif-empty">{c.empty}</Card>
      ) : (
        <div className="space-y-2" data-testid="notif-list">
          {items.map((n) => {
            const nt = t.notif[n.type as NotificationType];
            const unread = n.readAt === null;
            return (
              <Card key={n.id} className={`flex flex-wrap items-start justify-between gap-3 p-4 ${unread ? "border-l-2 border-l-[var(--color-brand)]" : ""}`} data-unread={unread ? "true" : "false"}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEVERITY_TONE[n.severity as NotificationSeverity]}>{n.severity}</Badge>
                    <span className="font-medium">{nt?.title ?? n.titleKey}</span>
                    {unread ? <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-brand)]" aria-label={c.unread} /> : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">{nt?.body ?? n.messageKey}</p>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">{formatDateTime(n.createdAt)}</p>
                </div>
                {unread ? (
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-border-strong)]">
                      {c.markRead}
                    </button>
                  </form>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
