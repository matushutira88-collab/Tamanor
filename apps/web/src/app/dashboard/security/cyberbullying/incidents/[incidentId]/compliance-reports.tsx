import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Card, Badge, SectionHeader } from "@/components/dashboard/ui";
import type { Locale } from "@/i18n/config";
import { ComplianceReportType } from "@guardora/core";
import type { ComplianceReportVM } from "@guardora/db";
import { CB_COPY } from "../../cb-i18n";
import { createComplianceReportAction } from "./compliance-actions";

const BTN = "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]";
const verifyTone = (v: string): "ok" | "danger" | "warn" | "neutral" => (v === "verified" ? "ok" : v === "invalid" ? "danger" : v === "unsupported_schema" || v === "chain_incomplete" ? "warn" : "neutral");

export function ComplianceReports({ locale, incidentId, reports, canManage, banner }: {
  locale: Locale; incidentId: string; reports: ComplianceReportVM[]; canManage: boolean; banner: string | null;
}) {
  const t = CB_COPY[locale].comp;
  // Fresh idempotency key per render — a double-click submits the same key (one report);
  // a later intentional visit gets a new key (a new version). Never shown in the UI.
  const idempotencyKey = randomUUID();

  return (
    <div id="reports" className="mt-8 scroll-mt-20">
      <SectionHeader title={t.section} description={t.subtitle}
        action={canManage ? (
          <form action={createComplianceReportAction} className="flex items-center gap-2">
            <input type="hidden" name="incidentId" value={incidentId} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <label className="sr-only" htmlFor="report-type">{t.reportType.cyberbullying_case_summary}</label>
            <select id="report-type" name="reportType" defaultValue={ComplianceReportType.CaseSummary} className="rounded-lg border border-[var(--color-border-strong)] bg-white px-2 py-1.5 text-xs">
              {Object.values(ComplianceReportType).map((rt) => <option key={rt} value={rt}>{t.reportType[rt as keyof typeof t.reportType]}</option>)}
            </select>
            <button type="submit" className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{t.create}</button>
          </form>
        ) : undefined} />

      {banner ? <div role={banner === CB_COPY[locale].comp.banner.ok ? "status" : "alert"} aria-live="polite" className={`mb-4 rounded-lg border px-3 py-2 text-sm ${banner === CB_COPY[locale].comp.banner.ok ? "border-[var(--color-ok)] bg-[var(--color-ok-soft)] text-[var(--color-ok)]" : "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]"}`}>{banner}</div> : null}

      <Card className="overflow-x-auto">
        {reports.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.empty}</p> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-[var(--color-muted)]"><tr className="border-b border-[var(--color-border)]">
              <th className="py-2 pr-3">{t.reportType.cyberbullying_case_summary.split(" ")[0]}</th><th className="py-2 pr-3">{t.version}</th><th className="py-2 pr-3">{t.generatedAt}</th><th className="py-2 pr-3">{t.generatedBy}</th><th className="py-2 pr-3">{t.status}</th><th className="py-2"></th>
            </tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.reportId} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-2 pr-3">{t.reportType[r.reportType as keyof typeof t.reportType] ?? r.reportType}</td>
                  <td className="py-2 pr-3">v{r.version}</td>
                  <td className="py-2 pr-3 text-xs">{new Date(r.generatedAt).toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className="py-2 pr-3 text-xs">{r.generatedByUserId}</td>
                  <td className="py-2 pr-3"><Badge tone={verifyTone(r.verificationStatus)}>{t.verification[r.verificationStatus as keyof typeof t.verification] ?? r.verificationStatus}</Badge></td>
                  <td className="py-2"><Link href={`/dashboard/security/cyberbullying/incidents/${incidentId}/reports/${r.reportId}`} className={BTN}>{t.view}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
