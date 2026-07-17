"use client";

import { useFormStatus } from "react-dom";

/**
 * V1.57.4A/B — submit button for the real `startCheckout` server action. Uses useFormStatus so, while
 * the action runs (resolving the price server-side + creating the Stripe Checkout Session), the
 * button disables itself, swaps to a spinner + loading label, and blocks repeated clicks. It receives
 * ONLY presentational strings — never a Stripe Price ID (the form sends plan + interval). The icons
 * are inline SVGs (no new deps, no emojis) and are aria-hidden; the button text carries the label.
 */
export function CheckoutButton({ className, label, pendingLabel }: { className: string; label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className}>
      {pending ? (
        <svg className="h-4 w-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      ) : (
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      <span>{pending ? pendingLabel : label}</span>
    </button>
  );
}
