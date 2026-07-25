import Link from "next/link";
import type { ReviewerCopy } from "./reviewer-i18n";

/**
 * Reviewer Console — the proper unauthorized screen. Rendered INSTEAD of the whole console when a
 * signed-in member's role lacks `child_safety:review_view`. It exposes NO incident data and NO actions —
 * the console (list, detail, dashboard, every action) is never mounted for an unauthorized user.
 */
export function Unauthorized({ t }: { t: ReviewerCopy }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-danger-soft)] text-[var(--color-danger)]" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-[var(--color-danger)]">{t.unauthorized.badge}</p>
        <h1 className="mt-1 text-lg font-semibold text-[var(--color-fg)]">{t.unauthorized.title}</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{t.unauthorized.body}</p>
        <Link href="/dashboard" className="mt-6 inline-block rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium">{t.unauthorized.cta}</Link>
      </div>
    </div>
  );
}
