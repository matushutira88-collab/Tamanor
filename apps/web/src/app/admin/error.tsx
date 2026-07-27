"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center" role="alert">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <h1 className="text-lg font-semibold text-[var(--color-fg)]">Something went wrong</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">The platform admin area couldn't load. Please try again.</p>
        <button type="button" onClick={reset} className="mt-6 rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium">Try again</button>
      </div>
    </div>
  );
}
