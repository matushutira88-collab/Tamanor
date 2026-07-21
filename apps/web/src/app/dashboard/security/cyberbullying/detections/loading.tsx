export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="h-8 w-72 rounded bg-[var(--color-surface-2)]" />
      <div className="h-16 rounded-xl bg-[var(--color-surface-2)]" />
      <div className="h-64 rounded-2xl bg-[var(--color-surface-2)]" />
    </div>
  );
}
