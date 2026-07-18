import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";

type Tone = "neutral" | "brand" | "ok" | "warn" | "danger";

const ICON_TONE: Record<Tone, string> = {
  neutral: "bg-[var(--color-neutral-soft)] text-[var(--color-muted)]",
  brand: "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]",
  ok: "bg-[var(--color-ok-soft)] text-[var(--color-ok)]",
  warn: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
  danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
};

/**
 * V1.60 — dashboard KPI card (mockup): tinted icon square, big serif figure,
 * label, and an optional period-over-period delta. `delta.good` drives the
 * colour (green when the movement is desirable for THIS metric — e.g. more
 * received items is good, more risk is bad), independent of the sign.
 */
export function KpiCard({
  label,
  value,
  icon,
  tone = "neutral",
  delta,
  hint,
  href,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  tone?: Tone;
  delta?: { pct: number; good: boolean } | null;
  hint?: string;
  href?: Route;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        {icon ? (
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10 ${ICON_TONE[tone]}`}>
            {icon}
          </span>
        ) : null}
        <p className="gu-display text-right text-[32px] leading-none text-[var(--color-fg)]">{value}</p>
      </div>
      <p className="mt-3 text-[13px] font-medium text-[var(--color-fg)]">{label}</p>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs">
        {delta ? (
          <span className={`inline-flex items-center gap-0.5 font-semibold ${delta.good ? "text-[var(--color-ok)]" : "text-[var(--color-danger)]"}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              className={delta.pct < 0 ? "rotate-180" : ""}>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
            {Math.abs(delta.pct)}%
          </span>
        ) : null}
        {hint ? <span className="text-[var(--color-muted)]">{hint}</span> : null}
      </div>
    </>
  );

  const cls = "gu-card block p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-pop";
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return <div className={cls}>{inner}</div>;
}
