import { Card, SectionHeader, Badge } from "@/components/dashboard/ui";
import { type Locale } from "@/i18n/config";
import { ATO_COPY } from "./ato-i18n";
import type { AtoDetectionList } from "@/server/security-detections";

/**
 * S2 — "Potential Account Takeover" section. Read-only, deterministic, explainable. Renders the honest
 * "No detections" empty state when the ledger is empty, else a table on desktop and stacked cards on
 * mobile. No AI, no geolocation — the copy says so.
 */

const SEVERITY_TONE: Record<string, "danger" | "warn" | "neutral"> = {
  critical: "danger", high: "danger", medium: "warn", low: "neutral", none: "neutral",
};
const STATUS_TONE: Record<string, "warn" | "neutral" | "ok" | "danger"> = {
  open: "warn", acknowledged: "neutral", resolved: "ok", dismissed: "neutral", confirmed: "danger",
};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function AtoDetectionsView({ data, locale }: { data: AtoDetectionList; locale: Locale }) {
  const t = ATO_COPY[locale];

  return (
    <section className="mt-10" data-testid="ato-section">
      <SectionHeader title={t.title} description={t.subtitle} />

      {data.items.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center" data-testid="ato-empty">
            <p className="text-sm font-semibold">{t.noDetections}</p>
            <p className="max-w-md text-sm text-[var(--color-muted)]">{t.noDetectionsHint}</p>
          </div>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
            <span className="text-xs font-medium text-[var(--color-muted)]">{t.openCount(data.openCount)}</span>
            <span className="text-xs text-[var(--color-muted)]">{t.detectOnly}</span>
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-muted)]">
                  <th className="px-4 py-2 font-medium">{t.col.reason}</th>
                  <th className="px-4 py-2 font-medium">{t.col.severity}</th>
                  <th className="px-4 py-2 font-medium">{t.col.confidence}</th>
                  <th className="px-4 py-2 font-medium">{t.col.status}</th>
                  <th className="px-4 py-2 font-medium">{t.col.when}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((d) => (
                  <tr key={d.id} data-testid="ato-detection-row" data-status={d.status} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2.5 font-medium">{t.kind[d.kind] ?? d.kind}</td>
                    <td className="px-4 py-2.5"><Badge tone={SEVERITY_TONE[d.severity] ?? "neutral"}>{t.severity[d.severity] ?? d.severity}</Badge></td>
                    <td className="px-4 py-2.5 tabular-nums">{d.confidence != null ? `${d.confidence}%` : "—"}</td>
                    <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{t.status[d.status] ?? d.status}</Badge></td>
                    <td className="px-4 py-2.5 text-[var(--color-muted)]">{isoDay(d.detectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <ul className="divide-y divide-[var(--color-border)] sm:hidden">
            {data.items.map((d) => (
              <li key={d.id} data-testid="ato-detection-card" data-status={d.status} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{t.kind[d.kind] ?? d.kind}</span>
                  <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{t.status[d.status] ?? d.status}</Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                  <Badge tone={SEVERITY_TONE[d.severity] ?? "neutral"}>{t.severity[d.severity] ?? d.severity}</Badge>
                  <span>{t.col.confidence}: {d.confidence != null ? `${d.confidence}%` : "—"}</span>
                  <span>· {isoDay(d.detectedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
