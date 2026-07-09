import Link from "next/link";
import { ConnectorStatus, ConnectorHealth } from "@guardora/core";
import { getAutoSyncConfig, getProductionSafetyConfig, getLiveActionsConfig } from "@guardora/config";
import { ROLLBACK_AVAILABLE } from "@guardora/sync";
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

  // V1.27 — Production Safe Mode: live-safety operational state.
  const liveSafety = getProductionSafetyConfig();
  const liveCfg = getLiveActionsConfig();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const hourStart = new Date(Date.now() - 60 * 60 * 1000);
  const [autoHidesToday, autoHidesThisHour, failedLive, blockedBySafetyExec, preservedCriticism, killedBrands, killedAccounts, lastAutoHide, lastFbError] = await Promise.all([
    prisma.platformActionExecution.count({ where: { ...where, status: "executed", trigger: "autonomous", executedAt: { gte: dayStart } } }),
    prisma.platformActionExecution.count({ where: { ...where, status: "executed", trigger: "autonomous", executedAt: { gte: hourStart } } }),
    prisma.platformActionExecution.count({ where: { ...where, status: "failed" } }),
    prisma.platformActionExecution.count({ where: { ...where, status: "blocked" } }),
    prisma.actionQueueItem.count({ where: { ...where, category: "normal_criticism" } }),
    prisma.brand.count({ where: { tenantId: session.tenantId, killSwitch: true } }),
    prisma.connectedAccount.count({ where: { tenantId: session.tenantId, killSwitch: true } }),
    prisma.platformActionExecution.findFirst({ where: { ...where, status: "executed", trigger: "autonomous" }, orderBy: { executedAt: "desc" }, select: { executedAt: true } }),
    prisma.platformActionExecution.findFirst({ where: { ...where, status: "failed" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, providerErrorCode: true, providerErrorMessage: true } }),
  ]);
  const fbConnections = await prisma.connectedAccount.findMany({
    where: { tenantId: session.tenantId, status: ConnectorStatus.Active, platform: "facebook_page" },
    select: { id: true, externalName: true, connectionStatus: true, tokenHealth: true, grantedPermissions: true, lastTokenCheckAt: true, lastSuccessfulGraphCheckAt: true },
  });
  const reconnectAccounts = fbConnections.filter((a) => a.connectionStatus !== "connected" || a.tokenHealth === "expired" || a.tokenHealth === "invalid" || a.tokenHealth === "revoked");
  const HIDE_PERM = "pages_manage_engagement";
  const anyKillSwitch = liveSafety.globalKillSwitch || killedBrands > 0 || killedAccounts > 0;

  // Next recommended setup step.
  const nextStep = accounts.length === 0 ? t.cc.nextConnect
    : activePolicies === 0 ? t.cc.nextPolicies
    : !autoSync.enabled ? t.cc.nextEnableSync
    : pendingApprovals > 0 ? t.cc.nextReview
    : t.cc.allSet;

  const steps = [
    { title: t.cc.onbStep1, body: t.cc.onbStep1Body, done: accounts.length > 0, href: "/dashboard/accounts", cta: t.cc.connectFacebook },
    { title: t.cc.onbStep2, body: t.cc.onbStep2Body, done: accounts.length > 0, href: "/dashboard/control-center", cta: t.cc.controlTitle },
    { title: t.cc.onbStep3, body: `${t.cc.presetConservative} · ${t.cc.presetBalanced} · ${t.cc.presetAggressive}`, done: activePolicies > 0, href: "/dashboard/control-center", cta: t.cc.createFirstPolicy },
    { title: t.cc.onbStep4, body: `${t.cc.onbSafety1} ${t.cc.onbSafety2}`, done: activePolicies > 0, href: "/dashboard/control-center", cta: t.cc.controlTitle },
    { title: t.cc.onbStep5, body: t.cc.subTagline, done: autoSync.enabled, href: "/dashboard/accounts", cta: t.cc.onbStep5 },
  ];

  return (
    <>
      <PageHeader eyebrow={t.cc.tagline} title={t.cc.commandTitle} description={t.cc.subTagline} />

      {accounts.length === 0 ? (
        <Card>
          <h2 className="text-lg font-semibold">{t.cc.onbTitle}</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t.cc.emptyBody}</p>
          <ol className="mt-4 space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] p-3">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.done ? "bg-[var(--color-ok)] text-white" : "bg-[var(--color-surface-2)]"}`}>{s.done ? "✓" : i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{s.title}</span>
                    {!s.done ? <Link href={s.href} className="text-xs font-medium text-[var(--color-brand)] hover:underline">{s.cta} →</Link> : null}
                  </div>
                  <p className="text-xs text-[var(--color-muted)]">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-3 rounded-lg border border-[var(--color-ok)] p-2 text-xs">🛡️ {t.cc.neverHideCriticism}</p>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-brand)] px-3 py-2 text-sm">
            <span className="font-medium">👉 {t.cc.nextStep}:</span>
            <span>{nextStep}</span>
          </div>
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            🟢 {t.cc.doingNow}: {activePolicies} {t.cc.controlTitle.toLowerCase()} · {autonomousShadow} {t.cc.automated.toLowerCase()} · {safetyBlocks} {t.cc.blockedSafety.toLowerCase()}
          </p>
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

          <Card className="mt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">🛡️ {t.cc.safeLiveTitle}</h3>
              <Badge tone={liveSafety.productionSafeMode ? "brand" : "neutral"}>{liveSafety.productionSafeMode ? t.cc.safeLiveOn : t.cc.safeLiveOff}</Badge>
            </div>
            {anyKillSwitch ? (
              <p className="mb-3 rounded-lg border-2 border-[var(--color-danger)] p-2 text-xs font-bold text-[var(--color-danger)]">🛑 {t.cc.killSwitchActive}</p>
            ) : null}
            {reconnectAccounts.length > 0 ? (
              <Link href="/dashboard/accounts" className="mb-3 block rounded-lg border-2 border-[var(--color-danger)] p-2 text-xs font-bold text-[var(--color-danger)]">🔌 {reconnectAccounts.map((a) => a.externalName ?? "Account").join(", ")}: {t.cc.reconnectNeeded}</Link>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div><p className="text-xs text-[var(--color-muted)]">{t.cc.safeLiveMode}</p><Badge tone={liveCfg.canExecuteLive ? "warn" : "ok"}>{liveCfg.canExecuteLive ? t.cc.safeLiveEnabled : t.cc.safeLiveDisabled}</Badge></div>
              <div><p className="text-xs text-[var(--color-muted)]">{t.cc.killSwitch}</p><Badge tone={anyKillSwitch ? "danger" : "ok"}>{anyKillSwitch ? t.cc.killSwitchOn : t.cc.killSwitchOff}</Badge></div>
              <div><p className="text-xs text-[var(--color-muted)]">{t.cc.autoHidesToday}</p><p className="font-medium">{autoHidesToday}</p></div>
              <div><p className="text-xs text-[var(--color-muted)]">{t.cc.hourlyUsage}</p><p className="font-medium">{autoHidesThisHour}</p></div>
              <div><p className="text-xs text-[var(--color-muted)]">{t.cc.failedLive}</p><p className="font-medium">{failedLive}</p></div>
              <div><p className="text-xs text-[var(--color-muted)]">{t.cc.blockedBySafety}</p><p className="font-medium">{blockedBySafetyExec}</p></div>
              <div><p className="text-xs text-[var(--color-muted)]">{t.cc.preservedCriticism}</p><p className="font-medium">{preservedCriticism}</p></div>
              <div><p className="text-xs text-[var(--color-muted)]">{t.cc.pendingApprovals}</p><p className="font-medium">{pendingApprovals}</p></div>
              <div><p className="text-xs text-[var(--color-muted)]">{t.cc.lastAutoHide}</p><p className="font-medium">{lastAutoHide?.executedAt ? formatDateTime(lastAutoHide.executedAt) : "—"}</p></div>
              <div><p className="text-xs text-[var(--color-muted)]">{t.cc.lastFbError}</p><p className="font-medium text-[var(--color-danger)]">{lastFbError ? (lastFbError.providerErrorCode ?? "error") : "—"}</p></div>
              <div><p className="text-xs text-[var(--color-muted)]">{t.cc.rollbackAvailability}</p><Badge tone={ROLLBACK_AVAILABLE ? "ok" : "warn"}>{ROLLBACK_AVAILABLE ? t.cc.rollbackReady : t.cc.rollbackUnavailable}</Badge></div>
            </div>
          </Card>

          {fbConnections.length > 0 ? (
            <Card className="mt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">🔌 {t.cc.connectionsTitle}</h3>
                {reconnectAccounts.length > 0 ? <Badge tone="danger">{reconnectAccounts.length}× {t.cc.reconnectPage}</Badge> : <Badge tone="ok">{t.cc.on}</Badge>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                    <th className="py-1.5 pr-2">Facebook Page</th><th className="px-2">{t.cc.connectionStatusLabel}</th><th className="px-2">{t.cc.tokenHealthLabel}</th><th className="px-2">{t.cc.hideCapability}</th><th className="px-2">{t.cc.lastTokenCheck}</th><th className="px-2">{t.cc.lastGraphCheck}</th>
                  </tr></thead>
                  <tbody>
                    {fbConnections.map((a) => {
                      const okConn = a.connectionStatus === "connected";
                      const okTok = a.tokenHealth === "ok";
                      const canHide = okConn && okTok && a.grantedPermissions.includes(HIDE_PERM);
                      return (
                        <tr key={a.id} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="py-1.5 pr-2 font-medium">{a.externalName ?? "Page"}</td>
                          <td className="px-2"><Badge tone={okConn ? "ok" : "danger"}>{okConn ? t.cc.connStatusConnected : a.connectionStatus === "missing_permission" ? t.cc.connStatusMissingPermission : t.cc.connStatusNeedsReconnect}</Badge></td>
                          <td className="px-2"><Badge tone={okTok ? "ok" : a.tokenHealth === "unknown" ? "neutral" : "danger"}>{okTok ? t.cc.tokenOk : a.tokenHealth === "unknown" ? t.cc.tokenUnknown : t.cc.tokenInvalidLabel}</Badge></td>
                          <td className="px-2"><Badge tone={canHide ? "ok" : "warn"}>{canHide ? t.cc.safeLiveEnabled : t.cc.safeLiveDisabled}</Badge></td>
                          <td className="px-2 text-[var(--color-muted)]">{a.lastTokenCheckAt ? formatDateTime(a.lastTokenCheckAt) : "—"}</td>
                          <td className="px-2 text-[var(--color-muted)]">{a.lastSuccessfulGraphCheckAt ? formatDateTime(a.lastSuccessfulGraphCheckAt) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
