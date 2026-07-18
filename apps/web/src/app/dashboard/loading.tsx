/**
 * V1.59 hotfix — instant navigation skeleton for the dashboard. Next.js renders this the MOMENT the
 * user navigates (before the server render finishes), so a click never leaves the UI frozen while the
 * page's server components + DB aggregations run. It does not hide slowness — it removes the "dead UI"
 * gap. No data, no queries.
 */
function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[var(--color-surface-2)] ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-6">
      <Block className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <Block key={i} className="h-24" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Block className="h-64" />
        <Block className="h-64" />
      </div>
      <Block className="h-40" />
    </div>
  );
}
