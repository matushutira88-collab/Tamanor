import Link from "next/link";
import { PageHeader, Card, SectionHeader } from "@/components/dashboard/ui";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { getLocale } from "@/i18n/locale-server";
import { canViewCyberbullying, getCyberbullyingDashboardKpis, getCyberbullyingOperationalMetrics } from "@/server/cyberbullying-inbox";
import { canReportCyberbullying } from "@/server/cyberbullying-report";
import { canTriageDetections, countNewCyberbullyingDetections } from "@/server/cyberbullying-detections";
import { canManageCase } from "@/server/cyberbullying-case";
import { getCyberbullyingSlaOverview, countUnreadNotifications } from "@guardora/db";
import { CB_COPY } from "./cb-i18n";

export const dynamic = "force-dynamic";

const TIMEFRAMES = [7, 30, 90] as const;
type Tf = (typeof TIMEFRAMES)[number];

export default async function CyberbullyingOverviewPage({ searchParams }: { searchParams: Promise<{ tf?: string }> }) {
  const locale = await getLocale();
  const session = await requireVerifiedSession();
  if (!canViewCyberbullying(session.role)) return <AccessDeniedState locale={locale} />;
  const cap = await requireDashboardCapability("cyberbullyingProtection");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;

  const t = CB_COPY[locale];
  const tfRaw = Number((await searchParams).tf);
  const tf: Tf = (TIMEFRAMES as readonly number[]).includes(tfRaw) ? (tfRaw as Tf) : 30;
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const canSla = canManageCase(session.role);
  const [kpi, ops, newDetections, slaOverview, unread] = await Promise.all([
    getCyberbullyingDashboardKpis(actor, tf),
    getCyberbullyingOperationalMetrics(actor),
    canTriageDetections(session.role) ? countNewCyberbullyingDetections(actor) : Promise.resolve(0),
    canSla ? getCyberbullyingSlaOverview(actor).catch(() => null) : Promise.resolve(null),
    countUnreadNotifications(actor).catch(() => 0),
  ]);

  const inbox = (q: string) => `/dashboard/security/cyberbullying/incidents${q}` as const;
  const tfHref = (d: Tf) => (`/dashboard/security/cyberbullying?tf=${d}` as const);

  return (
    <>
      <PageHeader
        eyebrow="Security · Cyberbullying"
        title={t.overviewTitle}
        description={t.overviewSubtitle}
        action={
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-0.5">
              {TIMEFRAMES.map((d) => (
                <Link key={d} href={tfHref(d)} aria-current={tf === d ? "true" : undefined} className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${d === tf ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}>
                  {t.timeframe[String(d) as "7" | "30" | "90"]}
                </Link>
              ))}
            </div>
            {canReportCyberbullying(session.role) ? (
              <Link href="/dashboard/security/cyberbullying/report" className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{t.report.cta}</Link>
            ) : null}
            {/* C10 — notifications bell (unread count announced, not colour-only). */}
            <Link href="/dashboard/security/cyberbullying/notifications" aria-label={`${t.notif.bell}: ${unread} ${t.notif.unreadCountLabel}`} className="relative rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]">
              {t.notif.bell}{unread > 0 ? <span className="ml-1 rounded-full bg-[var(--color-danger)] px-1.5 py-0.5 text-[10px] text-white">{unread}</span> : null}
            </Link>
          </div>
        }
      />

      {/* KPI grid — server-computed, each links to a filtered inbox. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t.kpi.open} value={String(kpi.open)} tone="brand" href={inbox("?status=open")} />
        <KpiCard label={t.kpi.underReview} value={String(kpi.underReview)} tone="brand" href={inbox("?status=under_review")} />
        <KpiCard label={t.kpi.actionRequired} value={String(kpi.actionRequired)} tone="danger" href={inbox("?status=action_required")} />
        <KpiCard label={t.kpi.resolved} value={String(kpi.resolved)} tone="ok" href={inbox("?status=resolved")} />
        <KpiCard label={t.kpi.withoutEvidence} value={String(kpi.withoutEvidence)} tone="warn" href={inbox("?evidence=none")} />
        <KpiCard label={t.kpi.createdInWindow} value={String(kpi.createdInWindow)} tone="neutral" href={inbox(`?tf=${tf}`)} />
        <KpiCard label={t.kpi.linkedDetections} value={String(kpi.linkedDetections)} tone="neutral" href={inbox("?detections=has")} />
        <KpiCard label={t.kpi.avgOpenAge} value={kpi.avgOpenAgeHours === null ? "—" : String(kpi.avgOpenAgeHours)} tone="neutral" />
      </div>

      {/* C5 — operational review workload (server-computed, subject-scoped). */}
      <div className="mt-8">
        <SectionHeader title={t.ops.title} description={t.ops.subtitle} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label={t.ops.assignedToMe} value={String(ops.assignedToMe)} tone="brand" />
          <KpiCard label={t.ops.waitingReview} value={String(ops.waitingReview)} tone="warn" href={inbox("?status=open")} />
          <KpiCard label={t.ops.awaitingAction} value={String(ops.awaitingAction)} tone="danger" href={inbox("?status=action_required")} />
          <KpiCard label={t.ops.avgReviewTime} value={ops.avgReviewTimeHours === null ? "—" : String(ops.avgReviewTimeHours)} tone="neutral" />
        </div>
      </div>

      {/* C10 — SLA overview (derived time status; nothing automatic). */}
      {slaOverview ? (
        <div className="mt-8">
          <SectionHeader title={t.sla.overviewTitle} description={t.sla.overviewSubtitle} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard label={t.sla.card.firstReviewOverdue} value={String(slaOverview.firstReviewOverdue)} tone={slaOverview.firstReviewOverdue ? "danger" : "neutral"} href="/dashboard/security/cyberbullying/incidents?status=open" />
            <KpiCard label={t.sla.card.criticalOverdue} value={String(slaOverview.criticalOverdue)} tone={slaOverview.criticalOverdue ? "danger" : "neutral"} />
            <KpiCard label={t.sla.card.taskOverdue} value={String(slaOverview.taskOverdue)} tone={slaOverview.taskOverdue ? "danger" : "neutral"} />
            <KpiCard label={t.sla.card.followUpOverdue} value={String(slaOverview.followUpOverdue)} tone={slaOverview.followUpOverdue ? "warn" : "neutral"} />
            <KpiCard label={t.sla.card.activeEscalations} value={String(slaOverview.activeEscalations)} tone={slaOverview.activeEscalations ? "warn" : "neutral"} />
          </div>
        </div>
      ) : null}

      {/* C8 — Detection queue entry (human triage of existing security signals). */}
      {canTriageDetections(session.role) ? (
        <div className="mt-8">
          <SectionHeader title={t.det.queueTitle} description={t.det.queueSubtitle}
            action={<Link href="/dashboard/security/cyberbullying/detections" className="text-sm font-semibold text-[var(--color-brand)] hover:underline">{t.det.cta} →</Link>} />
          <Card>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--color-muted)]">{t.det.status.new}</p>
              <Link href="/dashboard/security/cyberbullying/detections?status=new" className="text-2xl font-semibold text-[var(--color-brand)] hover:underline">{newDetections}</Link>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="mt-8">
        <SectionHeader title={t.inboxTitle} description={t.detectOnly} action={<Link href={inbox("")} className="text-sm font-semibold text-[var(--color-brand)] hover:underline">{t.openDashboard} →</Link>} />
        <Card><p className="text-sm text-[var(--color-muted)]">{t.inboxSubtitle}</p></Card>
      </div>
    </>
  );
}
