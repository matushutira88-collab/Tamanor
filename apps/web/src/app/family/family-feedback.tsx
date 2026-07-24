"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { FAMILY_CTA_PRIMARY, FAMILY_FOCUS } from "./family-ui";
import { familyToastMessage, shouldEmitToast } from "./family-feedback-core";
import type { FamilyDict } from "./family-i18n";

/**
 * FAMILY-UI-02 / 02B — Family-local success feedback. Strictly Family-only: nothing here is
 * exported to, or imported by, the Business console, and there is no global provider tree.
 *
 * Every Family mutation is a server action that, on SUCCESS, redirects with `?ok=<verb>`
 * (the redirect is load-bearing — it revalidates and lands the user on the right page — not
 * an artificial redirect just for feedback). On FAILURE the action returns a safe error
 * GROUP that its own `ConfirmDialog` / inline `FamilyStatusBanner` renders. So:
 *
 *   success -> this transient toast, driven by the `?ok=` verb
 *   failure -> the page's existing inline error (untouched here)
 *
 * The toast is decoupled from the live param: the moment a verb arrives we (1) capture its
 * localized message into client state, and (2) strip `?ok=` from the URL with `replace`.
 * The visible toast is therefore pure client state — stripping the param cannot hide it —
 * and a refresh or Back navigation can never replay it. A last-token ref makes a stray
 * re-render idempotent, so exactly one toast shows per successful operation.
 */

/** How long a success toast stays on screen before it fades itself out. */
const TOAST_MS = 5000;

export function FamilyToaster({ strings }: { strings: FamilyDict["feedback"] }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const ok = params.get("ok");
  const [message, setMessage] = useState<string | null>(null);
  const lastToken = useRef<string | null>(null);

  // Capture the verb into client state, then strip it from the URL. The strip uses
  // `history.replaceState` — synchronous, so even an immediate refresh already sees the
  // clean URL — rather than `router.replace`, whose async soft-navigation could let a fast
  // reload replay the toast. `history.replaceState` also replaces the current history entry,
  // so a Back navigation lands on the pre-action page, never on the `?ok=` URL. Combined with
  // the last-token ref (idempotent across re-renders), each success shows exactly one toast.
  useEffect(() => {
    if (!shouldEmitToast(lastToken.current, ok)) return;
    lastToken.current = ok;
    setMessage(familyToastMessage(ok, strings.messages, strings.saved));
    // Strip `?ok=` from the URL so a Back navigation or refresh does not replay it, using
    // `history.replaceState` (a URL-only edit, no server round-trip). This reliably clears
    // the param for every `useActionState` mutation (archive / restore / revoke / …) and any
    // direct navigation. Regardless of the URL, the `lastToken` ref above already guarantees
    // exactly one toast per success across re-renders and soft navigations.
    const next = new URLSearchParams(params.toString());
    next.delete("ok");
    const qs = next.toString();
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", qs ? `${pathname}?${qs}` : pathname);
    }
  }, [ok, params, pathname, strings]);

  // While a toast is showing: auto-dismiss on a timer, and Escape closes it immediately
  // (matching the drawer and the confirm dialog).
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), TOAST_MS);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMessage(null); };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(timer); document.removeEventListener("keydown", onKey); };
  }, [message]);

  // The live region is always mounted so assistive tech registers it before content lands.
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      aria-label={strings.regionLabel}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4 sm:justify-end sm:px-6 sm:pb-6"
    >
      {message ? (
        <div
          role="status"
          className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-[var(--color-ok)] bg-[var(--color-surface)] px-4 py-3 shadow-pop"
        >
          <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-ok-soft)] text-[var(--color-ok)]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12.5 4.2 4.2L19 7" />
            </svg>
          </span>
          <p className="min-w-0 flex-1 text-sm font-medium text-[var(--color-fg)]">{message}</p>
          <button
            type="button"
            onClick={() => setMessage(null)}
            aria-label={strings.dismiss}
            className={`-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--color-muted)] transition hover:text-[var(--color-fg)] ${FAMILY_FOCUS}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Submit button with a real loading->settled transition. `useFormStatus` reads the pending
 * state of the enclosing form, so the button disables itself and swaps in a spinner for the
 * duration of the server action — the success half of the transition is the toast above,
 * which appears after the action's redirect.
 *
 * `aria-busy` + `aria-disabled` announce the wait; the label never disappears, so the
 * button keeps its shape and the layout does not shift.
 */
export function FamilySubmitButton({ label, pendingLabel, className = "" }: { label: string; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-disabled={pending}
      className={`${FAMILY_CTA_PRIMARY} ${className}`}
    >
      {pending ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="animate-spin">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ) : null}
      <span>{pending ? pendingLabel : label}</span>
    </button>
  );
}
