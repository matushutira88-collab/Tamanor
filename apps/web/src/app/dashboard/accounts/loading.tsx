/**
 * V1.59 hotfix — instant navigation skeleton for the Watched Accounts page (accounts table). Rendered
 * immediately on navigation so there is no frozen-UI gap while the accounts overview loads.
 */
function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[var(--color-surface-2)] ${className}`} />;
}

export default function AccountsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <Block className="h-8 w-56" />
      <div className="flex items-center justify-between">
        <Block className="h-4 w-40" />
        <Block className="h-8 w-32" />
      </div>
      <div className="space-y-2 rounded-xl border border-[var(--color-border)] p-2">
        {Array.from({ length: 4 }).map((_, i) => <Block key={i} className="h-12" />)}
      </div>
    </div>
  );
}
