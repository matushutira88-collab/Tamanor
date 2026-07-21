import Link from "next/link";
import { PageHeader, Card, SectionHeader } from "@/components/dashboard/ui";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { getLocale } from "@/i18n/locale-server";
import { canViewCyberbullying, getCyberbullyingDashboardKpis } from "@/server/cyberbullying-inbox";
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
  const kpi = await getCyberbullyingDashboardKpis(actor, tf);

  const inbox = (q: string) => `/dashboard/security/cyberbullying/incidents${q}` as const;
  const tfHref = (d: Tf) => (`/dashboard/security/cyberbullying?tf=${d}` as const);

  return (
    <>
      <PageHeader
        eyebrow="Security · Cyberbullying"
        title={t.overviewTitle}
        description={t.overviewSubtitle}
        action={
          <div className="inline-flex rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-0.5">
            {TIMEFRAMES.map((d) => (
              <Link key={d} href={tfHref(d)} aria-current={tf === d ? "true" : undefined} className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${d === tf ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}>
                {t.timeframe[String(d) as "7" | "30" | "90"]}
              </Link>
            ))}
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

      <div className="mt-8">
        <SectionHeader title={t.inboxTitle} description={t.detectOnly} action={<Link href={inbox("")} className="text-sm font-semibold text-[var(--color-brand)] hover:underline">{t.openDashboard} →</Link>} />
        <Card><p className="text-sm text-[var(--color-muted)]">{t.inboxSubtitle}</p></Card>
      </div>
    </>
  );
}
