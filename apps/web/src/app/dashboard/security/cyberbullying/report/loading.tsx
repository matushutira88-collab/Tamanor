export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="h-8 w-80 rounded bg-[var(--color-surface-2)]" />
      <div className="h-6 w-40 rounded bg-[var(--color-surface-2)]" />
      <div className="h-64 max-w-2xl rounded-2xl bg-[var(--color-surface-2)]" />
    </div>
  );
}
