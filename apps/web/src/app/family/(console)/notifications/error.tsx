"use client";

/**
 * FAMILY NOTIFICATION CENTER V1 — accessible error boundary. NEVER renders the raw error, its stack, Prisma or
 * SQL text — only a bounded localized string. Offers a retry that resets the boundary.
 */
import { useEffect } from "react";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  useEffect(() => { /* intentionally do not log the raw error to the client console */ }, []);
  return (
    <div className="space-y-4" role="alert">
      <h1 className="text-lg font-semibold text-[var(--color-fg)]">Notifications</h1>
      <p className="text-sm text-[var(--color-muted)]">Notifications could not be loaded. Please try again.</p>
      <button type="button" onClick={reset} className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-fg)] hover:border-[var(--color-fg)]">
        Try again
      </button>
    </div>
  );
}
