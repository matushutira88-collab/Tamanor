"use client";

import { useEffect, useRef, useState, useTransition } from "react";

/**
 * V1.66 — first-run welcome for a member whose onboarding is still `not_started`.
 *
 * It is a NON-BLOCKING dialog: the dashboard behind it is fully rendered and the member can dismiss it and
 * carry on. Both choices persist server-side (start -> in_progress, dismiss -> dismissed), so it never
 * reappears for the same member until they explicitly resume — no client-only "seen" flag.
 *
 * Accessibility: role="dialog" + aria-modal, labelled by its heading and described by its body, focus is
 * moved in on open, TRAPPED while open (Tab cycles inside), Escape dismisses, and focus is restored to
 * whatever had it before the dialog opened.
 */
export function OnboardingWelcome({
  copy,
  onStart,
  onDismiss,
}: {
  copy: { welcomeTitle: string; welcomeBody: string; startSetup: string; dismissForNow: string };
  onStart: () => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    primaryRef.current?.focus();
    const restore = restoreRef.current;
    return () => {
      // Return focus to the element that had it before the dialog took over.
      if (restore instanceof HTMLElement && document.contains(restore)) restore.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); close(onDismiss); return; }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      // Trap: wrap around instead of letting focus escape to the page behind.
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  function close(action: () => Promise<void>) {
    setOpen(false);
    startTransition(() => { void action(); });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[color-mix(in_oklab,var(--color-fg),transparent_70%)] p-4 sm:items-center">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onb-welcome-title"
        aria-describedby="onb-welcome-body"
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl"
      >
        <h2 id="onb-welcome-title" className="gu-display text-xl">{copy.welcomeTitle}</h2>
        <p id="onb-welcome-body" className="mt-2 text-sm text-[var(--color-muted)]">{copy.welcomeBody}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={() => close(onDismiss)}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--color-muted)] transition hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {copy.dismissForNow}
          </button>
          <button
            ref={primaryRef}
            type="button"
            disabled={pending}
            onClick={() => close(onStart)}
            className="rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {copy.startSetup}
          </button>
        </div>
      </div>
    </div>
  );
}
