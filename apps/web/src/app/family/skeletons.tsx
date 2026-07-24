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
  return <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">{children}</div>;
}

/**
 * Page header placeholder. Height matches `PageHeader` (28px title + description + its
 * `mb-7`), so the first card below it sits where it will sit once loaded.
 */
function HeaderBars() {
  return (
    <div className="mb-7 space-y-2">
      <Bar className="h-7 w-56" />
      <Bar className="h-4 w-80 max-w-full" />
    </div>
  );
}

/** Generic page header + a couple of stacked cards. */
export function FamilyPageSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <HeaderBars />
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

/**
 * Hero + KPI grid + two section cards — mirrors the Family overview 1:1 so the page does
 * not jump when the real content lands: same hero card padding, same 4-up KPI grid at the
 * same breakpoints (`sm:grid-cols-2 xl:grid-cols-4`), same two-column section row.
 */
export function FamilyKpiSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">Loading…</span>
      {/* Hero */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <Bar className="h-10 w-10 rounded-xl" />
            <Bar className="mt-4 h-8 w-72 max-w-full" />
            <Bar className="mt-3 h-4 w-full max-w-lg" />
            <Bar className="mt-2 h-4 w-4/6 max-w-md" />
          </div>
          <Bar className="h-11 w-52 rounded-lg" />
        </div>
        <Bar className="mt-6 h-10 w-full rounded-lg" />
      </div>
      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <CardBox key={i}>
            <div className="flex items-center justify-between">
              <Bar className="h-3 w-24" />
              <Bar className="h-9 w-9 rounded-xl" />
            </div>
            <Bar className="mt-3 h-8 w-16" />
          </CardBox>
        ))}
      </div>
      {/* Two section cards */}
      <div className="grid gap-6 xl:grid-cols-2">
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
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <HeaderBars />
      <CardBox>
        <Bar className="mb-4 h-4 w-40" />
        {/* Row height (h-4 bar in a py-2.5 row) matches a real table row, so a list that
            loads into N rows does not push the page around. */}
        <div className="divide-y divide-[var(--color-border)]">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2.5">
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
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <Bar className="h-4 w-24" />
      <HeaderBars />
      {/* Tab row: same 2px-bordered strip the real `Tabs` renders. */}
      <div className="mb-5 flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-2.5">
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
