/**
 * V1.39 — dashboard route loading fallback. Shown during server navigation so the user
 * always sees progress instead of a frozen page. Purely presentational skeleton.
 */
export default function DashboardLoading() {
  return (
    <div className="animate-pulse px-6 py-8" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-56 rounded-md bg-[var(--color-surface-2)]" />
      <div className="mt-3 h-4 w-80 rounded bg-[var(--color-surface-2)]" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]" />
        ))}
      </div>
    </div>
  );
}
