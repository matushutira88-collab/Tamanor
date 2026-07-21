/**
 * V1.69 (Release B / B6) — instant navigation skeleton for the dashboard overview (KPIs + panels), so
 * there is no frozen-UI gap while the parallelized reads resolve.
 */
function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[var(--color-surface-2)] ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-6">
      <Block className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Block key={i} className="h-24" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Block className="h-64" />
        <Block className="h-64" />
      </div>
    </div>
  );
}
