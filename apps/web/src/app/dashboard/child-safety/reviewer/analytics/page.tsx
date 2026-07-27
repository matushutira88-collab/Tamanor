import Link from "next/link";
import { requireVerifiedSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, StatCard, Badge } from "@/components/dashboard/ui";
import {
  canViewChildSafetyAnalytics, canExportChildSafetyAnalytics, parseGranularity, AnalyticsGranularity,
} from "@guardora/core";
import { getChildSafetyAnalyticsReport, type AnalyticsActor } from "@guardora/db";
import { ANALYTICS_COPY } from "./analytics-i18n";
import { Unauthorized } from "./unauthorized";
import { BarChart, DistributionChart, TrendTable } from "./charts";
import {
  formatCount, formatDuration, formatObservations, GRANULARITY_OPTIONS, shortId,
  severityTone, urgencyTone, statusTone, escalationStatusTone, planStatusTone, actionStatusTone, deliveryOutcomeTone,
} from "./analytics-view";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;
const parseDate = (v?: string): Date | undefined => { if (!v) return undefined; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d; };
const day = (iso: string): string => iso.slice(0, 10);

export default async function ChildSafetyAnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const locale = await getLocale();
  const t = ANALYTICS_COPY[locale];
  const session = await requireVerifiedSession();
  if (!canViewChildSafetyAnalytics(session.role)) return <Unauthorized t={t} />;

  const actor: AnalyticsActor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const sp = await searchParams;
  const granularity = parseGranularity(sp.granularity);
  const report = await getChildSafetyAnalyticsReport(actor, { from: parseDate(sp.from), to: parseDate(sp.to), granularity });
  const canExport = canExportChildSafetyAnalytics(session.role);
  const o = report.overview;

  const exportHref = `/api/v1/child-safety/reviewer/analytics/export?from=${day(report.range.from)}&to=${day(report.range.to)}&granularity=${granularity}`;
  const dim = report.distributions;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader eyebrow="📊" title={t.title} description={t.subtitle} />
        <div className="flex items-center gap-2">
          <Link href="/dashboard/child-safety/reviewer" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.backToConsole}</Link>
          {canExport ? (
            <a href={exportHref} className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)]" title={t.exportHint} download>{t.export}</a>
          ) : null}
        </div>
      </div>

      {/* Range + granularity filter (GET form — no client JS, keyboard accessible) */}
      <Card className="p-3">
        <form method="GET" action="/dashboard/child-safety/reviewer/analytics" className="flex flex-wrap items-end gap-3" aria-label={t.range.label}>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
            {t.range.from}
            <input type="date" name="from" defaultValue={day(report.range.from)} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-fg)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
            {t.range.to}
            <input type="date" name="to" defaultValue={day(report.range.to)} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-fg)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
            {t.range.granularity}
            <select name="granularity" defaultValue={granularity} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-fg)]">
              {GRANULARITY_OPTIONS.map((g) => <option key={g.value} value={g.value}>{t.granularity[g.labelKey]}</option>)}
            </select>
          </label>
          <button type="submit" className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium">{t.range.apply}</button>
          <span className="ml-auto self-center text-[11px] text-[var(--color-muted)]">🔒 {t.suppressionNote}</span>
        </form>
      </Card>

      {/* Overview */}
      <section aria-label={t.sections.overview}>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.overview}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <StatCard label={t.overview.incidentsCreated} value={String(o.incidentsCreated)} tone="brand" />
          <StatCard label={t.overview.incidentsResolved} value={String(o.incidentsResolved)} tone="ok" />
          <StatCard label={t.overview.openIncidents} value={String(o.openIncidents)} tone={o.openIncidents ? "brand" : "neutral"} />
          <StatCard label={t.overview.escalations} value={String(o.escalations)} tone={o.escalations ? "warn" : "neutral"} />
          <StatCard label={t.overview.activeEscalations} value={String(o.activeEscalations)} tone={o.activeEscalations ? "danger" : "neutral"} />
          <StatCard label={t.overview.activeProtectionPlans} value={String(o.activeProtectionPlans)} tone="brand" />
          <StatCard label={t.overview.completedProtectionPlans} value={String(o.completedProtectionPlans)} tone="ok" />
          <StatCard label={t.overview.overdueActions} value={String(o.overdueActions)} tone={o.overdueActions ? "danger" : "neutral"} />
          <StatCard label={t.overview.blockedActions} value={String(o.blockedActions)} tone={o.blockedActions ? "warn" : "neutral"} />
          <StatCard label={t.overview.evidenceCount} value={String(o.evidenceCount)} tone="neutral" />
          <StatCard label={t.overview.interventionCount} value={String(o.interventionCount)} tone="neutral" />
        </div>
      </section>

      {/* Trends */}
      <section aria-label={t.sections.trends}>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.trends}</h2>
        <Card className="space-y-4 p-4">
          <BarChart labels={report.timeSeries.buckets} values={report.timeSeries.incidents} granularity={granularity} ariaLabel={`${t.series.incidents} · ${t.granularity[granularity === AnalyticsGranularity.Week ? "week" : granularity === AnalyticsGranularity.Month ? "month" : "day"]}`} />
          <TrendTable
            buckets={report.timeSeries.buckets}
            granularity={granularity}
            series={[
              { label: t.series.incidents, values: report.timeSeries.incidents },
              { label: t.series.resolutions, values: report.timeSeries.resolutions },
              { label: t.series.escalations, values: report.timeSeries.escalations },
              { label: t.series.interventions, values: report.timeSeries.interventions },
              { label: t.series.protectionPlans, values: report.timeSeries.protectionPlans },
            ]}
          />
        </Card>
      </section>

      {/* Distributions */}
      <section aria-label={t.sections.distributions}>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.distributions}</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Card className="p-4"><p className="mb-3 text-sm font-semibold">{t.dimension.severity}</p><DistributionChart buckets={dim.severity!} labelFor={(k) => t.severityLabel[k] ?? k} toneFor={severityTone} title={t.dimension.severity} someHiddenLabel={t.someHidden} /></Card>
          <Card className="p-4"><p className="mb-3 text-sm font-semibold">{t.dimension.urgency}</p><DistributionChart buckets={dim.urgency!} labelFor={(k) => t.urgencyLabel[k] ?? k} toneFor={urgencyTone} title={t.dimension.urgency} someHiddenLabel={t.someHidden} /></Card>
          <Card className="p-4"><p className="mb-3 text-sm font-semibold">{t.dimension.risk_family}</p><DistributionChart buckets={dim.risk_family!} labelFor={(k) => t.riskFamilyLabel[k] ?? k} toneFor={() => "neutral"} title={t.dimension.risk_family} someHiddenLabel={t.someHidden} /></Card>
          <Card className="p-4"><p className="mb-3 text-sm font-semibold">{t.dimension.status}</p><DistributionChart buckets={dim.status!} labelFor={(k) => t.statusLabel[k] ?? k} toneFor={statusTone} title={t.dimension.status} someHiddenLabel={t.someHidden} /></Card>
          <Card className="p-4"><p className="mb-3 text-sm font-semibold">{t.dimension.escalation_status}</p><DistributionChart buckets={dim.escalation_status!} labelFor={(k) => t.escalationStatusLabel[k] ?? k} toneFor={escalationStatusTone} title={t.dimension.escalation_status} someHiddenLabel={t.someHidden} /></Card>
        </div>
      </section>

      {/* Response performance */}
      <section aria-label={t.sections.performance}>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.performance}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {([
            [t.performance.incidentToFirstReview, report.performance.incidentToFirstReview],
            [t.performance.incidentToResolved, report.performance.incidentToResolved],
            [t.performance.planActivationToCompletion, report.performance.planActivationToCompletion],
          ] as const).map(([label, d]) => (
            <StatCard key={label} label={label} value={formatDuration(d)} hint={`${t.performance.observations}: ${formatObservations(d)}`} tone="neutral" />
          ))}
        </div>
      </section>

      {/* Protection plans + Guardian delivery */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section aria-label={t.sections.protectionPlans}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.protectionPlans}</h2>
          <Card className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatCard label={t.planStatusLabel.active!} value={String(report.protectionPlans.active)} tone="brand" />
              <StatCard label={t.planStatusLabel.completed!} value={String(report.protectionPlans.completed)} tone="ok" />
              <StatCard label={t.overview.overdueActions} value={String(report.protectionPlans.overdueActions)} tone={report.protectionPlans.overdueActions ? "danger" : "neutral"} />
              <StatCard label={t.overview.blockedActions} value={String(report.protectionPlans.blockedActions)} tone={report.protectionPlans.blockedActions ? "warn" : "neutral"} />
            </div>
            <div><p className="mb-2 text-sm font-semibold">{t.dimension.plan_status}</p><DistributionChart buckets={report.protectionPlans.statusDistribution} labelFor={(k) => t.planStatusLabel[k] ?? k} toneFor={planStatusTone} title={t.dimension.plan_status} someHiddenLabel={t.someHidden} /></div>
            <div><p className="mb-2 text-sm font-semibold">{t.dimension.action_status}</p><DistributionChart buckets={report.protectionPlans.actionStatusDistribution} labelFor={(k) => t.actionStatusLabel[k] ?? k} toneFor={actionStatusTone} title={t.dimension.action_status} someHiddenLabel={t.someHidden} /></div>
          </Card>
        </section>

        <section aria-label={t.sections.guardianDelivery}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.guardianDelivery}</h2>
          <Card className="p-4">
            <p className="mb-3 text-sm font-semibold">{t.dimension.delivery_outcome}</p>
            <DistributionChart buckets={o.guardianDeliveryOutcomes} labelFor={(k) => t.deliveryOutcomeLabel[k] ?? k} toneFor={deliveryOutcomeTone} title={t.dimension.delivery_outcome} someHiddenLabel={t.someHidden} />
          </Card>
        </section>
      </div>

      {/* Reviewer workload — NEVER ranked/scored; stable id order; suppressed */}
      <section aria-label={t.sections.reviewerWorkload}>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.reviewerWorkload}</h2>
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5 text-[11px] text-[var(--color-muted)]">
            <Badge tone="neutral">ℹ️</Badge><span>{t.workload.note}</span>
          </div>
          {report.reviewerWorkload.length === 0 ? (
            <p className="p-6 text-center text-sm text-[var(--color-muted)]">{t.workload.empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                    <th className="px-4 py-2 font-semibold">{t.workload.reviewer}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t.workload.assigned}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t.workload.resolved}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t.workload.activeActions}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t.workload.overdueActions}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t.workload.medianFirstReview}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t.workload.medianResolution}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.reviewerWorkload.map((r) => (
                    <tr key={r.reviewerId} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-muted)]">{shortId(r.reviewerId)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(r.assignedIncidents)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(r.resolvedIncidents)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(r.activeActions)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(r.overdueActions)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatDuration(r.medianFirstReview)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatDuration(r.medianResolution)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
