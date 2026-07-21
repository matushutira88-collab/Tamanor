export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="h-8 w-72 rounded bg-[var(--color-surface-2)]" />
      <div className="h-48 rounded-2xl bg-[var(--color-surface-2)]" />
    </div>
  );
}
