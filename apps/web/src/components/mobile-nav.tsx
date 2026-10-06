"use client";
/**
 * Public header navigation below `xl` (phones, tablets, small laptops). The desktop nav is `hidden xl:flex`
 * (six items do not fit next to the logo, language switch and CTAs at 1024px), so without this the
 * section links were unreachable on smaller screens. A disclosure button opens a full-width panel
 * under the sticky header; it closes on link click, on Escape and on route change.
 */
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export function MobileNav({ label, footer, children }: { label: { open: string; close: string }; footer?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="xl:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? label.close : label.open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-9 w-9 place-items-center rounded-lg text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open ? (
        <nav
          id="mobile-nav-panel"
          // Any link click inside the panel closes it (SectionLink handles the actual navigation).
          onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}
          className="absolute inset-x-0 top-16 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 pb-4 pt-2 shadow-lg"
        >
          <div className="flex flex-col text-base font-medium text-[var(--color-fg)] [&>a]:rounded-lg [&>a]:px-3 [&>a]:py-3 [&>a:hover]:bg-[var(--color-surface-2)]">
            {children}
          </div>
          {footer ? <div className="mt-2 border-t border-[var(--color-border)] px-3 pt-3">{footer}</div> : null}
        </nav>
      ) : null}
    </div>
  );
}

/** Keeps `<html lang>` in sync with the page locale (the root layout is shared and renders "en"). */
export function DocumentLang({ locale }: { locale: string }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
