"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { DASHBOARD_NAV } from "@/lib/nav";
import { NavIconGlyph } from "./nav-icons";
import { signOut } from "@/server/session-actions";

export function Sidebar({
  tenantName,
  userName,
  role,
  trialUsed,
  trialLimit,
  demo = false,
  onNavigate,
}: {
  tenantName: string;
  userName: string;
  role: string;
  trialUsed: number;
  trialLimit: number;
  demo?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const cleanTenant = tenantName.replace(/\[MOCK\]\s*/i, "");
  const pct = Math.min(100, Math.round((trialUsed / trialLimit) * 100));

  return (
    <aside className="gu-sidebar flex h-dvh w-[248px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-soft)]">
      <div className="flex h-16 items-center justify-between px-5">
        <Link href="/">
          <Logo />
        </Link>
        {demo ? (
          <span className="rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand-strong)] ring-1 ring-inset ring-current/20">
            Demo
          </span>
        ) : null}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        {DASHBOARD_NAV.map((item, i) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          const showGroup =
            item.group && item.group !== DASHBOARD_NAV[i - 1]?.group;
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
                {item.label}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Trial / billing box */}
      <div className="px-3">
        <div className="rounded-xl border border-[var(--color-border)] bg-gradient-to-b from-[var(--color-brand-soft)] to-[var(--color-surface-2)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--color-fg)]">
              Free trial
            </span>
            <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-brand)]">
              Beta
            </span>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
              <span>Items processed</span>
              <span className="font-medium text-[var(--color-fg)]">
                {trialUsed.toLocaleString()} / {trialLimit.toLocaleString()}
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
            Choose a plan
          </Link>
        </div>
      </div>

      {/* User box */}
      <div className="mt-3 border-t border-[var(--color-border)] p-3">
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
              title="Sign out"
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
