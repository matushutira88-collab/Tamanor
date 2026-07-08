import Link from "next/link";
import {
  PLATFORM_META,
  Platform,
  ReputationStatus,
  RiskLevel,
  ConnectorStatus,
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
import { TrendChart } from "@/components/dashboard/trend-chart";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { humanize, formatDate } from "@/lib/format";
import { bucketByDay } from "@/lib/trend";
import { RISK_TONE } from "@/lib/ui-maps";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const where = { tenantId: session.tenantId };

  const since14 = new Date(Date.now() - 14 * 86_400_000);
  const [received, highRisk, pending, connected, lastRun, risky, trendRows] =
    await Promise.all([
      prisma.reputationItem.count({ where }),
      prisma.reputationItem.count({
        where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical] } },
      }),
      prisma.moderationDecision.count({
        where: { ...where, status: DecisionStatus.Proposed },
      }),
      prisma.connectedAccount.count({
        where: {
          ...where,
          status: { in: [ConnectorStatus.Active, ConnectorStatus.MockConnected] },
        },
      }),
      prisma.syncRun.findFirst({
        where,
        orderBy: { startedAt: "desc" },
        select: { startedAt: true, mock: true, status: true },
      }),
      prisma.reputationItem.findMany({
        where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical, RiskLevel.Medium] } },
        include: { contentItem: { select: { text: true, authorDisplayName: true } }, brand: { select: { name: true } } },
        orderBy: [{ createdAt: "desc" }],
        take: 6,
      }),
      prisma.reputationItem.findMany({
        where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical] }, createdAt: { gte: since14 } },
        select: { createdAt: true },
      }),
    ]);

  const trend = bucketByDay(trendRows.map((r) => r.createdAt), 14);
  const firstName = session.userName.split(" ")[0] ?? session.userName;

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={`Welcome back, ${firstName}`}
        description="Here's what's happening with your brand reputation today."
        action={
          <Link href="/dashboard/accounts">
            <PrimaryButton type="button">Connect an account</PrimaryButton>
          </Link>
        }
      />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Received items" value={String(received)} tone="brand" icon={<IconInbox />} hint="All time" />
        <StatCard label="High risk" value={String(highRisk)} tone="danger" icon={<IconAlert />} hint="High or critical" />
        <StatCard label="Pending approvals" value={String(pending)} tone="warn" icon={<IconClock />} hint="Awaiting review" />
        <StatCard label="Connected accounts" value={String(connected)} tone="ok" icon={<IconPlug />} hint="Across brands" />
        <StatCard
          label="Last sync"
          value={lastRun ? formatDate(lastRun.startedAt) : "—"}
          icon={<IconSync />}
          hint={lastRun ? `${lastRun.mock ? "mock" : "live"} · ${humanize(lastRun.status)}` : "No sync yet"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Chart placeholder */}
        <Card>
          <SectionHeader
            title="Risk trend"
            description="High & critical items over the last 14 days"
            action={<Link href="/dashboard/insights" className="text-xs font-medium text-[var(--color-brand)] hover:underline">View insights →</Link>}
          />
          {trendRows.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--color-muted)]">
              No risky items in the last 14 days.
            </p>
          ) : (
            <TrendChart buckets={trend} />
          )}
        </Card>

        {/* Latest risky items */}
        <Card>
          <SectionHeader
            title="Latest risky items"
            action={<Link href="/dashboard/inbox" className="text-xs font-medium text-[var(--color-brand)] hover:underline">Open inbox →</Link>}
          />
          {risky.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-muted)]">
              No risky items yet.
            </p>
          ) : (
            <ul className="-mx-2 space-y-0.5">
              {risky.map((it) => (
                <li key={it.id}>
                  <Link
                    href={`/dashboard/inbox/${it.id}`}
                    className="flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-[var(--color-surface-2)]"
                  >
                    <span className="mt-0.5">
                      <Badge tone={RISK_TONE[it.riskLevel as RiskLevel]}>
                        {humanize(it.riskLevel)}
                      </Badge>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-sm">{it.contentItem.text}</span>
                      <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                        {it.brand.name} · {PLATFORM_META[it.platform as Platform].label}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {received === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No reputation items yet"
            body="Connect a platform and run a read-only sync, or seed the dev workspace to explore Guardora."
            hint="Connectors run in read-only mode — no moderation actions are taken."
            action={
              <Link href="/dashboard/accounts">
                <PrimaryButton type="button">Go to accounts</PrimaryButton>
              </Link>
            }
          />
        </div>
      ) : null}
    </>
  );
}

function IconInbox() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13l3.5 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5L5.5 5Z" /></svg>;
}
function IconAlert() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>;
}
function IconClock() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}
function IconPlug() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5" /></svg>;
}
function IconSync() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M3 21v-5h5M21 3v5h-5" /></svg>;
}
