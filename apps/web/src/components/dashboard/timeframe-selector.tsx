"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * V1.60 — the dashboard 7/30/90-day selector as a soft client navigation. A React transition keeps the
 * CURRENT dashboard content on screen while the new timeframe loads (no blank re-render) and shows a
 * local pending state on the control, instead of a hard <Link> navigation that blocks with no feedback.
 */
export function TimeframeSelector({ current, options }: { current: number; options: readonly number[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div aria-busy={pending} className={`inline-flex rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-0.5 transition-opacity ${pending ? "opacity-60" : ""}`}>
      {options.map((d) => (
        <button
          key={d}
          type="button"
          aria-current={current === d ? "true" : undefined}
          disabled={pending}
          onClick={() => { if (d !== current) startTransition(() => router.push(`/dashboard?tf=${d}`)); }}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:cursor-wait ${d === current ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}
