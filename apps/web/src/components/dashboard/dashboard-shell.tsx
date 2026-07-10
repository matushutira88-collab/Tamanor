"use client";

import { useState } from "react";
import { Logo } from "@/components/logo";
import { Sidebar } from "./sidebar";

export function DashboardShell({
  tenantName,
  userName,
  role,
  trialUsed,
  trialLimit,
  demo = false,
  navLabels,
  sidebarStrings,
  children,
}: {
  tenantName: string;
  userName: string;
  role: string;
  trialUsed: number;
  trialLimit: number;
  demo?: boolean;
  navLabels?: Record<string, string>;
  sidebarStrings?: Record<string, string>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sidebarProps = { tenantName, userName, role, trialUsed, trialLimit, demo, navLabels, sidebarStrings };

  return (
    // V1.28B — fixed app shell: the sidebar stays put (h-dvh) while ONLY the main
    // content scrolls (overflow-y-auto below). No body scroll, no horizontal overflow.
    <div className="flex h-dvh overflow-hidden bg-[var(--color-bg)]">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar {...sidebarProps} />
      </div>

      {/* Mobile off-canvas drawer */}
      <div className={`fixed inset-0 z-40 lg:hidden ${open ? "" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          onClick={() => setOpen(false)}
        />
        <div
          className={`absolute inset-y-0 left-0 transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}
        >
          <Sidebar {...sidebarProps} onNavigate={() => setOpen(false)} />
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Logo />
        </div>

        <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 lg:py-9">{children}</div>
      </div>
    </div>
  );
}
