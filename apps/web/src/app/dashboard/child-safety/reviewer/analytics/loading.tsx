/** Analytics dashboard loading skeleton (route-level Suspense fallback). */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-[var(--color-neutral-soft)]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-[var(--color-neutral-soft)]" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-xl bg-[var(--color-neutral-soft)]" />
    </div>
  );
}
