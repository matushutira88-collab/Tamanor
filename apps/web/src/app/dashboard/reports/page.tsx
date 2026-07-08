import Link from "next/link";
import {
  PLATFORM_META,
  Platform,
  RiskLevel,
  ReputationStatus,
  DecisionStatus,
  ConnectorStatus,
  ConnectorHealth,
} from "@guardora/core";
import { PageHeader, Card, SectionHeader, StatCard, Badge, SecondaryButton } from "@/components/dashboard/ui";
import { BarList } from "@/components/dashboard/trend-chart";
import { PlatformBreakdown } from "@/components/dashboard/platform-icon";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { navItem } from "@/lib/nav";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { withEmoji } from "@/lib/enum-emoji";
import { formatDateTime } from "@/lib/format";
import { RISK_TONE } from "@/lib/ui-maps";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/reports");

export default async function ReportsPage() {
  const session = await requireSession();
  const hdrT = await getT();
  const where = { tenantId: session.tenantId };
  const weekStart = new Date(Date.now() - 7 * 86_400_000);

  const [
    itemsThisWeek,
    highThisWeek,
    resolvedThisWeek,
    pending,
    riskGroups,
    platformGroups,
    accounts,
    lastRun,
    syncRuns,
    syncAuditRows,
    reconnectCount,
  ] = await Promise.all([
    prisma.reputationItem.count({ where: { ...where, createdAt: { gte: weekStart } } }),
    prisma.reputationItem.count({ where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical] }, createdAt: { gte: weekStart } } }),
    prisma.reputationItem.count({ where: { ...where, status: ReputationStatus.Resolved, updatedAt: { gte: weekStart } } }),
    prisma.moderationDecision.count({ where: { ...where, status: DecisionStatus.Proposed } }),
    prisma.reputationItem.groupBy({ by: ["riskLevel"], where, _count: true }),
    prisma.reputationItem.groupBy({ by: ["platform"], where, _count: true }),
    prisma.connectedAccount.findMany({
      where: { ...where, status: { in: [ConnectorStatus.Active, ConnectorStatus.MockConnected] } },
      select: { health: true },
    }),
    prisma.syncRun.findFirst({ where, orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true, mock: true } }),
    prisma.syncRun.findMany({ where, orderBy: { startedAt: "desc" }, take: 100, select: { status: true, durationMs: true } }),
    prisma.auditLog.findMany({ where: { ...where, event: { startsWith: "sync." }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, select: { event: true }, take: 500 }),
    prisma.connectedAccount.count({ where: { ...where, OR: [{ status: ConnectorStatus.Expired }, { health: { in: [ConnectorHealth.Degraded, ConnectorHealth.Error] } }] } }),
  ]);

  const failedSyncs = syncRuns.filter((r) => r.status === "failed").length;
  const durations = syncRuns.map((r) => r.durationMs).filter((d): d is number => typeof d === "number");
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  const errorCats = new Map<string, number>();
  for (const a of syncAuditRows) {
    if (a.event === "sync.completed" || a.event === "sync.started") continue;
    errorCats.set(a.event, (errorCats.get(a.event) ?? 0) + 1);
  }
  const errorRows = [...errorCats.entries()].sort((a, b) => b[1] - a[1]);

  const riskOrder = [RiskLevel.Critical, RiskLevel.High, RiskLevel.Medium, RiskLevel.Low, RiskLevel.None];
  const riskMap = new Map(riskGroups.map((g) => [g.riskLevel, g._count as unknown as number]));
  const riskRows = riskOrder
    .map((lvl) => ({ label: withEmoji("risk", lvl, tEnum(hdrT, "risk", lvl)), value: riskMap.get(lvl) ?? 0, tone: RISK_TONE[lvl] }))
    .filter((r) => r.value > 0);

  const platformRows = platformGroups.map((g) => ({ platform: g.platform as string, label: PLATFORM_META[g.platform as Platform].label, value: g._count as unknown as number })).sort((a, b) => b.value - a.value);

  const healthy = accounts.filter((a) => a.health === ConnectorHealth.Healthy).length;
  const attention = accounts.filter((a) => a.health === ConnectorHealth.Degraded || a.health === ConnectorHealth.Error).length;

  return (
    <>
      <PageHeader
        title={hdrT.dashHeaders[nav.icon].title}
        description={hdrT.dashHeaders[nav.icon].desc}
        action={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{hdrT.dash.last7days}</Badge>
            <SecondaryButton type="button" disabled title={hdrT.dash.exportComingSoonTitle}>
              {hdrT.dash.exportComingSoon}
            </SecondaryButton>
          </div>
        }
      />

      {/* Weekly summary */}
      <SectionHeader title={hdrT.dash.weeklySummary} description={hdrT.dash.weeklySummaryDesc} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={hdrT.dash.itemsReceived} value={String(itemsThisWeek)} tone="brand" />
        <StatCard label={hdrT.dash.highRisk} value={String(highThisWeek)} tone="danger" />
        <StatCard label={hdrT.dash.resolved} value={String(resolvedThisWeek)} tone="ok" />
        <StatCard label={hdrT.dash.pendingApprovals} value={String(pending)} tone="warn" hint={hdrT.dash.allTime} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title={hdrT.dash.riskBreakdown} description={hdrT.dash.allItemsByRisk} />
          {riskRows.length === 0 ? <p className="py-8 text-center text-sm text-[var(--color-muted)]">{hdrT.dash.noItemsYet}</p> : <BarList rows={riskRows} />}
        </Card>
        <Card>
          <SectionHeader title={hdrT.dash.platformBreakdown} description={hdrT.dash.allItemsByPlatform} />
          {platformRows.length === 0 ? <p className="py-8 text-center text-sm text-[var(--color-muted)]">{hdrT.dash.noItemsYet}</p> : <PlatformBreakdown rows={platformRows} />}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title={hdrT.dash.pendingApprovals} action={<Link href="/dashboard/approvals" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{hdrT.dash.openQueue}</Link>} />
          <p className="text-3xl font-semibold">{pending}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{hdrT.dash.proposalsAwaiting}</p>
        </Card>
        <Card>
          <SectionHeader title={hdrT.dash.syncHealth} action={<Link href="/dashboard/accounts" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{hdrT.dash.accountsLink}</Link>} />
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{accounts.length} {hdrT.dash.connected}</Badge>
            <Badge tone="ok">{healthy} {hdrT.dash.healthy}</Badge>
            {attention > 0 ? <Badge tone="warn">{attention} {hdrT.dash.needAttention}</Badge> : null}
          </div>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            {lastRun ? `${hdrT.dash.lastSync} ${formatDateTime(lastRun.startedAt)} · ${lastRun.mock ? "mock" : "live"} · ${tEnum(hdrT, "syncStatus", lastRun.status)}` : hdrT.dash.noSyncRun}
          </p>
        </Card>
      </div>

      {/* Sync monitoring */}
      <div className="mt-6">
        <Card>
          <SectionHeader title={hdrT.dash.syncMonitoring} description={hdrT.dash.syncMonitoringDesc} action={<Link href="/dashboard/accounts" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{hdrT.dash.accountsLink}</Link>} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label={hdrT.dash.lastSync} value={lastRun ? formatDateTime(lastRun.startedAt) : "—"} hint={lastRun ? `${lastRun.mock ? "mock" : "live"} · ${tEnum(hdrT, "syncStatus", lastRun.status)}` : hdrT.home.noSyncYetLower} />
            <Metric label={hdrT.dash.failedSyncs} value={String(failedSyncs)} hint={`${hdrT.dash.ofLast} ${syncRuns.length} ${hdrT.dash.runs}`} tone={failedSyncs > 0 ? "danger" : "ok"} />
            <Metric label={hdrT.dash.avgDuration} value={avgDuration != null ? `${avgDuration} ms` : "—"} hint={hdrT.dash.completedRuns} />
            <Metric label={hdrT.dash.needReconnect} value={String(reconnectCount)} hint={hdrT.dash.accountsWord} tone={reconnectCount > 0 ? "warn" : "ok"} />
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">{hdrT.dash.errorCategories30}</p>
            {errorRows.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{hdrT.dash.noSyncErrors}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {errorRows.map(([event, n]) => (
                  <span key={event} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-sm">
                    <span className="font-mono text-xs">{event.replace("sync.", "")}</span>
                    <span className="text-xs text-[var(--color-muted)]">{n}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <p className="mt-6 text-xs text-[var(--color-muted)]">
        Scheduled exports (PDF/CSV) and per-brand snapshots are coming soon. No export is generated today.
      </p>
    </>
  );
}

function Metric({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint?: string; tone?: string }) {
  const toneCls: Record<string, string> = {
    neutral: "text-[var(--color-fg)]",
    ok: "text-[var(--color-ok)]",
    warn: "text-[var(--color-warn)]",
    danger: "text-[var(--color-danger)]",
  };
  return (
    <div className="rounded-xl border border-[var(--color-border)] p-4">
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${toneCls[tone] ?? toneCls.neutral}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{hint}</p> : null}
    </div>
  );
}
