"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { signOut } from "@/server/session-actions";
import { FamilyIconGlyph, type FamilyIcon } from "./family-icons";
import { FAMILY_FOCUS } from "./family-ui";
import type { FamilyDict } from "./family-i18n";

interface NavItem { href: string; label: string; icon: FamilyIcon }

/**
 * CS-C6 / FAMILY-UI-01 — the Family app shell. Presentational only: the route group
 * layout has already enforced the FAMILY guard, so this component neither reads nor
 * decides anything about permissions — it renders the nav the layout handed it.
 */
export function FamilyShell({ nav, shell, workspaceName, userName, brand, children }: { nav: FamilyDict["nav"]; shell: FamilyDict["shell"]; workspaceName: string; userName: string; brand: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const items: NavItem[] = [
    { href: "/family", label: nav.overview, icon: "overview" },
    { href: "/family/profiles", label: nav.profiles, icon: "profiles" },
    { href: "/family/guardians", label: nav.guardians, icon: "guardians" },
    { href: "/family/invitations", label: nav.invitations, icon: "invitations" },
    { href: "/family/authorizations", label: nav.authorizations, icon: "authorizations" },
    { href: "/family/signals", label: nav.signals, icon: "signals" },
    { href: "/family/deliveries", label: nav.deliveries, icon: "deliveries" },
    { href: "/family/settings", label: nav.settings, icon: "settings" },
  ];
  const isActive = (href: string) => (href === "/family" ? pathname === "/family" : pathname.startsWith(href));
  const initial = (workspaceName || userName || brand).trim().charAt(0).toUpperCase();

  // Mobile drawer a11y: Escape closes and restores focus to the trigger; opening moves
  // focus into the drawer so keyboard users land inside the menu (mirrors the Business shell).
  useEffect(() => {
    if (!open) return;
    drawerRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const SidebarBody = ({ onNavigate }: { onNavigate?: () => void }) => (
    // Stable width: w-[264px] + shrink-0, so the content column never reflows on
    // long workspace names or nav labels (min-w-0 + truncate below do the clamping).
    <aside className="flex h-dvh w-[264px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-soft)]">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
        <Logo />
        <span className="truncate text-sm font-semibold text-[var(--color-fg)]">{brand}</span>
      </div>

      {/* Workspace identity — the primary "where am I" anchor, readable at a glance. */}
      <div className="px-3 pb-1">
        <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand)] text-sm font-semibold text-[var(--color-brand-fg)]">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">{shell.workspaceLabel}</p>
            <p className="truncate text-sm font-semibold leading-snug text-[var(--color-fg)]" title={workspaceName}>{workspaceName}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label={shell.navLabel}>
        {items.map((it) => {
          const active = isActive(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${FAMILY_FOCUS} ${
                active
                  ? "bg-[var(--color-brand-soft)] font-semibold text-[var(--color-brand-strong)] ring-1 ring-inset ring-current/20 before:absolute before:left-0 before:top-1/2 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-[var(--color-brand)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
              }`}
            >
              <span className={active ? "text-[var(--color-brand)]" : "text-[var(--color-muted)] group-hover:text-[var(--color-fg)]"}>
                <FamilyIconGlyph icon={it.icon} />
              </span>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User block: who is signed in + a single, unambiguous sign-out affordance. */}
      <div className="shrink-0 border-t border-[var(--color-border)] p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-sm font-semibold text-[var(--color-brand-strong)]">
            {(userName || brand).trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[var(--color-fg)]" title={userName}>{userName}</p>
            <p className="truncate text-xs text-[var(--color-muted)]">{shell.signedInAs}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              title={shell.signOut}
              aria-label={shell.signOut}
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] ${FAMILY_FOCUS}`}
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

  return (
    // Fixed app shell: the sidebar stays put (h-dvh) while ONLY the content column
    // scrolls. No body scroll, no horizontal overflow.
    <div className="flex h-dvh overflow-hidden bg-[var(--color-bg)]">
      {/* Desktop sidebar — laptop and up. Tablet/mobile use the drawer below. */}
      <div className="hidden lg:block">
        <SidebarBody />
      </div>

      {/* Mobile / tablet off-canvas drawer */}
      <div className={`fixed inset-0 z-40 lg:hidden ${open ? "" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          onClick={() => setOpen(false)}
          aria-hidden
        />
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label={shell.navLabel}
          className={`absolute inset-y-0 left-0 transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}
        >
          <SidebarBody onNavigate={() => setOpen(false)} />
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* Compact top bar — only where the sidebar is hidden, so the desktop view
            never duplicates the workspace name. */}
        <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 lg:hidden">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label={shell.openMenu}
            aria-expanded={open}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] ${FAMILY_FOCUS}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="min-w-0 truncate text-sm font-semibold text-[var(--color-fg)]">{workspaceName}</span>
        </div>

        {/* Content measure: capped and centred, with gutters that grow with the
            viewport — content never runs into either edge. */}
        <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">{children}</div>
      </div>
    </div>
  );
}
