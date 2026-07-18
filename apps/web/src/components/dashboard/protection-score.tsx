import type { ReactNode } from "react";

export type CheckState = "ok" | "partial" | "off";

const STATE_COLOR: Record<CheckState, string> = {
  ok: "var(--color-ok)",
  partial: "var(--color-warn)",
  off: "var(--color-danger)",
};

/**
 * V1.60 — protection-score card (mockup "Úroveň ochrany 82/100"). A ring gauge
 * plus a checklist of the signals that make up the score. The number and the
 * items are computed deterministically by the page (see computeProtectionScore);
 * this component only renders them.
 */
export function ProtectionScore({
  score,
  checks,
  ringColor,
}: {
  score: number;
  checks: { label: string; state: CheckState; valueLabel: string }[];
  ringColor: string;
}) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * C;

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <div className="relative mx-auto shrink-0" style={{ width: 132, height: 132 }}>
        <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90">
          <circle cx="66" cy="66" r={R} fill="none" stroke="var(--color-surface-2)" strokeWidth="12" />
          <circle
            cx="66" cy="66" r={R} fill="none" stroke={ringColor} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${dash} ${C}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="gu-display text-[34px] leading-none text-[var(--color-fg)]">{score}</span>
          <span className="text-[11px] text-[var(--color-muted)]">/ 100</span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-2">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <StateDot state={c.state} />
              <span className="truncate text-[var(--color-fg)]">{c.label}</span>
            </span>
            <span
              className="shrink-0 text-xs font-medium"
              style={{ color: STATE_COLOR[c.state] }}
            >
              {c.valueLabel}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StateDot({ state }: { state: CheckState }): ReactNode {
  if (state === "ok") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={STATE_COLOR.ok} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATE_COLOR[state] }} aria-hidden="true" />;
}
