import Link from "next/link";
import { getLocale } from "@/i18n/locale-server";
import { Card, PageHeader, Badge } from "@/components/dashboard/ui";
import { requirePlatformAccess, platformCapsFor } from "@/server/platform/guard";
import {
  analyticsOverview, analyticsTimeseries, analyticsGroupBy, analyticsConversions, analyticsFunnels, analyticsBotTraffic,
} from "@guardora/db";
import { ADMIN_COPY, type AdminCopy } from "../admin-i18n";
import { Unauthorized } from "../unauthorized";
import { resolveRange, fmtNum, fmtPct, botTone } from "../admin-view";

export const dynamic = "force-dynamic";

export default async function AnalyticsDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = ADMIN_COPY[await getLocale()];
  const sp = await searchParams;
  const platform = await requirePlatformAccess("analytics.view");
  if (!platform) return <Unauthorized t={t} />;
  const caps = platformCapsFor(platform.role);
  const includeBots = sp.includeBots === "1";
  const { from, to, preset } = resolveRange(sp.range, sp.from, sp.to, Date.now());
  const q = { from, to, includeBots };
  const uid = platform.userId;

  const [overview, series, pages, acquisition, countries, languages, devices, browsers, os, funnels, bots, conversions] = await Promise.all([
    analyticsOverview(uid, q), analyticsTimeseries(uid, { ...q, metric: "pageViews" }),
    analyticsGroupBy(uid, "path", q), analyticsGroupBy(uid, "referrerCategory", q), analyticsGroupBy(uid, "countryCode", q),
    analyticsGroupBy(uid, "language", q), analyticsGroupBy(uid, "deviceCategory", q), analyticsGroupBy(uid, "browserFamily", q),
    analyticsGroupBy(uid, "operatingSystemFamily", q), analyticsFunnels(uid, q), analyticsBotTraffic(uid, q), analyticsConversions(uid, q),
  ]);

  const presets: Array<{ k: string; label: string }> = [{ k: "today", label: t.dateFilters.today }, { k: "7", label: t.dateFilters.last7 }, { k: "30", label: t.dateFilters.last30 }, { k: "90", label: t.dateFilters.last90 }];
  const href = (range: string, bots?: boolean) => `/admin/analytics?range=${range}${(bots ?? includeBots) ? "&includeBots=1" : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="📊" title={t.nav.analytics} description={t.privacyWarnings[0]} />

      {/* Date filters */}
      <div role="group" aria-label={t.dateFilters.from} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        {presets.map((p) => (
          <Link key={p.k} href={href(p.k)} aria-current={preset === p.k ? "true" : undefined} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${preset === p.k ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border border-[var(--color-border-strong)]"}`}>{p.label}</Link>
        ))}
        <Link href={href(preset, !includeBots)} className="ml-auto rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{includeBots ? "✓ " : ""}{t.dateFilters.includeBots}</Link>
        {caps.analyticsExport ? <Link href={`/api/platform/analytics/export?dimension=path&from=${from}&to=${to}`} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">⬇ {t.fields.export}</Link> : null}
      </div>

      {/* Summary cards */}
      <section aria-label={t.sections.summary} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[[t.cards.pageViews, fmtNum(overview.pageViews)], [t.cards.sessions, fmtNum(overview.sessions)], [t.cards.approxVisitors, fmtNum(overview.approximateUniqueVisitors)], [t.cards.engagedSessions, fmtNum(overview.engagedSessions)], [t.cards.bounceRate, fmtPct(overview.bounceRate)], [t.cards.conversionRate, fmtPct(overview.conversionRate)]].map(([l, v]) => (
          <Card key={l} className="p-4"><div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{l}</div><div className="mt-1 text-xl font-semibold">{v}</div></Card>
        ))}
      </section>

      {/* Traffic over time — accessible table (chart-summary equivalent) */}
      <Section title={t.sections.overTime}>
        <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-xs"><caption className="sr-only">{t.sections.overTime}</caption>
          <thead><tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]"><th scope="col" className="px-4 py-2">{t.fields.when}</th><th scope="col" className="px-3 py-2">{t.cards.pageViews}</th></tr></thead>
          <tbody>{series.points.length === 0 ? <tr><td colSpan={2} className="px-4 py-3 text-[var(--color-muted)]">{t.fields.empty}</td></tr> : series.points.map((p) => <tr key={p.date} className="border-b border-[var(--color-border)] last:border-0"><td className="px-4 py-1.5 whitespace-nowrap">{p.date}</td><td className="px-3 py-1.5">{fmtNum(p.value)}</td></tr>)}</tbody>
        </table></div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <GroupTable t={t} title={t.sections.topPages} data={pages} labelKey={(k) => k} />
        <GroupTable t={t} title={t.sections.acquisition} data={acquisition} labelKey={(k) => t.referrerLabel[k] ?? k} />
        <GroupTable t={t} title={t.sections.devices} data={devices} labelKey={(k) => t.deviceLabel[k] ?? k} />
        <GroupTable t={t} title={t.sections.browsers} data={browsers} labelKey={(k) => t.browserLabel[k] ?? k} />
        <GroupTable t={t} title={t.sections.operatingSystems} data={os} labelKey={(k) => t.osLabel[k] ?? k} />
        <GroupTable t={t} title={t.sections.countries} data={countries} labelKey={(k) => k} />
        <GroupTable t={t} title={t.sections.languages} data={languages} labelKey={(k) => k} />
      </div>

      {/* Funnels */}
      <Section title={t.sections.funnels}>
        <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-xs"><caption className="sr-only">{t.sections.funnels}</caption>
          <thead><tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]"><th scope="col" className="px-4 py-2">{t.sections.funnels}</th><th scope="col" className="px-3 py-2">{t.fields.started}</th><th scope="col" className="px-3 py-2">{t.fields.completed}</th><th scope="col" className="px-3 py-2">{t.fields.completionRate}</th></tr></thead>
          <tbody>{([["registration", funnels.registration], ["contact", funnels.contact], ["integration", funnels.integration]] as const).map(([k, f]) => <tr key={k} className="border-b border-[var(--color-border)] last:border-0"><td className="px-4 py-1.5">{k}</td><td className="px-3 py-1.5">{fmtNum(f.started)}</td><td className="px-3 py-1.5">{fmtNum(f.completed)}</td><td className="px-3 py-1.5">{fmtPct(f.completionRate)}</td></tr>)}</tbody>
        </table></div>
      </Section>

      {/* Conversions */}
      <Section title={t.sections.conversions}>
        <ul className="grid gap-1.5 p-1 text-xs sm:grid-cols-2">{conversions.byEvent.map((c) => <li key={c.eventType} className="flex justify-between rounded-lg bg-[var(--color-neutral-soft)] px-3 py-1.5"><span>{t.conversionLabel[c.eventType] ?? c.eventType}</span><strong>{fmtNum(c.count)}</strong></li>)}</ul>
      </Section>

      {/* Bot traffic (shown separately) */}
      <Section title={t.sections.botTraffic}>
        <ul className="flex flex-wrap gap-2 p-1 text-xs">{bots.rows.map((b) => <li key={b.botClassification}><Badge tone={botTone(b.botClassification)}>{t.botLabel[b.botClassification] ?? b.botClassification}: {fmtNum(b.pageViews)}</Badge></li>)}</ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{title}</h2>
      <Card className="p-2">{children}</Card>
    </section>
  );
}
function GroupTable({ t, title, data, labelKey }: { t: AdminCopy; title: string; data: { rows: Array<{ key: string; count: number; sessions: number; conversions: number }>; suppressedGroups: number }; labelKey: (k: string) => string }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{title}</h2>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[320px] text-xs"><caption className="sr-only">{title}</caption>
          <thead><tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]"><th scope="col" className="px-4 py-2">{t.fields.metric}</th><th scope="col" className="px-3 py-2">{t.fields.count}</th></tr></thead>
          <tbody>{data.rows.length === 0 ? <tr><td colSpan={2} className="px-4 py-3 text-[var(--color-muted)]">{t.fields.empty}</td></tr> : data.rows.map((r) => <tr key={r.key} className="border-b border-[var(--color-border)] last:border-0"><td className="px-4 py-1.5 font-mono">{labelKey(r.key) || "—"}</td><td className="px-3 py-1.5">{fmtNum(r.count)}</td></tr>)}</tbody>
        </table>
        {data.suppressedGroups > 0 ? <p className="px-4 py-1.5 text-[10px] text-[var(--color-muted)]">{data.suppressedGroups} {t.fields.suppressed}</p> : null}
      </Card>
    </section>
  );
}
