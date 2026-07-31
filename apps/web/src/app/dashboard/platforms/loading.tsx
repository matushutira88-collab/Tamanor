/** Bounded, aria-busy navigation skeleton for Connected Platforms (no data fetch, no real values). */
function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[var(--color-surface-2)] ${className}`} />;
}
export default function PlatformsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-6">
      <Block className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Block key={i} className="h-40" />)}</div>
    </div>
  );
}
