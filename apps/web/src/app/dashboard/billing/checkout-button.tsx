"use client";

import { useFormStatus } from "react-dom";

/**
 * V1.57.4A — submit button for the real `startCheckout` server action. Uses useFormStatus so, while
 * the action runs (resolving the price server-side + creating the Stripe Checkout Session), the
 * button disables itself, shows a loading label, and blocks repeated clicks / double-submits. It
 * receives ONLY presentational strings — never a Stripe Price ID (the form sends plan + interval).
 */
export function CheckoutButton({ className, label, pendingLabel }: { className: string; label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className}>
      {pending ? pendingLabel : label}
    </button>
  );
}
