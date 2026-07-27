"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center" role="alert">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-danger-soft)] text-[var(--color-danger)]" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>
        </span>
        <h1 className="mt-4 text-lg font-semibold text-[var(--color-fg)]">Something went wrong</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">The integration console couldn't load. Please try again.</p>
        <button type="button" onClick={reset} className="mt-6 rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium">Try again</button>
      </div>
    </div>
  );
}
