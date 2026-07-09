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
import { getRealModeFilter } from "@/server/data-mode";
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
  const realMode = await getRealModeFilter(session.tenantId);
  const where = { tenantId: session.tenantId, ...realMode.brandWhere };
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

  // Auto-Protect report (shadow mode — no live action).
  const [apByDecision, apByCategory, apWouldHideItems, apPreservedItems] = await Promise.all([
    prisma.autoProtectDecision.groupBy({ by: ["decision"], where, _count: true }),
    prisma.autoProtectDecision.groupBy({ by: ["matchedCategory"], where, _count: true }),
    prisma.autoProtectDecision.findMany({ where: { ...where, decision: "would_auto_hide" }, orderBy: { createdAt: "desc" }, take: 5, select: { matchedCategory: true, confidence: true, itemId: true } }),
    prisma.autoProtectDecision.findMany({ where: { ...where, matchedCategory: "normal_criticism" }, orderBy: { createdAt: "desc" }, take: 5, select: { itemId: true } }),
  ]);
  const apDec = new Map(apByDecision.map((g) => [g.decision, g._count as unknown as number]));
  const apCatRows = apByCategory
    .map((g) => ({ category: g.matchedCategory, value: g._count as unknown as number }))
    .filter((r) => r.category !== "normal_criticism")
    .sort((a, b) => b.value - a.value);
  const apPreservedCount = (apDec.get("monitor") ?? 0) + (apDec.get("no_action") ?? 0) + (apDec.get("blocked_by_safety") ?? 0);
  const wouldHideItemIds = apWouldHideItems.map((d) => d.itemId);
  const preservedItemIds = apPreservedItems.map((d) => d.itemId);
  const apItemTexts = new Map(
    (await prisma.reputationItem.findMany({ where: { id: { in: [...wouldHideItemIds, ...preservedItemIds] } }, select: { id: true, contentItem: { select: { text: true } } } }))
      .map((r) => [r.id, r.contentItem.text]),
  );

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

      {/* Auto-Protect report (shadow mode) */}
      <div id="auto-protect" className="mt-8 scroll-mt-24">
        <SectionHeader title={`🛡️ ${hdrT.autoProtect.reportTitle}`} description={hdrT.autoProtect.summaryTitle} action={<Badge tone="neutral">{hdrT.autoProtect.shadowOnly}</Badge>} />
        <div className="mb-4 rounded-lg border border-[var(--color-ok)] bg-[var(--color-ok-soft,transparent)] px-3 py-2 text-xs">
          ✅ <span className="font-medium">{hdrT.autoProtect.noLiveAction}</span> · {hdrT.autoProtect.liveDisabled}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label={hdrT.autoProtect.mWouldHide} value={String(apDec.get("would_auto_hide") ?? 0)} tone="warn" />
          <Metric label={hdrT.autoProtect.mSentApproval} value={String(apDec.get("requires_approval") ?? 0)} tone="warn" />
          <Metric label={hdrT.autoProtect.mCriticism} value={String(apPreservedCount)} tone="ok" />
          <Metric label={hdrT.autoProtect.mLiveActions} value="0" hint={hdrT.autoProtect.liveDisabled} tone="ok" />
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionHeader title={hdrT.autoProtect.topHarmful} description={hdrT.autoProtect.categoryBreakdown} />
            {apCatRows.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-muted)]">{hdrT.autoProtect.noItems}</p>
            ) : (
              <div className="mt-3 space-y-1.5">
                {apCatRows.slice(0, 8).map((r) => (
                  <div key={r.category} className="flex items-center justify-between text-sm">
                    <span>{tEnum(hdrT, "autoProtectCategory", r.category)}</span>
                    <span className="text-xs text-[var(--color-muted)]">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionHeader title={hdrT.autoProtect.notHiddenTitle} />
            <p className="mt-1 text-xs text-[var(--color-muted)]">{hdrT.autoProtect.notHiddenBody}</p>
            <div className="mt-3 space-y-1.5">
              {preservedItemIds.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">{hdrT.autoProtect.noItems}</p>
              ) : (
                preservedItemIds.map((id) => (
                  <Link key={id} href={`/dashboard/inbox/${id}`} className="block truncate rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-border-strong)]">
                    ✅ {apItemTexts.get(id) ?? ""}
                  </Link>
                ))
              )}
            </div>
          </Card>
        </div>

        <Card className="mt-4">
          <SectionHeader title={hdrT.autoProtect.recentWouldHide} action={<Badge tone="warn">{hdrT.autoProtect.shadowOnly}</Badge>} />
          <div className="mt-3 space-y-1.5">
            {apWouldHideItems.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{hdrT.autoProtect.noItems}</p>
            ) : (
              apWouldHideItems.map((d) => (
                <Link key={d.itemId} href={`/dashboard/inbox/${d.itemId}`} className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-border-strong)]">
                  <span className="truncate">{apItemTexts.get(d.itemId) ?? ""}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Badge tone="warn">{tEnum(hdrT, "autoProtectCategory", d.matchedCategory)}</Badge>
                    <span className="text-[var(--color-muted)]">{(d.confidence * 100).toFixed(0)}%</span>
                  </span>
                </Link>
              ))
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
