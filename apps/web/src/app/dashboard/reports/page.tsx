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
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { navItem } from "@/lib/nav";
import { humanize, formatDateTime } from "@/lib/format";
import { RISK_TONE } from "@/lib/ui-maps";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/reports");

export default async function ReportsPage() {
  const session = await requireSession();
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
    .map((lvl) => ({ label: humanize(lvl), value: riskMap.get(lvl) ?? 0, tone: RISK_TONE[lvl] }))
    .filter((r) => r.value > 0);

  const platformRows = platformGroups.map((g) => ({ label: PLATFORM_META[g.platform as Platform].label, value: g._count as unknown as number }));

  const healthy = accounts.filter((a) => a.health === ConnectorHealth.Healthy).length;
  const attention = accounts.filter((a) => a.health === ConnectorHealth.Degraded || a.health === ConnectorHealth.Error).length;

  return (
    <>
      <PageHeader
        title={nav.label}
        description={nav.description}
        action={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">Last 7 days</Badge>
            <SecondaryButton type="button" disabled title="Export is coming soon">
              Export · Coming soon
            </SecondaryButton>
          </div>
        }
      />

      {/* Weekly summary */}
      <SectionHeader title="Weekly summary" description="Reputation activity over the last 7 days" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Items received" value={String(itemsThisWeek)} tone="brand" />
        <StatCard label="High risk" value={String(highThisWeek)} tone="danger" />
        <StatCard label="Resolved" value={String(resolvedThisWeek)} tone="ok" />
        <StatCard label="Pending approvals" value={String(pending)} tone="warn" hint="All time" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Risk breakdown" description="All items by risk level" />
          {riskRows.length === 0 ? <p className="py-8 text-center text-sm text-[var(--color-muted)]">No items yet.</p> : <BarList rows={riskRows} />}
        </Card>
        <Card>
          <SectionHeader title="Platform breakdown" description="All items by platform" />
          {platformRows.length === 0 ? <p className="py-8 text-center text-sm text-[var(--color-muted)]">No items yet.</p> : <BarList rows={platformRows} />}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Pending approvals" action={<Link href="/dashboard/approvals" className="text-xs font-medium text-[var(--color-brand)] hover:underline">Open queue →</Link>} />
          <p className="text-3xl font-semibold">{pending}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">Proposals awaiting review. Nothing runs until approved and executed.</p>
        </Card>
        <Card>
          <SectionHeader title="Sync health" action={<Link href="/dashboard/accounts" className="text-xs font-medium text-[var(--color-brand)] hover:underline">Accounts →</Link>} />
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{accounts.length} connected</Badge>
            <Badge tone="ok">{healthy} healthy</Badge>
            {attention > 0 ? <Badge tone="warn">{attention} need attention</Badge> : null}
          </div>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            {lastRun ? `Last sync ${formatDateTime(lastRun.startedAt)} · ${lastRun.mock ? "mock" : "live"} · ${humanize(lastRun.status)}` : "No sync has run yet."}
          </p>
        </Card>
      </div>

      {/* Sync monitoring */}
      <div className="mt-6">
        <Card>
          <SectionHeader title="Sync monitoring" description="Read-only sync reliability over the last runs" action={<Link href="/dashboard/accounts" className="text-xs font-medium text-[var(--color-brand)] hover:underline">Accounts →</Link>} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Last sync" value={lastRun ? formatDateTime(lastRun.startedAt) : "—"} hint={lastRun ? `${lastRun.mock ? "mock" : "live"} · ${humanize(lastRun.status)}` : "no sync yet"} />
            <Metric label="Failed syncs" value={String(failedSyncs)} hint={`of last ${syncRuns.length} runs`} tone={failedSyncs > 0 ? "danger" : "ok"} />
            <Metric label="Avg. duration" value={avgDuration != null ? `${avgDuration} ms` : "—"} hint="completed runs" />
            <Metric label="Need reconnect" value={String(reconnectCount)} hint="accounts" tone={reconnectCount > 0 ? "warn" : "ok"} />
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Error categories (30 days)</p>
            {errorRows.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">No sync errors recorded. 🎉</p>
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
