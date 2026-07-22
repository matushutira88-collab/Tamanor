"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { signOut } from "@/server/session-actions";
import type { FamilyDict } from "./family-i18n";

interface NavItem { href: string; label: string }

export function FamilyShell({ nav, workspaceName, userName, brand, children }: { nav: FamilyDict["nav"]; workspaceName: string; userName: string; brand: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items: NavItem[] = [
    { href: "/family", label: nav.overview },
    { href: "/family/profiles", label: nav.profiles },
    { href: "/family/guardians", label: nav.guardians },
    { href: "/family/authorizations", label: nav.authorizations },
    { href: "/family/signals", label: nav.signals },
    { href: "/family/deliveries", label: nav.deliveries },
    { href: "/family/settings", label: nav.settings },
  ];
  const isActive = (href: string) => (href === "/family" ? pathname === "/family" : pathname.startsWith(href));

  const NavLinks = () => (
    <nav className="flex flex-col gap-0.5" aria-label={brand}>
      {items.map((it) => {
        const active = isActive(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-sm transition ${active ? "bg-[var(--color-brand-soft)] font-semibold text-[var(--color-brand-strong)] ring-1 ring-inset ring-current/20" : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"}`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--color-bg)]">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:flex">
        <div className="mb-6 flex items-center gap-2">
          <Logo />
          <span className="text-sm font-semibold text-[var(--color-fg)]">{brand}</span>
        </div>
        <NavLinks />
        <div className="mt-auto border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-muted)]">
          <div className="truncate font-medium text-[var(--color-fg)]">{workspaceName}</div>
          <div className="truncate">{userName}</div>
        </div>
      </aside>

      {/* Mobile drawer */}
      <div className={`fixed inset-0 z-40 lg:hidden ${open ? "" : "pointer-events-none"}`}>
        <div className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`} onClick={() => setOpen(false)} aria-hidden />
        <div className={`absolute left-0 top-0 h-full w-64 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-transform ${open ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="mb-6 flex items-center gap-2"><Logo /><span className="text-sm font-semibold">{brand}</span></div>
          <NavLinks />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 lg:px-6">
          <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-[var(--color-border)] p-2 lg:hidden" aria-label="Menu">
            <span className="block h-0.5 w-4 bg-current" /><span className="mt-1 block h-0.5 w-4 bg-current" /><span className="mt-1 block h-0.5 w-4 bg-current" />
          </button>
          <span className="text-sm font-semibold text-[var(--color-fg)]">{workspaceName}</span>
          <form action={signOut} className="ml-auto">
            <button type="submit" className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-fg)]">{userName ? "" : ""}Odhlásiť</button>
          </form>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
