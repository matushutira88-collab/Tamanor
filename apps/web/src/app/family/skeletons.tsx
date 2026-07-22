/**
 * CS-C6.1 — Family loading skeletons. Pure server-rendered, content-free placeholder markup shown by the
 * route-level `loading.tsx` boundaries while a Family segment streams. They mirror the real layout so the
 * page doesn't jump, and reveal NOTHING (no counts, labels, ids or PII). `aria-hidden` + a polite status
 * label keep them out of the accessibility tree except as a "loading" announcement.
 */

function Bar({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-[var(--color-surface-2)] ${className}`} />;
}

function CardBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">{children}</div>;
}

/** Generic page header + a couple of stacked cards. */
export function FamilyPageSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-5xl space-y-6">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <Bar className="h-6 w-48" />
        <Bar className="h-4 w-72" />
      </div>
      <CardBox>
        <Bar className="mb-4 h-4 w-40" />
        <div className="space-y-3">
          <Bar className="h-4 w-full" />
          <Bar className="h-4 w-5/6" />
          <Bar className="h-4 w-4/6" />
        </div>
      </CardBox>
    </div>
  );
}

/** KPI grid + two section cards — for the Family overview/dashboard. */
export function FamilyKpiSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-6xl space-y-6">
      <span className="sr-only">Loading…</span>
      <Bar className="h-6 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <CardBox key={i}>
            <Bar className="mb-3 h-3 w-24" />
            <Bar className="h-7 w-16" />
          </CardBox>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <CardBox key={i}>
            <Bar className="mb-4 h-4 w-40" />
            <div className="space-y-3">
              <Bar className="h-4 w-full" />
              <Bar className="h-4 w-11/12" />
              <Bar className="h-4 w-9/12" />
            </div>
          </CardBox>
        ))}
      </div>
    </div>
  );
}

/** A table placeholder — for list routes (profiles, authorizations, signals, deliveries, guardians). */
export function FamilyTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-5xl space-y-6">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <Bar className="h-6 w-48" />
        <Bar className="h-4 w-72" />
      </div>
      <CardBox>
        <Bar className="mb-4 h-4 w-40" />
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <Bar className="h-4 w-1/2" />
              <Bar className="h-4 w-24" />
            </div>
          ))}
        </div>
      </CardBox>
    </div>
  );
}

/** A detail placeholder — header + tab row + a body card (protected-profile detail). */
export function FamilyDetailSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-5xl space-y-6">
      <span className="sr-only">Loading…</span>
      <Bar className="h-4 w-24" />
      <div className="space-y-2">
        <Bar className="h-7 w-56" />
        <Bar className="h-4 w-40" />
      </div>
      <div className="flex gap-2">
        {[0, 1, 2, 3, 4].map((i) => <Bar key={i} className="h-8 w-24" />)}
      </div>
      <CardBox>
        <div className="space-y-3">
          <Bar className="h-4 w-full" />
          <Bar className="h-4 w-5/6" />
          <Bar className="h-4 w-4/6" />
        </div>
      </CardBox>
    </div>
  );
}
