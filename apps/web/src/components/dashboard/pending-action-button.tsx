"use client";

import { useFormStatus } from "react-dom";

/**
 * V1.60 — compact submit button for the account row actions. Gives an IMMEDIATE pending state (disables
 * itself + shows a pending label) so a long inline action (e.g. Sync now, which awaits the provider) can
 * never leave the user on an unresponsive button, and a double-click can't fire the action twice.
 */
export function PendingActionButton({ children, pendingLabel, className = "" }: {
  children: React.ReactNode; pendingLabel?: string; className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending}
      className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${className}`}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
