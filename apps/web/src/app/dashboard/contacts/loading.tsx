/** Bounded, aria-busy navigation skeleton for the Contacts inbox (no data fetch, no real values). */
function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[var(--color-surface-2)] ${className}`} />;
}
export default function ContactsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-6">
      <Block className="h-8 w-48" />
      <Block className="h-4 w-32" />
      <div className="flex gap-2">{Array.from({ length: 5 }).map((_, i) => <Block key={i} className="h-7 w-20" />)}</div>
      <Block className="h-64" />
    </div>
  );
}
