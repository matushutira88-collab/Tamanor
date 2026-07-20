"use client";

import { useEffect, useRef, useState, useTransition } from "react";

/**
 * V1.66 — the stable place to get back into onboarding, whatever state this member is in:
 *   in_progress -> reopen the checklist   dismissed -> continue   completed -> restart (confirmed)
 *
 * Restart is destructive to PROGRESS only, so it asks first. The confirmation is a real focus-trapped
 * dialog (not window.confirm) so it is keyboard operable and screen-reader labelled, and its body states
 * plainly that no account, monitoring, sync or inbox data is touched.
 */
export function OnboardingSettingsCard({
  status,
  copy,
  onResume,
  onRestart,
}: {
  status: "not_started" | "in_progress" | "completed" | "dismissed";
  copy: {
    settingsTitle: string; settingsBody: string;
    continueSetup: string; reopen: string; restart: string;
    restartTitle: string; restartBody: string; restartConfirm: string; cancel: string;
    completedTitle: string;
  };
  onResume: () => Promise<void>;
  onRestart: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirming) return;
    confirmRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); setConfirming(false); triggerRef.current?.focus(); return; }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const f = panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
      if (f.length === 0) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming]);

  const btn = "rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 disabled:opacity-60";

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5" aria-labelledby="onb-settings-title">
      <h2 id="onb-settings-title" className="text-sm font-semibold">{copy.settingsTitle}</h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        {status === "completed" ? copy.completedTitle : copy.settingsBody}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {status === "dismissed" || status === "not_started" ? (
          <button type="button" disabled={pending} className={btn} onClick={() => startTransition(() => { void onResume(); })}>
            {copy.continueSetup}
          </button>
        ) : null}
        {status === "in_progress" ? (
          <a href="/dashboard" className={btn}>{copy.reopen}</a>
        ) : null}
        {status === "completed" ? (
          <button ref={triggerRef} type="button" disabled={pending} className={btn} onClick={() => setConfirming(true)}>
            {copy.restart}
          </button>
        ) : null}
      </div>

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[color-mix(in_oklab,var(--color-fg),transparent_70%)] p-4 sm:items-center">
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="onb-restart-title"
            aria-describedby="onb-restart-body"
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl"
          >
            <h3 id="onb-restart-title" className="text-base font-semibold">{copy.restartTitle}</h3>
            <p id="onb-restart-body" className="mt-2 text-sm text-[var(--color-muted)]">{copy.restartBody}</p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--color-muted)] transition hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2"
                onClick={() => { setConfirming(false); triggerRef.current?.focus(); }}
              >
                {copy.cancel}
              </button>
              <button
                ref={confirmRef}
                type="button"
                disabled={pending}
                className="rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 disabled:opacity-60"
                onClick={() => { setConfirming(false); startTransition(() => { void onRestart(); }); }}
              >
                {copy.restartConfirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
