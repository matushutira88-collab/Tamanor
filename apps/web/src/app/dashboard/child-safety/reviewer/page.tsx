import Link from "next/link";
import { requireVerifiedSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, StatCard, Badge, EmptyState } from "@/components/dashboard/ui";
import {
  canViewChildSafetyReview, canViewChildSafetyAnalytics, parseIncidentSort, ChildSafetyIncidentListFilter,
} from "@guardora/core";
import {
  listChildSafetyIncidents, getChildSafetyReviewerDashboard, getProtectionPlanDashboard,
  type IncidentListInput, type ReviewerActor,
} from "@guardora/db";
import { canViewChildSafetyProtectionPlan } from "@guardora/core";
import { REVIEWER_COPY, fillCopy } from "./reviewer-i18n";
import { FilterBar } from "./filter-bar";
import { Unauthorized } from "./unauthorized";
import { severityTone, urgencyTone, statusTone, escalationTone, formatDurationMs, fmtDateTime, shortId } from "./reviewer-view";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;
const parseDate = (v?: string): Date | undefined => { if (!v) return undefined; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d; };

export default async function ReviewerConsolePage({ searchParams }: { searchParams: Promise<SP> }) {
  const locale = await getLocale();
  const t = REVIEWER_COPY[locale];
  const session = await requireVerifiedSession();
  if (!canViewChildSafetyReview(session.role)) return <Unauthorized t={t} />;

  const actor: ReviewerActor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const input: IncidentListInput = {
    profileId: sp.profileId || undefined,
    severity: sp.severity || undefined,
    urgency: sp.urgency || undefined,
    escalationState: sp.escalationState || undefined,
    status: sp.status || undefined,
    listFilter: (Object.values(ChildSafetyIncidentListFilter) as string[]).includes(sp.filter ?? "") ? (sp.filter as ChildSafetyIncidentListFilter) : undefined,
    search: sp.search?.trim() || undefined,
    createdFrom: parseDate(sp.createdFrom), createdTo: parseDate(sp.createdTo),
    sort: parseIncidentSort(sp.sort), page,
  };

  const [dash, list] = await Promise.all([
    getChildSafetyReviewerDashboard(actor),
    listChildSafetyIncidents(actor, input),
  ]);
  const planDash = canViewChildSafetyProtectionPlan(session.role) ? await getProtectionPlanDashboard(actor).catch(() => null) : null;
  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));

  const pageHref = (n: number) => { const q = new URLSearchParams(); Object.entries(sp).forEach(([k, v]) => { if (v && k !== "page") q.set(k, v); }); q.set("page", String(n)); return `/dashboard/child-safety/reviewer?${q.toString()}`; };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader eyebrow="🛡️" title={t.title} description={t.subtitle} />
        {canViewChildSafetyAnalytics(session.role) ? (
          <Link href="/dashboard/child-safety/reviewer/analytics" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">📊 {t.analyticsLink}</Link>
        ) : null}
      </div>

      {/* Dashboard cards */}
      <section aria-label={t.title} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t.cards.open} value={String(dash.openIncidents)} tone="brand" />
        <StatCard label={t.cards.escalated} value={String(dash.escalated)} tone={dash.escalated ? "danger" : "neutral"} />
        <StatCard label={t.cards.critical} value={String(dash.critical)} tone={dash.critical ? "danger" : "neutral"} />
        <StatCard label={t.cards.resolvedToday} value={String(dash.resolvedToday)} tone="ok" />
        <StatCard label={t.cards.avgResponse} value={formatDurationMs(dash.avgResponseMs)} tone="neutral" />
        <StatCard label={t.cards.avgResolution} value={formatDurationMs(dash.avgResolutionMs)} tone="neutral" />
        <StatCard label={t.cards.signals24h} value={String(dash.signalsLast24h)} tone="neutral" />
        <StatCard label={t.cards.deliveries} value={String(dash.guardianDeliveriesTotal)} tone="ok" hint={`${dash.guardianDeliveriesLast24h} · 24h`} />
      </section>

      {/* Protection-plan metrics (view-gated; narrow) */}
      {planDash ? (
        <section aria-label={t.pp.tab} className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label={t.pp.dashNoPlan} value={String(planDash.incidentsWithoutActivePlan)} tone={planDash.incidentsWithoutActivePlan ? "warn" : "neutral"} />
          <StatCard label={t.pp.dashActive} value={String(planDash.activePlans)} tone="brand" />
          <StatCard label={t.pp.dashOverdue} value={String(planDash.overdueActions)} tone={planDash.overdueActions ? "danger" : "neutral"} />
          <StatCard label={t.pp.dashBlocked} value={String(planDash.blockedActions)} tone={planDash.blockedActions ? "warn" : "neutral"} />
          <StatCard label={t.pp.dashCompletedToday} value={String(planDash.plansCompletedToday)} tone="ok" />
        </section>
      ) : null}

      <Card className="p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.cards.topFamilies}</p>
        <div className="flex flex-wrap gap-2">
          {dash.topRiskFamilies.length === 0 ? <span className="text-sm text-[var(--color-muted)]">{t.cards.none}</span>
            : dash.topRiskFamilies.map((r) => <Badge key={r.riskFamily} tone="neutral">{r.riskFamily} · {r.count}</Badge>)}
        </div>
      </Card>

      {/* Filters */}
      <FilterBar t={t} sp={sp} />

      {/* Incident table */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5 text-xs text-[var(--color-muted)]">
          <span>{fillCopy(list.total === 1 ? t.list.resultsOne : t.list.resultsMany, { count: list.total })}</span>
          <span>{fillCopy(t.list.pageTemplate, { page: list.page, total: totalPages })}</span>
        </div>
        {list.items.length === 0 ? (
          <div className="p-8"><EmptyState title={t.list.empty} body={t.list.emptyHint} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                  <th className="px-4 py-2 font-semibold">{t.table.id}</th>
                  <th className="px-3 py-2 font-semibold">{t.table.created}</th>
                  <th className="px-3 py-2 font-semibold">{t.table.updated}</th>
                  <th className="px-3 py-2 font-semibold">{t.table.profile}</th>
                  <th className="px-3 py-2 font-semibold">{t.table.severity}</th>
                  <th className="px-3 py-2 font-semibold">{t.table.urgency}</th>
                  <th className="px-3 py-2 font-semibold">{t.table.status}</th>
                  <th className="px-3 py-2 font-semibold">{t.table.escalation}</th>
                  <th className="px-3 py-2 font-semibold">{t.table.assigned}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t.table.signals}</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((i) => (
                  <tr key={i.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-neutral-soft)]">
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/child-safety/reviewer/${i.id}`} className="font-mono text-xs font-semibold text-[var(--color-brand-strong)] hover:underline" aria-label={`${t.table.open} ${i.id}`}>{shortId(i.id)}</Link>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-[var(--color-muted)]">{fmtDateTime(i.createdAt)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-[var(--color-muted)]">{fmtDateTime(i.updatedAt)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-[var(--color-muted)]">{shortId(i.protectedProfileId)}</td>
                    <td className="px-3 py-2.5"><Badge tone={severityTone(i.severity)}>{t.severityLabel[i.severity] ?? i.severity}</Badge></td>
                    <td className="px-3 py-2.5"><Badge tone={urgencyTone(i.urgency)}>{t.urgencyLabel[i.urgency] ?? i.urgency}</Badge></td>
                    <td className="px-3 py-2.5"><Badge tone={statusTone(i.status)}>{t.statusLabel[i.status] ?? i.status}</Badge></td>
                    <td className="px-3 py-2.5">{i.escalationState === "escalated" ? <Badge tone={escalationTone(i.escalationState)}>{t.filter.escalated}</Badge> : <span className="text-xs text-[var(--color-muted)]">—</span>}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-[var(--color-muted)]">{i.assignedReviewerId ? shortId(i.assignedReviewerId) : <span className="italic">{t.table.unassigned}</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{i.signalCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 ? (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-4 py-2.5">
            {list.page > 1 ? <Link href={pageHref(list.page - 1)} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1 text-xs font-medium">{t.list.prev}</Link> : <span className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-muted)] opacity-50">{t.list.prev}</span>}
            {list.hasMore ? <Link href={pageHref(list.page + 1)} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1 text-xs font-medium">{t.list.next}</Link> : <span className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-muted)] opacity-50">{t.list.next}</span>}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
