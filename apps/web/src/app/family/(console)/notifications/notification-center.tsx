"use client";

/**
 * FAMILY NOTIFICATION CENTER V1 — the accessible in-app center (client island). All data arrives PRE-PROJECTED as
 * safe view models (no ids beyond the notification id, no raw metadata/type/reason). Filters + the initial page
 * are URL-driven and server-rendered; this component adds keyboard-accessible mutations (mark read / mark all /
 * dismiss / open) with an aria-live result region, and client-accumulating "Load more" via a bounded server
 * action. No polling, no websocket, no direct DB access, no dangerous HTML.
 */
import { useState, useRef, useTransition, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FAMILY_FOCUS } from "../../family-ui";
import type { FamilyNotifDict } from "../../family-notifications-i18n";
import type { FamilyNotificationCardVM } from "../../family-notification-view";
import {
  markFamilyNotificationReadAction, dismissFamilyNotificationAction, markAllFamilyNotificationsReadAction,
  openFamilyNotificationAction, fetchMoreFamilyNotificationsAction,
} from "./actions";

const TONE: Record<FamilyNotificationCardVM["severity"], string> = {
  info: "border-[var(--color-border)]",
  attention: "border-amber-400/70",
  urgent: "border-[var(--color-danger)]",
};
const SEV_GLYPH: Record<FamilyNotificationCardVM["severity"], string> = { info: "●", attention: "▲", urgent: "■" };

function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso.slice(0, 10); }
}

export function FamilyNotificationCenter({
  t, view, initialItems, initialNextCursor, unreadCount,
}: {
  t: FamilyNotifDict;
  view: "all" | "unread";
  initialItems: FamilyNotificationCardVM[];
  initialNextCursor: string | null;
  unreadCount: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState<FamilyNotificationCardVM[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialNextCursor);
  const [announce, setAnnounce] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLUListElement>(null);

  const refresh = useCallback(() => router.refresh(), [router]);

  const doMarkRead = (id: string) => startTransition(async () => {
    const fd = new FormData(); fd.set("notificationId", id);
    const r = await markFamilyNotificationReadAction({ status: "idle" }, fd);
    setAnnounce(r.status === "read" ? t.center.markedRead : t.center.error);
    if (r.status === "read") { setItems((xs) => xs.map((x) => (x.id === id ? { ...x, read: true } : x))); refresh(); }
  });
  const doDismiss = (id: string) => startTransition(async () => {
    const fd = new FormData(); fd.set("notificationId", id);
    const r = await dismissFamilyNotificationAction({ status: "idle" }, fd);
    setAnnounce(r.status === "dismissed" ? t.center.dismissed : t.center.error);
    if (r.status === "dismissed") { setItems((xs) => xs.filter((x) => x.id !== id)); refresh(); }
  });
  const doMarkAll = () => startTransition(async () => {
    const r = await markAllFamilyNotificationsReadAction({ status: "idle" }, new FormData());
    setAnnounce(r.status === "readall" ? t.center.markedAllRead : t.center.error);
    if (r.status === "readall") { setItems((xs) => xs.map((x) => ({ ...x, read: true }))); refresh(); }
  });
  const loadMore = () => { if (!cursor) return; startTransition(async () => {
    const page = await fetchMoreFamilyNotificationsAction(view, cursor);
    setItems((xs) => [...xs, ...page.items]);
    setCursor(page.nextCursor);
    // Move focus to the first newly-appended item for keyboard continuity.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`li[data-appended="true"]`)?.focus());
  }); };

  const tab = (key: "all" | "unread", label: string) => (
    <Link
      href={key === "all" ? "/family/notifications" : "/family/notifications?view=unread"}
      aria-current={view === key ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${FAMILY_FOCUS} ${view === key ? "bg-[var(--color-fg)] text-[var(--color-bg)] underline underline-offset-4" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}
    >{label}{key === "unread" && unreadCount > 0 ? ` (${unreadCount >= 100 ? "99+" : unreadCount})` : ""}</Link>
  );

  return (
    <section className="space-y-5">
      <div aria-live="polite" role="status" className="sr-only">{announce}</div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t.center.title} className="flex flex-wrap gap-1">
          {tab("all", t.center.tabAll)}
          {tab("unread", t.center.tabUnread)}
        </div>
        <button
          type="button" onClick={doMarkAll} disabled={pending || unreadCount === 0}
          className={`rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm ${FAMILY_FOCUS} disabled:cursor-not-allowed disabled:opacity-50 ${unreadCount === 0 ? "hidden" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}
        >{t.center.markAllRead}</button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-sm text-[var(--color-muted)]">
          {view === "unread" ? t.center.emptyUnread : t.center.empty}
        </p>
      ) : (
        <ul ref={listRef} className="space-y-3" aria-label={t.center.title}>
          {items.map((n, i) => (
            <li
              key={n.id} tabIndex={-1} data-appended={i >= initialItems.length ? "true" : undefined}
              className={`rounded-lg border-l-4 ${TONE[n.severity]} border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4 ${FAMILY_FOCUS}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span aria-hidden="true" className="text-xs">{SEV_GLYPH[n.severity]}</span>
                    <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{n.severityLabel}</span>
                    {!n.read && <span className="rounded-full bg-[var(--color-fg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-bg)]">{t.center.tabUnread}</span>}
                  </div>
                  <p className="mt-1.5 font-medium text-[var(--color-fg)]">{n.title}</p>
                  {n.message && <p className="mt-0.5 text-sm text-[var(--color-muted)]">{n.message}</p>}
                  <time dateTime={n.createdAtISO} className="mt-1 block text-xs text-[var(--color-muted)]">{fmtTime(n.createdAtISO)}</time>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {n.ctaHref && (
                  <button type="submit" onClick={() => { const fd = new FormData(); fd.set("notificationId", n.id); startTransition(() => openFamilyNotificationAction(fd)); }}
                    className={`rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-fg)] hover:border-[var(--color-fg)] ${FAMILY_FOCUS}`}>{t.center.open}</button>
                )}
                {!n.read && (
                  <button type="button" onClick={() => doMarkRead(n.id)} disabled={pending}
                    className={`rounded-md px-2.5 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)] disabled:opacity-50 ${FAMILY_FOCUS}`}>{t.center.markRead}</button>
                )}
                {n.dismissible && (
                  <button type="button" onClick={() => doDismiss(n.id)} disabled={pending}
                    className={`rounded-md px-2.5 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-danger)] disabled:opacity-50 ${FAMILY_FOCUS}`}>{t.center.dismiss}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <div className="flex justify-center">
          <button type="button" onClick={loadMore} disabled={pending}
            className={`rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)] disabled:opacity-50 ${FAMILY_FOCUS}`}>
            {pending ? t.center.loading : t.center.loadMore}
          </button>
        </div>
      )}
    </section>
  );
}
