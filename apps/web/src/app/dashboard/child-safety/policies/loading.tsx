/** Policy console loading skeleton. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-8 w-72 animate-pulse rounded-lg bg-[var(--color-neutral-soft)]" />
      <div className="h-48 animate-pulse rounded-xl bg-[var(--color-neutral-soft)]" />
    </div>
  );
}
