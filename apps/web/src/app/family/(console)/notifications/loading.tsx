/** FAMILY NOTIFICATION CENTER V1 — accessible loading state (no spinner-only; announced). */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded bg-[var(--color-bg-soft)]" />
      <p role="status" aria-live="polite" className="sr-only">Loading…</p>
      <ul className="space-y-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-24 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)]" />
        ))}
      </ul>
    </div>
  );
}
