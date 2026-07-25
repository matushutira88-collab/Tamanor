/** Reviewer Console — skeleton loader (dashboard cards + table) shown during server render / navigation. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-8 w-72 animate-pulse rounded-lg bg-[var(--color-neutral-soft)]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-[var(--color-neutral-soft)]" />)}
      </div>
      <div className="h-10 w-full animate-pulse rounded-lg bg-[var(--color-neutral-soft)]" />
      <div className="gu-card p-0">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 animate-pulse border-b border-[var(--color-border)] bg-[var(--color-neutral-soft)] last:border-0" />)}
      </div>
    </div>
  );
}
