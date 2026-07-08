import Link from "next/link";
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
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { humanize, formatDate, formatDateTime } from "@/lib/format";
import { bucketByDay } from "@/lib/trend";
import { RISK_TONE } from "@/lib/ui-maps";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const where = { tenantId: session.tenantId };
  const since30 = new Date(Date.now() - 30 * 86_400_000);

  const [
    received, highRisk, pending, connected, lastRun, risky, trendRows,
    riskGroups, platformGroups, catRows, syncRuns, incidents, accounts,
  ] = await Promise.all([
    prisma.reputationItem.count({ where }),
    prisma.reputationItem.count({ where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical] } } }),
    prisma.moderationDecision.count({ where: { ...where, status: DecisionStatus.Proposed } }),
    prisma.connectedAccount.count({ where: { ...where, status: { in: [ConnectorStatus.Active, ConnectorStatus.MockConnected] } } }),
    prisma.syncRun.findFirst({ where, orderBy: { startedAt: "desc" }, select: { startedAt: true, mock: true, status: true } }),
    prisma.reputationItem.findMany({ where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical, RiskLevel.Medium] } }, include: { contentItem: { select: { text: true, authorDisplayName: true } }, brand: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }], take: 6 }),
    prisma.reputationItem.findMany({ where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical] }, createdAt: { gte: since30 } }, select: { createdAt: true } }),
    prisma.reputationItem.groupBy({ by: ["riskLevel"], where, _count: true }),
    prisma.reputationItem.groupBy({ by: ["platform"], where, _count: true }),
    prisma.reputationItem.findMany({ where, select: { riskCategories: true }, take: 1000 }),
    prisma.syncRun.findMany({ where, orderBy: { startedAt: "desc" }, take: 100, select: { status: true, durationMs: true } }),
    prisma.syncRun.findMany({ where: { ...where, status: "failed" }, orderBy: { startedAt: "desc" }, take: 4, select: { startedAt: true, error: true } }),
    prisma.connectedAccount.findMany({ where: { ...where, status: { in: [ConnectorStatus.Active, ConnectorStatus.MockConnected] } }, select: { health: true } }),
  ]);

  const trend = bucketByDay(trendRows.map((r) => r.createdAt), 30);
  const firstName = session.userName.split(" ")[0] ?? session.userName;

  const riskMap = new Map(riskGroups.map((g) => [g.riskLevel, g._count as unknown as number]));
  const riskRows = [RiskLevel.Critical, RiskLevel.High, RiskLevel.Medium, RiskLevel.Low, RiskLevel.None]
    .map((l) => ({ label: humanize(l), value: riskMap.get(l) ?? 0, tone: RISK_TONE[l] }))
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
      <PageHeader
        eyebrow="Overview"
        title={`Welcome back, ${firstName}`}
        description="Here's what's happening with your brand reputation today."
        action={<Link href="/dashboard/accounts"><PrimaryButton type="button">Connect an account</PrimaryButton></Link>}
      />

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Received items" value={String(received)} tone="brand" icon={<IconInbox />} hint="All time" />
        <StatCard label="High risk" value={String(highRisk)} tone="danger" icon={<IconAlert />} hint="High or critical" />
        <StatCard label="Pending approvals" value={String(pending)} tone="warn" icon={<IconClock />} hint="Awaiting review" />
        <StatCard label="Connected accounts" value={String(connected)} tone="ok" icon={<IconPlug />} hint="Across brands" />
        <StatCard label="Last sync" value={lastRun ? formatDate(lastRun.startedAt) : "—"} icon={<IconSync />} hint={lastRun ? `${lastRun.mock ? "mock" : "live"} · ${humanize(lastRun.status)}` : "No sync yet"} />
      </div>

      {received === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No reputation items yet"
            body="Connect a platform and run a read-only sync, or seed the dev workspace to explore Guardora."
            hint="Connectors run in read-only mode — no moderation actions are taken."
            action={<Link href="/dashboard/accounts"><PrimaryButton type="button">Go to accounts</PrimaryButton></Link>}
          />
        </div>
      ) : (
        <>
          {/* Trend + latest risky */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            <Card>
              <SectionHeader title="Risk trend" description="High & critical items over the last 30 days" action={<Link href="/dashboard/insights" className="text-xs font-medium text-[var(--color-brand)] hover:underline">View insights →</Link>} />
              {trendRows.length === 0 ? <p className="py-10 text-center text-sm text-[var(--color-muted)]">No risky items in the last 30 days.</p> : <TrendChart buckets={trend} />}
            </Card>
            <Card>
              <SectionHeader title="Latest risky items" action={<Link href="/dashboard/inbox" className="text-xs font-medium text-[var(--color-brand)] hover:underline">Open inbox →</Link>} />
              <ul className="-mx-2 space-y-0.5">
                {risky.map((it) => (
                  <li key={it.id}>
                    <Link href={`/dashboard/inbox/${it.id}`} className="flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-[var(--color-surface-2)]">
                      <PlatformIcon platform={it.platform} size={22} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 text-sm">{it.contentItem.text}</span>
                        <span className="mt-0.5 block text-xs text-[var(--color-muted)]">{it.brand.name} · {PLATFORM_META[it.platform as Platform].label}</span>
                      </span>
                      <Badge tone={RISK_TONE[it.riskLevel as RiskLevel]}>{humanize(it.riskLevel)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {/* Breakdowns + topics */}
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card>
              <SectionHeader title="Risk breakdown" description="All items by level" />
              <BarList rows={riskRows} />
            </Card>
            <Card>
              <SectionHeader title="Platform breakdown" />
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
              <SectionHeader title="Top risky topics" action={<Link href="/dashboard/insights?tab=topics" className="text-xs font-medium text-[var(--color-brand)] hover:underline">All →</Link>} />
              <div className="flex flex-wrap gap-2">
                {topTopics.map(([cat, n]) => (
                  <span key={cat} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-sm">
                    {humanize(cat)}<span className="text-xs text-[var(--color-muted)]">{n}</span>
                  </span>
                ))}
              </div>
            </Card>
          </div>

          {/* Sync health + incidents */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <SectionHeader title="Sync health" action={<Link href="/dashboard/accounts" className="text-xs font-medium text-[var(--color-brand)] hover:underline">Accounts →</Link>} />
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{accounts.length} connected</Badge>
                <Badge tone="ok">{healthyAccounts} healthy</Badge>
                {needAttention > 0 ? <Badge tone="warn">{needAttention} need attention</Badge> : null}
                {failedSyncs > 0 ? <Badge tone="danger">{failedSyncs} failed runs</Badge> : null}
              </div>
              <p className="mt-3 text-sm text-[var(--color-muted)]">
                {avgDuration != null ? `Avg. sync ${avgDuration} ms · ` : ""}
                {lastRun ? `last ${formatDate(lastRun.startedAt)} (${lastRun.mock ? "mock" : "live"})` : "no sync yet"}
              </p>
            </Card>
            <Card>
              <SectionHeader title="Recent incidents" />
              {incidents.length === 0 ? (
                <p className="py-4 text-sm text-[var(--color-muted)]">No incidents. All syncs healthy. 🎉</p>
              ) : (
                <ul className="space-y-2">
                  {incidents.map((i, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-danger)]" />
                      <span className="min-w-0">
                        <span className="block truncate text-[var(--color-fg)]">{i.error ?? "Sync failed"}</span>
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
  );
}

function IconInbox() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13l3.5 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5L5.5 5Z" /></svg>; }
function IconAlert() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>; }
function IconClock() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>; }
function IconPlug() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5" /></svg>; }
function IconSync() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M3 21v-5h5M21 3v5h-5" /></svg>; }
