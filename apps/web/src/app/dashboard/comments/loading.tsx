/**
 * V1.69 (Release B / B6) — instant navigation skeleton for the comments/inbox list, so navigation feels
 * immediate while the tenant-scoped items load.
 */
function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[var(--color-surface-2)] ${className}`} />;
}

export default function CommentsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <Block className="h-8 w-48" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => <Block key={i} className="h-8 w-28" />)}
      </div>
      <div className="space-y-2 rounded-xl border border-[var(--color-border)] p-2">
        {Array.from({ length: 6 }).map((_, i) => <Block key={i} className="h-16" />)}
      </div>
    </div>
  );
}
