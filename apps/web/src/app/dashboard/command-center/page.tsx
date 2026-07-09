import Link from "next/link";
import { ConnectorStatus, ConnectorHealth } from "@guardora/core";
import { getAutoSyncConfig } from "@guardora/config";
import { PageHeader, Card, StatCard, Badge, EmptyState, PrimaryButton } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getRealModeFilter } from "@/server/data-mode";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CommandCenterPage() {
  const t = await getT();
  const session = await requireSession();
  const realMode = await getRealModeFilter(session.tenantId);
  const where = { tenantId: session.tenantId, ...realMode.brandWhere };
  const autoSync = getAutoSyncConfig();

  const [accounts, activePolicies, queueGroups, incidents, lastAutoRow, lastSyncRun, liveExecuted, riskyItems] = await Promise.all([
    prisma.connectedAccount.findMany({ where: { tenantId: session.tenantId, status: ConnectorStatus.Active }, select: { health: true, externalName: true } }),
    prisma.controlPolicy.count({ where: { tenantId: session.tenantId, isActive: true } }),
    prisma.actionQueueItem.groupBy({ by: ["queueState"], where, _count: true }),
    prisma.incident.count({ where: { ...where, status: "open" } }),
    prisma.auditLog.findFirst({ where: { tenantId: session.tenantId, event: "sync.completed", metadata: { path: ["trigger"], equals: "automatic" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.syncRun.findFirst({ where, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.platformActionExecution.count({ where: { ...where, status: "executed" } }),
    prisma.reputationItem.findMany({ where: { ...where, riskLevel: { in: ["high", "critical"] } }, orderBy: { createdAt: "desc" }, take: 5, include: { contentItem: { select: { text: true } } } }),
  ]);

  const q = new Map(queueGroups.map((g) => [g.queueState, g._count as unknown as number]));
  const pendingApprovals = q.get("approval_required") ?? 0;
  const autonomousShadow = (q.get("dry_run") ?? 0);
  const safetyBlocks = q.get("blocked_by_safety") ?? 0;
  const healthy = accounts.filter((a) => a.health === ConnectorHealth.Healthy).length;
  const nextSync = autoSync.enabled && lastAutoRow ? new Date(lastAutoRow.createdAt.getTime() + autoSync.intervalSeconds * 1000) : null;

  return (
    <>
      <PageHeader eyebrow={t.cc.tagline} title={t.cc.commandTitle} description={t.cc.subTagline} />

      {accounts.length === 0 ? (
        <EmptyState
          title={t.cc.emptyTitle}
          body={t.cc.emptyBody}
          hint={t.cc.neverHideCriticism}
          action={
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/accounts"><PrimaryButton type="button">{t.cc.connectFacebook}</PrimaryButton></Link>
              <Link href="/dashboard/control-center" className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:border-[var(--color-border-strong)]">{t.cc.createFirstPolicy}</Link>
            </div>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t.cc.connectedAccounts} value={String(accounts.length)} tone="ok" hint={`${healthy}/${accounts.length} ${t.cc.accountHealth}`} />
            <StatCard label={t.cc.controlling} value={String(activePolicies)} tone="brand" hint={t.cc.controlTitle} />
            <StatCard label={t.cc.pendingApprovals} value={String(pendingApprovals)} tone="warn" />
            <StatCard label={t.cc.openIncidents} value={String(incidents)} tone={incidents > 0 ? "danger" : "ok"} />
            <StatCard label={t.cc.autonomousShadow} value={String(autonomousShadow)} tone="neutral" hint={t.cc.shadowMode} />
            <StatCard label={t.cc.safetyBlocks} value={String(safetyBlocks)} tone="neutral" />
            <StatCard label={t.cc.liveExecuted} value={String(liveExecuted)} tone={liveExecuted > 0 ? "warn" : "ok"} hint={t.cc.liveDisabled} />
            <StatCard label={t.cc.lastSync} value={lastSyncRun ? formatDateTime(lastSyncRun.startedAt) : "—"} hint={nextSync ? `${t.cc.nextSync}: ${formatDateTime(nextSync)}` : ""} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t.cc.recentRisky}</h3>
                <Link href="/dashboard/inbox?tab=needs_review" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{t.ui.openInbox}</Link>
              </div>
              {riskyItems.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">{t.cc.incidentsEmpty}</p>
              ) : (
                <div className="space-y-1.5">
                  {riskyItems.map((it) => (
                    <Link key={it.id} href={`/dashboard/inbox/${it.id}`} className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-border-strong)]">
                      <Badge tone="danger">{tEnum(t, "risk", it.riskLevel)}</Badge>
                      <span className="truncate">{it.contentItem.text}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t.cc.pendingApprovals}</h3>
                <Link href="/dashboard/action-queue" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{t.cc.queueTitle}</Link>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span>{tEnum(t, "queueState", "approval_required")}</span><span className="font-medium">{pendingApprovals}</span></div>
                <div className="flex justify-between"><span>{tEnum(t, "queueState", "dry_run")}</span><span className="font-medium">{autonomousShadow}</span></div>
                <div className="flex justify-between"><span>{tEnum(t, "queueState", "blocked_by_safety")}</span><span className="font-medium">{safetyBlocks}</span></div>
              </div>
              <p className="mt-3 text-[11px] text-[var(--color-muted)]">✅ {t.cc.noLiveAction} · {t.cc.liveDisabled}</p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
