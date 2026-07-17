import Link from "next/link";
import { TrackView } from "@/components/analytics/track-view";
import {
  PLATFORM_META,
  Platform,
  RiskLevel,
  ConnectorStatus,
  ConnectorHealth,
  DecisionStatus,
} from "@guardora/core";
import {
  PageHeader,
  StatCard,
  Card,
  SectionHeader,
  Badge,
  EmptyState,
  PrimaryButton,
} from "@/components/dashboard/ui";
import { TrendChart, BarList } from "@/components/dashboard/trend-chart";
import { PlatformIcon } from "@/components/dashboard/platform-icon";
import { RiskActivitySection } from "@/components/dashboard/risk-activity-section";
import { SyncOverview } from "@/components/dashboard/sync-overview";
import { requireSession } from "@/server/auth";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { withEmoji, ICON } from "@/lib/enum-emoji";
import { withTenant, getDashboardKpis } from "@guardora/db";
import { getRealModeFilter } from "@/server/data-mode";
import { getLocale } from "@/i18n/locale-server";
import { formatDate, formatDateTime } from "@/lib/format";
import { bucketByDay } from "@/lib/trend";
import { RISK_TONE } from "@/lib/ui-maps";

export const dynamic = "force-dynamic";

const KPI_COPY = {
  en: { heading: "Protection overview", tf: "Timeframe", days: "d", analyzed: "Analyzed comments", risk: "Risk comments", autoHidden: "Auto-hidden", pending: "Pending review", problem: "Accounts with problem" },
  sk: { heading: "Prehľad ochrany", tf: "Obdobie", days: "d", analyzed: "Analyzované komentáre", risk: "Rizikové komentáre", autoHidden: "Automaticky skryté", pending: "Čakajúce na rozhodnutie", problem: "Účty s problémom" },
  de: { heading: "Schutzübersicht", tf: "Zeitraum", days: "T", analyzed: "Analysierte Kommentare", risk: "Risiko-Kommentare", autoHidden: "Automatisch verborgen", pending: "Zur Prüfung", problem: "Konten mit Problem" },
} as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tf?: string }> }) {
  const session = await requireSession();
  const t = await getT();
  const locale = await getLocale();
  const realMode = await getRealModeFilter(session.tenantId);
  const where = { tenantId: session.tenantId, ...realMode.brandWhere };
  const since30 = new Date(Date.now() - 30 * 86_400_000);

  // V1.59 — product KPI strip: real, timeframe-aware, clickable. Uses the tested getDashboardKpis.
  const tf = [7, 30, 90].includes(Number((await searchParams).tf)) ? Number((await searchParams).tf) : 30;
  const kpiSince = new Date(Date.now() - tf * 86_400_000);
  const kpi = await getDashboardKpis(session.tenantId, kpiSince);
  const kc = KPI_COPY[locale];

  const [
    received, highRisk, pending, connected, lastRun, risky, trendRows,
    riskGroups, platformGroups, catRows, syncRuns, incidents, accounts,
    autoDecisionGroups, apCriticismCount, actionExecGroups,
  ] = await withTenant(session.tenantId, (db) => Promise.all([
    db.reputationItem.count({ where }),
    db.reputationItem.count({ where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical] } } }),
    db.moderationDecision.count({ where: { ...where, status: DecisionStatus.Proposed } }),
    db.connectedAccount.count({ where: { ...where, status: { in: [ConnectorStatus.Active, ConnectorStatus.MockConnected] } } }),
    db.syncRun.findFirst({ where, orderBy: { startedAt: "desc" }, select: { startedAt: true, mock: true, status: true } }),
    db.reputationItem.findMany({ where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical, RiskLevel.Medium] } }, include: { contentItem: { select: { text: true, authorDisplayName: true } }, brand: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }], take: 6 }),
    db.reputationItem.findMany({ where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical] }, createdAt: { gte: since30 } }, select: { createdAt: true } }),
    db.reputationItem.groupBy({ by: ["riskLevel"], where, _count: true }),
    db.reputationItem.groupBy({ by: ["platform"], where, _count: true }),
    db.reputationItem.findMany({ where, select: { riskCategories: true }, take: 1000 }),
    db.syncRun.findMany({ where, orderBy: { startedAt: "desc" }, take: 100, select: { status: true, durationMs: true } }),
    db.syncRun.findMany({ where: { ...where, status: "failed" }, orderBy: { startedAt: "desc" }, take: 4, select: { startedAt: true, error: true } }),
    db.connectedAccount.findMany({ where: { ...where, status: { in: [ConnectorStatus.Active, ConnectorStatus.MockConnected] } }, select: { health: true } }),
    db.autoProtectDecision.groupBy({ by: ["decision"], where, _count: true }),
    db.autoProtectDecision.count({ where: { ...where, matchedCategory: "normal_criticism" } }),
    db.platformActionExecution.groupBy({ by: ["status"], where, _count: true }),
  ]));

  const apxMap = new Map(actionExecGroups.map((g) => [g.status, g._count as unknown as number]));
  const liveExecuted = apxMap.get("executed") ?? 0;
  const liveDryRun = apxMap.get("dry_run") ?? 0;
  const liveBlocked = apxMap.get("blocked") ?? 0;

  const apMap = new Map(autoDecisionGroups.map((g) => [g.decision, g._count as unknown as number]));
  const apWouldHide = apMap.get("would_auto_hide") ?? 0;
  const apApproval = apMap.get("requires_approval") ?? 0;
  const apCriticism = apCriticismCount;
  const apProtected = apWouldHide + apApproval;

  const trend = bucketByDay(trendRows.map((r) => r.createdAt), 30);
  const firstName = session.userName.split(" ")[0] ?? session.userName;

  const riskMap = new Map(riskGroups.map((g) => [g.riskLevel, g._count as unknown as number]));
  const riskRows = [RiskLevel.Critical, RiskLevel.High, RiskLevel.Medium, RiskLevel.Low, RiskLevel.None]
    .map((l) => ({ label: withEmoji("risk", l, tEnum(t, "risk", l)), value: riskMap.get(l) ?? 0, tone: RISK_TONE[l] }))
    .filter((r) => r.value > 0);

  const platformRows = platformGroups
    .map((g) => ({ platform: g.platform as string, value: g._count as unknown as number }))
    .sort((a, b) => b.value - a.value);
  const platformMax = Math.max(1, ...platformRows.map((p) => p.value));

  const catCount = new Map<string, number>();
  for (const r of catRows) for (const c of r.riskCategories) catCount.set(c, (catCount.get(c) ?? 0) + 1);
  const topTopics = [...catCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const failedSyncs = syncRuns.filter((r) => r.status === "failed").length;
  const durs = syncRuns.map((r) => r.durationMs).filter((d): d is number => typeof d === "number");
  const avgDuration = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null;
  const healthyAccounts = accounts.filter((a) => a.health === ConnectorHealth.Healthy).length;
  const needAttention = accounts.filter((a) => a.health === ConnectorHealth.Degraded || a.health === ConnectorHealth.Error).length;

  return (
    <>
      <TrackView event="dashboard_opened" />
      <PageHeader
        eyebrow={t.home.eyebrow}
        title={`${t.home.greeting}, ${firstName}`}
        description={t.home.subtitle}
        action={<Link href="/dashboard/accounts"><PrimaryButton type="button">{t.ui.connectAccount}</PrimaryButton></Link>}
      />

      {realMode.isRealMode ? (
        <div className="mb-4 rounded-lg border border-[var(--color-brand)] px-3 py-2 text-sm">
          🧪 <span className="font-medium">{t.dash.realTestMode}</span> · <span className="text-[var(--color-muted)]">{t.dash.realTestModeHint}</span>
        </div>
      ) : null}

      {/* V1.59 — real product KPIs (timeframe-aware, each card links to its filtered list — never a dead card). */}
      <section aria-label={kc.heading} className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{kc.heading}</h2>
          <div className="flex gap-1" role="group" aria-label={kc.tf}>
            {[7, 30, 90].map((d) => (
              <Link key={d} href={`/dashboard?tf=${d}`} aria-current={tf === d ? "true" : undefined}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${tf === d ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]" : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-brand)]"}`}>
                {d}{kc.days}
              </Link>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Link href="/dashboard/comments" className="block"><StatCard label={kc.analyzed} value={String(kpi.analyzedComments)} tone="brand" /></Link>
          <Link href="/dashboard/comments?risk=high" className="block"><StatCard label={kc.risk} value={String(kpi.riskComments)} tone="danger" /></Link>
          <Link href="/dashboard/action-queue?state=executed" className="block"><StatCard label={kc.autoHidden} value={String(kpi.autoHidden)} tone="warn" /></Link>
          <Link href="/dashboard/action-queue" className="block"><StatCard label={kc.pending} value={String(kpi.pending)} tone="warn" /></Link>
          <Link href="/dashboard/accounts" className="block"><StatCard label={kc.problem} value={String(kpi.accountsWithProblem)} tone={kpi.accountsWithProblem > 0 ? "danger" : "ok"} /></Link>
        </div>
      </section>

      {/* V1.59 — Risk distribution (by category) + Recent activity, both from real data. */}
      <RiskActivitySection tenantId={session.tenantId} locale={locale} />

      {/* V1.59 — Automatic synchronization overview (Vercel Cron; no worker concept), real data only. */}
      <SyncOverview tenantId={session.tenantId} locale={locale} />

      {realMode.isRealMode && received === 0 ? (
        <EmptyState
          title={t.dash.noRealComments}
          body={t.dash.noRealCommentsHint}
          action={<Link href="/dashboard/accounts"><PrimaryButton type="button">{t.ui.goToAccounts}</PrimaryButton></Link>}
        />
      ) : (
      <>
      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label={t.home.kpiReceived} value={String(received)} tone="brand" icon={<IconInbox />} hint={t.home.kpiReceivedHint} />
        <StatCard label={t.home.kpiHighRisk} value={String(highRisk)} tone="danger" icon={<IconAlert />} hint={t.home.kpiHighRiskHint} />
        <StatCard label={t.home.kpiPending} value={String(pending)} tone="warn" icon={<IconClock />} hint={t.home.kpiPendingHint} />
        <StatCard label={t.home.kpiConnected} value={String(connected)} tone="ok" icon={<IconPlug />} hint={t.home.kpiConnectedHint} />
        <StatCard label={t.home.kpiLastSync} value={lastRun ? formatDate(lastRun.startedAt) : "—"} icon={<IconSync />} hint={lastRun ? `${lastRun.mock ? t.home.mock : t.home.live} · ${tEnum(t, "syncStatus", lastRun.status)}` : t.home.noSyncYet} />
      </div>

      {/* Auto-Protect value (shadow mode — no live action) */}
      {received > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">🛡️ {t.autoProtect.valueTitle}</h2>
            <Badge tone="neutral">{t.autoProtect.shadowOnly}</Badge>
            <span className="text-xs text-[var(--color-muted)]">{t.autoProtect.liveDisabled}</span>
            <Link href="/dashboard/reports#auto-protect" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{t.autoProtect.reportTitle} →</Link>
          </div>
          <p className="mb-3 max-w-3xl text-xs text-[var(--color-muted)]">{t.autoProtect.valueIntro}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label={t.autoProtect.mProtectedShadow} value={String(apProtected)} tone="brand" />
            <StatCard label={t.autoProtect.mWouldHide} value={String(apWouldHide)} tone="warn" />
            <StatCard label={t.autoProtect.mSentApproval} value={String(apApproval)} tone="brand" />
            <StatCard label={t.autoProtect.mCriticism} value={String(apCriticism)} tone="ok" />
            <StatCard label={t.autoProtect.mLiveActions} value={String(liveExecuted)} tone={liveExecuted > 0 ? "warn" : "ok"} hint={t.autoProtect.liveDisabled} />
          </div>
          {liveDryRun > 0 || liveBlocked > 0 ? (
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard label={t.autoProtect.mDryRunHide} value={String(liveDryRun)} tone="neutral" />
              <StatCard label={t.autoProtect.mBlockedLive} value={String(liveBlocked)} tone="neutral" />
            </div>
          ) : null}
        </div>
      ) : null}

      {received === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t.ui.emptyDashboardTitle}
            body={t.ui.emptyDashboardBody}
            hint={t.ui.emptyDashboardHint}
            action={<Link href="/dashboard/accounts"><PrimaryButton type="button">{t.ui.goToAccounts}</PrimaryButton></Link>}
          />
        </div>
      ) : (
        <>
          {/* Trend + latest risky */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            <Card>
              <SectionHeader title={t.home.riskTrend} description={t.home.riskTrendDesc} action={<Link href="/dashboard/insights" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{t.ui.viewInsights}</Link>} />
              {trendRows.length === 0 ? <p className="py-10 text-center text-sm text-[var(--color-muted)]">{t.home.noRiskyItems30}</p> : <TrendChart buckets={trend} />}
            </Card>
            <Card>
              <SectionHeader title={t.home.latestRisky} action={<Link href="/dashboard/inbox" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{t.ui.openInbox}</Link>} />
              <ul className="-mx-2 space-y-0.5">
                {risky.map((it) => (
                  <li key={it.id}>
                    <Link href={`/dashboard/inbox/${it.id}`} className="flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-[var(--color-surface-2)]">
                      <PlatformIcon platform={it.platform} size={22} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 text-sm">{it.contentItem.text}</span>
                        <span className="mt-0.5 block text-xs text-[var(--color-muted)]">{it.brand.name} · {PLATFORM_META[it.platform as Platform].label}</span>
                      </span>
                      <Badge tone={RISK_TONE[it.riskLevel as RiskLevel]}>{withEmoji("risk", it.riskLevel, tEnum(t, "risk", it.riskLevel))}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {/* Breakdowns + topics */}
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card>
              <SectionHeader title={t.home.riskBreakdown} description={t.home.allItemsByLevel} />
              <BarList rows={riskRows} />
            </Card>
            <Card>
              <SectionHeader title={t.home.platformBreakdown} />
              <div className="space-y-2.5">
                {platformRows.map((p) => (
                  <div key={p.platform} className="flex items-center gap-2.5 text-sm">
                    <PlatformIcon platform={p.platform} size={22} />
                    <span className="w-28 shrink-0 truncate text-[var(--color-muted)]">{PLATFORM_META[p.platform as Platform].label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]"><div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${(p.value / platformMax) * 100}%` }} /></div>
                    <span className="w-7 text-right text-xs font-medium">{p.value}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <SectionHeader title={t.home.topTopics} action={<Link href="/dashboard/insights?tab=topics" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{t.ui.allLink}</Link>} />
              <div className="flex flex-wrap gap-2">
                {topTopics.map(([cat, n]) => (
                  <span key={cat} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-sm">
                    {withEmoji("category", cat, tEnum(t, "category", cat))}<span className="text-xs text-[var(--color-muted)]">{n}</span>
                  </span>
                ))}
              </div>
            </Card>
          </div>

          {/* Sync health + incidents */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <SectionHeader title={t.home.syncHealth} action={<Link href="/dashboard/accounts" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{t.ui.accountsLink}</Link>} />
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{accounts.length} {t.home.badgeConnected}</Badge>
                <Badge tone="ok">{healthyAccounts} {t.home.badgeHealthy}</Badge>
                {needAttention > 0 ? <Badge tone="warn">{needAttention} {t.home.badgeNeedAttention}</Badge> : null}
                {failedSyncs > 0 ? <Badge tone="danger">{failedSyncs} {t.home.badgeFailedRuns}</Badge> : null}
              </div>
              <p className="mt-3 text-sm text-[var(--color-muted)]">
                {avgDuration != null ? `${t.home.avgSync} ${avgDuration} ms · ` : ""}
                {lastRun ? `${t.home.last} ${formatDate(lastRun.startedAt)} (${lastRun.mock ? t.home.mock : t.home.live})` : t.home.noSyncYetLower}
              </p>
            </Card>
            <Card>
              <SectionHeader title={t.home.recentIncidents} />
              {incidents.length === 0 ? (
                <p className="py-4 text-sm text-[var(--color-muted)]">{t.home.noIncidents}</p>
              ) : (
                <ul className="space-y-2">
                  {incidents.map((i, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-danger)]" />
                      <span className="min-w-0">
                        <span className="block truncate text-[var(--color-fg)]">{ICON.incident} {i.error ?? t.home.syncFailed}</span>
                        <span className="text-xs text-[var(--color-muted)]">{formatDateTime(i.startedAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
      </>
      )}
    </>
  );
}

function IconInbox() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13l3.5 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5L5.5 5Z" /></svg>; }
function IconAlert() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>; }
function IconClock() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>; }
function IconPlug() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5" /></svg>; }
function IconSync() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M3 21v-5h5M21 3v5h-5" /></svg>; }
