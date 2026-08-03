"use client";

import { useFormStatus } from "react-dom";

/**
 * BUSINESS-CRM-V2 — submit button for the append-only note form. Disables itself while the server action is in
 * flight, which prevents the common duplicate submission (double-click / double Enter) without introducing any
 * client state of its own. The server action remains the authority; this is a usability guard, not a lock.
 */
export function SubmitNoteButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] disabled:opacity-60"
    >
      {label}
    </button>
  );
}
