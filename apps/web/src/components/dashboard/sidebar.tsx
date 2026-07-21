"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { DASHBOARD_NAV } from "@/lib/nav";
import { formatNumber } from "@/lib/format";
import { NavIconGlyph } from "./nav-icons";
import { signOut } from "@/server/session-actions";
import { LanguageSwitcher } from "@/components/language-switcher";
import { defaultLocale, type Locale } from "@/i18n/config";

export function Sidebar({
  tenantName,
  userName,
  role,
  trialUsed,
  trialLimit,
  planName,
  accountsUsed = 0,
  accountsLimit = null,
  pendingCount = 0,
  unreadNotifications = 0,
  demo = false,
  locale = defaultLocale,
  navLabels,
  sidebarStrings,
  deniedNavHrefs,
  onNavigate,
}: {
  tenantName: string;
  userName: string;
  role: string;
  trialUsed: number;
  trialLimit: number;
  /** V1.60 — plan widget: current plan display name (e.g. "Business", "Free trial"). */
  planName?: string;
  /** V1.60 — plan widget: connected accounts used / plan limit (null = unlimited). */
  accountsUsed?: number;
  accountsLimit?: number | null;
  /** V1.60 — red badge on the Alerts nav item (pending decisions). */
  pendingCount?: number;
  /** V1.70 (B2) — unread product-notification count for the header bell badge. */
  unreadNotifications?: number;
  demo?: boolean;
  locale?: Locale;
  navLabels?: Record<string, string>;
  sidebarStrings?: Record<string, string>;
  /**
   * S0 — hrefs the current role may NOT access (computed server-side via `can()`
   * in the dashboard layout, so RBAC/permission logic never enters the client
   * bundle). The page still enforces access authoritatively; this only hides the
   * link. NOT plan-based: an item stays visible when the role has the permission
   * but the plan lacks the entitlement (page shows CapabilityLockedState).
   */
  deniedNavHrefs?: string[];
  onNavigate?: () => void;
}) {
  const s = sidebarStrings ?? {};
  const pathname = usePathname();
  const denied = new Set(deniedNavHrefs ?? []);
  const visibleNav = DASHBOARD_NAV.filter((n) => !n.hidden && !denied.has(n.href));
  const cleanTenant = tenantName.replace(/\[MOCK\]\s*/i, "");
  const pct = Math.min(100, Math.round((trialUsed / trialLimit) * 100));
  const accountsPct = accountsLimit ? Math.min(100, Math.round((accountsUsed / accountsLimit) * 100)) : 0;

  return (
    <aside className="gu-sidebar flex h-dvh w-[248px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-soft)]">
      <div className="flex h-16 items-center justify-between px-5">
        <Link href="/">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          {demo ? (
            <span className="rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand-strong)] ring-1 ring-inset ring-current/20">
              Demo
            </span>
          ) : null}
          {/* V1.70 (B2) — notification bell with unread badge. */}
          <Link href="/dashboard/notifications" onClick={onNavigate} aria-label={s.notifications ?? "Notifications"} title={s.notifications ?? "Notifications"} className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]">
            <span aria-hidden className="text-base">🔔</span>
            {unreadNotifications > 0 ? (
              <span data-testid="notif-badge" className="absolute -right-0.5 -top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[10px] font-semibold text-white">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            ) : null}
          </Link>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        {/* V1.28B — production nav: hidden entries are filtered out (routes remain).
            S0 — plus RBAC-gated entries the role can't access. */}
        {visibleNav.map((item, i, visible) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          const showGroup =
            item.group && item.group !== visible[i - 1]?.group;
          return (
            <div key={item.href}>
              {showGroup ? (
                <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
                  {item.group}
                </p>
              ) : null}
              <Link
                href={item.href}
                onClick={onNavigate}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-[var(--color-brand-soft)] font-semibold text-[var(--color-brand-strong)] ring-1 ring-inset ring-current/20 before:absolute before:left-0 before:top-1/2 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-[var(--color-brand)]"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                }`}
              >
                <span
                  className={
                    active
                      ? "text-[var(--color-brand)]"
                      : "text-[var(--color-muted)] group-hover:text-[var(--color-fg)]"
                  }
                >
                  <NavIconGlyph icon={item.icon} />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {navLabels?.[item.navKey ?? item.icon] ?? item.label}
                </span>
                {item.href === "/dashboard/action-queue" && pendingCount > 0 ? (
                  <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-danger)] px-1.5 text-[11px] font-bold leading-none text-white">
                    {pendingCount > 99 ? "99+" : pendingCount}
                  </span>
                ) : null}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* V1.60 — plan widget (mockup): "Your plan · <name>", accounts used bar,
          items-processed bar, upgrade CTA. */}
      <div className="px-3">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-[11px] font-medium text-[var(--color-muted)]">
            {s.yourPlan ?? "Your plan"}
          </p>
          <div className="mt-0.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--color-fg)]">
              {planName ?? s.freeTrial ?? "Free trial"}
            </span>
            <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-brand)]">
              {s.beta ?? "Beta"}
            </span>
          </div>

          {accountsLimit ? (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
                <span>{s.accountsUsed ?? "Accounts"}</span>
                <span className="font-medium text-[var(--color-fg)]">
                  {accountsUsed} / {accountsLimit}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-accent)]"
                  style={{ width: `${accountsPct}%` }}
                />
              </div>
            </div>
          ) : null}

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
              <span>{s.itemsProcessed ?? "Items processed"}</span>
              <span className="font-medium text-[var(--color-fg)]">
                {formatNumber(trialUsed)} / {formatNumber(trialLimit)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div
                className="h-full rounded-full bg-[var(--color-brand)]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <Link
            href="/dashboard/billing"
            className="mt-3 block rounded-lg bg-[var(--color-brand)] px-3 py-2 text-center text-xs font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]"
          >
            {s.choosePlan ?? "Choose a plan"}
          </Link>
        </div>
      </div>

      {/* Language switcher */}
      <div className="mt-3 flex justify-center border-t border-[var(--color-border)] px-3 pt-3">
        <LanguageSwitcher current={locale} variant="app" />
      </div>

      {/* User box */}
      <div className="mt-1 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-brand)] text-sm font-semibold text-white">
            {(userName || cleanTenant).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="truncate text-xs capitalize text-[var(--color-muted)]">
              {cleanTenant} · {role}
            </p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              title={s.signOut ?? "Sign out"}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
