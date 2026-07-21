export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="h-8 w-72 rounded bg-[var(--color-surface-2)]" />
      <div className="h-16 max-w-2xl rounded-lg bg-[var(--color-surface-2)]" />
      <div className="h-40 max-w-2xl rounded-2xl bg-[var(--color-surface-2)]" />
    </div>
  );
}
