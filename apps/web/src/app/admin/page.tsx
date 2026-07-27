import { getLocale } from "@/i18n/locale-server";
import { Card, PageHeader, Badge } from "@/components/dashboard/ui";
import { requirePlatformAccess, platformCapsFor } from "@/server/platform/guard";
import { analyticsOverview, analyticsConversions, analyticsRetentionStatus, listPlatformAudit } from "@guardora/db";
import { ADMIN_COPY } from "./admin-i18n";
import { Unauthorized } from "./unauthorized";
import { fmtNum, fmtPct, fmtDate } from "./admin-view";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const t = ADMIN_COPY[await getLocale()];
  const platform = await requirePlatformAccess("admin.access");
  if (!platform) return <Unauthorized t={t} />;
  const caps = platformCapsFor(platform.role);

  const [overview, conversions, retention, audit] = await Promise.all([
    caps.analyticsView ? analyticsOverview(platform.userId, {}).catch(() => null) : Promise.resolve(null),
    caps.analyticsView ? analyticsConversions(platform.userId, {}).catch(() => null) : Promise.resolve(null),
    caps.analyticsView ? analyticsRetentionStatus(platform.userId).catch(() => null) : Promise.resolve(null),
    caps.auditView ? listPlatformAudit(platform.userId, { pageSize: 8 }).catch(() => null) : Promise.resolve(null),
  ]);
  const conv = (e: string) => conversions?.byEvent.find((x) => x.eventType === e)?.count ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="🛰️" title="Platform overview" description={t.restrictedBanner} />
      <Card className="grid gap-1.5 p-4 text-xs text-[var(--color-muted)]">{t.privacyWarnings.map((w, i) => <p key={i}>⚠️ {w}</p>)}</Card>

      {caps.analyticsView && overview ? (
        <section aria-label={t.sections.summary} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={t.cards.pageViews} value={fmtNum(overview.pageViews)} />
          <Stat label={t.cards.sessions} value={fmtNum(overview.sessions)} />
          <Stat label={t.cards.approxVisitors} value={fmtNum(overview.approximateUniqueVisitors)} note={t.fields.approxNote} />
          <Stat label={t.cards.engagedSessions} value={fmtNum(overview.engagedSessions)} />
          <Stat label={t.cards.bounceRate} value={fmtPct(overview.bounceRate)} />
          <Stat label={t.cards.conversionRate} value={fmtPct(overview.conversionRate)} />
        </section>
      ) : null}

      {caps.analyticsView && conversions ? (
        <section aria-label={t.sections.conversions} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label={t.cards.registrations} value={fmtNum(conv("REGISTRATION_COMPLETED"))} />
          <Stat label={t.cards.contacts} value={fmtNum(conv("CONTACT_FORM_SUBMITTED"))} />
          <Stat label={t.cards.integrations} value={fmtNum(conv("INTEGRATION_CONNECT_COMPLETED"))} />
        </section>
      ) : null}

      {caps.analyticsView && retention ? (
        <section aria-label={t.sections.retention} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.retention}</h2>
          <Card className="flex flex-wrap gap-4 p-4 text-xs text-[var(--color-muted)]">
            <span>{t.cards.pageViews}: <strong className="text-[var(--color-fg)]">{fmtNum(retention.rawEventCount)}</strong> raw</span>
            <span>aggregates: <strong className="text-[var(--color-fg)]">{fmtNum(retention.aggregateRowCount)}</strong></span>
            <span>{t.fields.lastAccess}: <strong className="text-[var(--color-fg)]">{fmtDate(retention.lastIngestionAt)}</strong></span>
          </Card>
        </section>
      ) : null}

      {caps.auditView && audit ? (
        <section aria-label={t.sections.recentAudit} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.recentAudit}</h2>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[480px] text-xs">
              <caption className="sr-only">{t.sections.recentAudit}</caption>
              <thead><tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]"><th scope="col" className="px-4 py-2 font-semibold">{t.fields.when}</th><th scope="col" className="px-3 py-2 font-semibold">{t.fields.action}</th><th scope="col" className="px-3 py-2 font-semibold">{t.fields.result}</th></tr></thead>
              <tbody>{audit.items.map((a) => <tr key={a.id} className="border-b border-[var(--color-border)] last:border-0"><td className="px-4 py-2 whitespace-nowrap text-[var(--color-muted)]">{fmtDate(a.createdAt)}</td><td className="px-3 py-2">{t.auditActionLabel[a.action] ?? a.action}</td><td className="px-3 py-2 text-[var(--color-muted)]">{a.resultCode}</td></tr>)}</tbody>
            </table>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[var(--color-fg)]">{value}</div>
      {note ? <div className="mt-0.5 text-[10px] text-[var(--color-muted)]">{note}</div> : null}
    </Card>
  );
}
