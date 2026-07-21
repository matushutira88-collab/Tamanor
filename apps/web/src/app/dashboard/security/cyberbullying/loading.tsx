export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden="true">
      <div className="h-8 w-72 rounded bg-[var(--color-surface-2)]" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-[var(--color-surface-2)]" />
        ))}
      </div>
      <div className="h-40 rounded-2xl bg-[var(--color-surface-2)]" />
    </div>
  );
}
