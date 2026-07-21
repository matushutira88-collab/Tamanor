import Link from "next/link";
import { PageHeader, Card, Badge, EmptyState } from "@/components/dashboard/ui";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { getLocale } from "@/i18n/locale-server";
import { listNotifications } from "@guardora/db";
import { CB_COPY } from "../cb-i18n";
import { markNotificationReadAction, dismissNotificationAction, markAllReadAction } from "./actions";

export const dynamic = "force-dynamic";

const sevTone = (s: string): "danger" | "warn" | "neutral" => (s === "urgent" ? "danger" : s === "attention" ? "warn" : "neutral");

export default async function NotificationCenterPage({ searchParams }: { searchParams: Promise<{ filter?: string; n?: string; page?: string }> }) {
  const locale = await getLocale();
  const session = await requireVerifiedSession();
  const cap = await requireDashboardCapability("cyberbullyingProtection");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;

  const t = CB_COPY[locale];
  const n = t.notif;
  const sp = await searchParams;
  const filter = sp.filter === "unread" ? "unread" : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const result = await listNotifications(actor, { filter, page });
  const banner = sp.n ? (n.banner[sp.n as keyof typeof n.banner] ?? null) : null;
  const BTN = "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]";
  const back = "/dashboard/security/cyberbullying/notifications";

  return (
    <>
      <PageHeader eyebrow="Security · Cyberbullying" title={n.center} description={n.subtitle}
        action={<Link href="/dashboard/security/cyberbullying" className="text-sm font-semibold text-[var(--color-brand)] hover:underline">← {t.overviewTitle}</Link>} />

      {banner ? <div role="status" aria-live="polite" className="mb-4 rounded-lg border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-sm text-[var(--color-ok)]"><span aria-hidden="true">✓</span> {banner}</div> : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`${back}?filter=all`} aria-current={filter === "all" ? "true" : undefined} className={`${BTN} ${filter === "all" ? "border-[var(--color-brand)] text-[var(--color-brand)]" : ""}`}>{n.all}</Link>
        <Link href={`${back}?filter=unread`} aria-current={filter === "unread" ? "true" : undefined} className={`${BTN} ${filter === "unread" ? "border-[var(--color-brand)] text-[var(--color-brand)]" : ""}`}>{n.unread}</Link>
        <form action={markAllReadAction} className="ml-auto"><button type="submit" className={BTN}>{n.markAllRead}</button></form>
      </div>

      {result.items.length === 0 ? (
        <EmptyState title={n.empty} body={n.subtitle} />
      ) : (
        <ul className="space-y-2">
          {result.items.map((item) => (
            <li key={item.id}>
              <Card className={item.readAt ? "" : "border-[var(--color-brand)]"}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={sevTone(item.severity)}>{n.severity[item.severity as keyof typeof n.severity] ?? item.severity}</Badge>
                      <span className="text-sm font-semibold text-[var(--color-fg)]">{n.type[item.type as keyof typeof n.type] ?? item.type}</span>
                      {!item.readAt ? <span className="rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-brand-fg)]">{n.unread}</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-muted)]">{new Date(item.createdAt).toISOString().slice(0, 16).replace("T", " ")}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.incidentId ? <Link href={`/dashboard/security/cyberbullying/incidents/${item.incidentId}`} className={BTN}>{n.open}</Link> : null}
                    {!item.readAt ? <form action={markNotificationReadAction}><input type="hidden" name="notificationId" value={item.id} /><input type="hidden" name="back" value={back} /><button type="submit" className={BTN}>{n.markRead}</button></form> : null}
                    <form action={dismissNotificationAction}><input type="hidden" name="notificationId" value={item.id} /><input type="hidden" name="back" value={back} /><button type="submit" className={BTN}>{n.dismiss}</button></form>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
