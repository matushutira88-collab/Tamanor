"use client";

import Link from "next/link";
import { newCorrelationId } from "@/lib/errors";

/**
 * Dashboard error boundary. Renders inside the dashboard shell. Shows a safe message +
 * correlation id + retry + support — never the raw error, stack, DB role, SQL or a token.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const correlationId = error.digest ?? newCorrelationId();
  return (
    <div className="mx-auto max-w-lg px-6 py-20 text-center">
      <h1 className="text-xl font-semibold">This page hit a snag</h1>
      <p className="mt-3 text-[var(--color-muted)]">
        An unexpected error occurred while loading this section. Nothing sensitive was exposed.
      </p>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Reference: <code>{correlationId}</code>
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)]"
        >
          Try again
        </button>
        <Link href="/dashboard" className="rounded-xl border border-[var(--color-border-strong)] px-5 py-2.5 text-sm font-semibold">
          Back to dashboard
        </Link>
        <Link href="/contact" className="rounded-xl border border-[var(--color-border-strong)] px-5 py-2.5 text-sm font-semibold">
          Contact support
        </Link>
      </div>
    </div>
  );
}
