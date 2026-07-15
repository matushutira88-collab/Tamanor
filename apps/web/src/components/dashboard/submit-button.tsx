"use client";

import { useFormStatus } from "react-dom";
import type { AnalyticsEventName } from "@guardora/core/analytics";
import { track } from "@/lib/analytics/track";

/**
 * Submit button that disables itself while its parent <form> server action is in
 * flight. Prevents double-submits (e.g. a second Approve creating a duplicate
 * PlatformActionExecution — V1.25B idempotency, defence in depth alongside the
 * server-side idempotency check + DB unique index).
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className = "",
  trackEvent,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
  className?: string;
  /** V1.53 — fire this analytics event when the button is clicked (submit intent). Optional. */
  trackEvent?: AnalyticsEventName;
}) {
  const { pending } = useFormStatus();
  const base =
    variant === "primary"
      ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)] shadow-sm"
      : "border border-[var(--color-border-strong)] bg-white text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]";
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      onClick={trackEvent ? () => track(trackEvent) : undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${base} ${className}`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
