import Link from "next/link";
import { ConnectorStatus } from "@guardora/core";
import { getAutoSyncConfig, getProductionSafetyConfig, getLiveActionsConfig } from "@guardora/config";
import { ROLLBACK_AVAILABLE } from "@guardora/sync";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getRealModeFilter } from "@/server/data-mode";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { formatDateTime, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Map an audit event to a simple, user-facing sentence (V1.28C). */
function eventCopy(t: Awaited<ReturnType<typeof getT>>, event: string, meta: unknown): string | null {
  const m = (meta ?? {}) as { trigger?: string; reason?: string };
  switch (event) {
    case "platform_action.executed": return m.trigger === "autonomous" ? t.cc.evAutoHidden : t.cc.evHidden;
    case "platform_action.failed": return t.cc.evFailed;
    case "platform_action.blocked":
      if (m.reason === "facebook_can_hide_false") return t.cc.evCanHideFalse;
      if (m.reason === "comment_deleted_or_unavailable") return t.cc.evDeleted;
      return null;
    case "approval.approved": return t.cc.evApproved;
    case "live_hide.rolled_back": return t.cc.evRestored;
    case "live_safety.enabled": return t.cc.evAutoOn;
    case "live_safety.disabled": return t.cc.evAutoOff;
    case "kill_switch.enabled": return t.cc.evKillOn;
    case "account.reconnected":
    case "account.connected": return t.cc.evAccountVerified;
    default: return null;
  }
}

export default async function CommandCenterPage() {
  const t = await getT();
  const session = await requireSession();
  const realMode = await getRealModeFilter(session.tenantId);
  const where = { tenantId: session.tenantId, ...realMode.brandWhere };
  const autoSync = getAutoSyncConfig();
  const liveSafety = getProductionSafetyConfig();
  const liveCfg = getLiveActionsConfig();
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000);
  const rel = { justNow: t.cc.relJustNow, minAgo: t.cc.relMinAgo, today: t.cc.relToday };

  const [accounts, activePolicies, pendingApprovals, failedRetryable, safetyBlocks, openIncidents,
    hidesToday, autoHidesToday, autoHidesThisHour, riskyToday, canHideFalseToday, deletedToday, failedToday,
    safetyRows, killedBrands, killedAccounts, autoBrands, recentAudit, lastSyncRun, pendingItems] = await Promise.all([
    prisma.connectedAccount.findMany({ where: { tenantId: session.tenantId, status: ConnectorStatus.Active }, select: { id: true, externalName: true, platform: true, connectionStatus: true, tokenHealth: true, grantedPermissions: true, killSwitch: true, lastTokenCheckAt: true } }),
    prisma.controlPolicy.count({ where: { tenantId: session.tenantId, isActive: true } }),
    prisma.actionQueueItem.count({ where: { ...where, queueState: "approval_required" } }),
    prisma.actionQueueItem.count({ where: { ...where, queueState: "failed" } }),
    prisma.actionQueueItem.count({ where: { ...where, queueState: "blocked_by_safety" } }),
    prisma.incident.findMany({ where: { ...where, status: "open" }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, title: true, severity: true, category: true, sourcePlatform: true } }),
    prisma.platformActionExecution.count({ where: { ...where, status: "executed", executedAt: { gte: dayStart } } }),
    prisma.platformActionExecution.count({ where: { ...where, status: "executed", trigger: "autonomous", executedAt: { gte: dayStart } } }),
    prisma.platformActionExecution.count({ where: { ...where, status: "executed", trigger: "autonomous", executedAt: { gte: hourStart } } }),
    prisma.reputationItem.count({ where: { ...where, riskLevel: { in: ["high", "critical"] }, createdAt: { gte: dayStart } } }),
    prisma.platformActionExecution.count({ where: { ...where, status: "blocked", reason: "facebook_can_hide_false", createdAt: { gte: dayStart } } }),
    prisma.platformActionExecution.count({ where: { ...where, status: "blocked", reason: "comment_deleted_or_unavailable", createdAt: { gte: dayStart } } }),
    prisma.platformActionExecution.count({ where: { ...where, status: "failed", createdAt: { gte: dayStart } } }),
    prisma.brandLiveSafetySettings.findMany({ where: { tenantId: session.tenantId }, select: { liveModeEnabled: true, autonomousHideEnabled: true, approvedAutoHideCategories: true, hourlyAutoHideLimit: true, dailyAutoHideLimit: true } }),
    prisma.brand.count({ where: { tenantId: session.tenantId, killSwitch: true } }),
    prisma.connectedAccount.count({ where: { tenantId: session.tenantId, killSwitch: true } }),
    prisma.brandLiveSafetySettings.count({ where: { tenantId: session.tenantId, liveModeEnabled: true, autonomousHideEnabled: true } }),
    prisma.auditLog.findMany({ where: { tenantId: session.tenantId }, orderBy: { createdAt: "desc" }, take: 40, select: { event: true, createdAt: true, metadata: true } }),
    prisma.syncRun.findFirst({ where, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.actionQueueItem.findMany({ where: { ...where, queueState: "approval_required" }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, category: true } }),
  ]);

  const HIDE_PERM = "pages_manage_engagement";
  const fb = accounts.filter((a) => a.platform === "facebook_page");
  const needsReconnect = accounts.filter((a) => a.connectionStatus !== "connected" || a.tokenHealth === "expired" || a.tokenHealth === "invalid" || a.tokenHealth === "revoked");
  const anyKillSwitch = liveSafety.globalKillSwitch || killedBrands > 0 || killedAccounts > 0;
  const autoOn = autoBrands > 0 && liveCfg.canExecuteLive && !anyKillSwitch;
  const canExecuteLive = liveCfg.canExecuteLive;
  const monitoringActive = activePolicies > 0;
  const attention = needsReconnect.length > 0 || failedToday > 0 || openIncidents.length > 0 || anyKillSwitch;

  // --- A) Protection status ---
  let status: "protected" | "partial" | "attention" | "off";
  if (accounts.length === 0 || liveSafety.globalKillSwitch) status = "off";
  else if (attention) status = "attention";
  else if (!monitoringActive) status = "off";
  else if (autoOn) status = "protected";
  else status = "partial";

  const STATUS_META = {
    protected: { copy: t.cc.protectionProtected, tone: "ok", icon: "🛡️" },
    partial: { copy: t.cc.protectionPartial, tone: "warn", icon: "🟡" },
    attention: { copy: t.cc.protectionAttention, tone: "danger", icon: "⚠️" },
    off: { copy: t.cc.protectionOff, tone: "neutral", icon: "⏸️" },
  } as const;
  const sm = STATUS_META[status];

  // --- F) automatic protection state ---
  const autoState: "on" | "off" | "partial" = !autoOn ? "off" : needsReconnect.length > 0 ? "partial" : "on";
  const approvedCats = [...new Set(safetyRows.flatMap((r) => (r.autonomousHideEnabled ? r.approvedAutoHideCategories : [])))];
  const hourlyCap = Math.min(...safetyRows.map((r) => r.hourlyAutoHideLimit), 3);

  // --- D) Needs attention items ---
  const attentionItems: { label: string; cta: string; href: string; tone: string }[] = [];
  if (needsReconnect.length > 0) attentionItems.push({ label: `${needsReconnect.map((a) => a.externalName ?? "Account").join(", ")}: ${t.cc.attnReconnect}`, cta: t.cc.ctaReconnect, href: "/dashboard/accounts", tone: "danger" });
  if (pendingApprovals > 0) attentionItems.push({ label: `${pendingApprovals}× ${t.cc.attnPending}`, cta: t.cc.approve, href: "/dashboard/action-queue", tone: "warn" });
  if (failedRetryable > 0) attentionItems.push({ label: `${failedRetryable}× ${t.cc.attnFailed}`, cta: t.cc.retry, href: "/dashboard/action-queue?tab=blocked", tone: "danger" });
  if (openIncidents.length > 0) attentionItems.push({ label: `${openIncidents.length}× ${t.cc.attnIncident}`, cta: t.cc.review, href: "/dashboard/incidents", tone: "danger" });
  if (accounts.length > 0 && monitoringActive && !autoOn && !anyKillSwitch && canExecuteLive) attentionItems.push({ label: t.cc.attnAutoOff, cta: t.cc.ctaSetRules, href: "/dashboard/control-center", tone: "warn" });

  // --- G) recent events (user-relevant only) ---
  const events = recentAudit.map((a) => ({ copy: eventCopy(t, a.event, a.metadata), at: a.createdAt })).filter((e) => e.copy).slice(0, 7);

  // Today activity total (for the "no activity" line).
  const todayActivity = hidesToday + pendingApprovals + canHideFalseToday + deletedToday + failedToday;

  const acctSummary = needsReconnect.length > 0 ? `${needsReconnect.length} ${t.cc.accountsAttention}` : `${accounts.length}/${accounts.length} OK`;

  return (
    <>
      <PageHeader eyebrow={t.cc.tagline} title={t.cc.commandTitle} description={t.cc.subTagline} />

      {/* A) Protection status */}
      <div className={`mb-5 flex items-center gap-3 rounded-xl border-2 p-4 ${status === "protected" ? "border-[var(--color-ok)]" : status === "attention" ? "border-[var(--color-danger)]" : status === "partial" ? "border-[var(--color-warn)]" : "border-[var(--color-border)]"}`}>
        <span className="text-2xl">{sm.icon}</span>
        <div className="min-w-0">
          <Badge tone={sm.tone}>{t.cc[`protectionState_${status}` as "protectionState_protected"]}</Badge>
          <p className="mt-1 text-sm font-medium">{sm.copy}</p>
        </div>
      </div>

      {accounts.length === 0 ? (
        <Card className="p-6">
          <h2 className="text-base font-semibold">{t.cc.onbTitle}</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t.cc.emptyBody}</p>
          <Link href="/dashboard/accounts" className="mt-3 inline-block rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{t.cc.connectFacebook}</Link>
        </Card>
      ) : (
        <>
          {/* B) Four primary metric cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.cc.hiddenToday}</p><p className="mt-1 text-2xl font-bold">{hidesToday}</p><p className="text-[11px] text-[var(--color-muted)]">{autoHidesToday} {t.cc.autoSuffix}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.cc.pendingDecision}</p><p className="mt-1 text-2xl font-bold">{pendingApprovals}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.cc.riskyComments}</p><p className="mt-1 text-2xl font-bold">{riskyToday}</p><p className="text-[11px] text-[var(--color-muted)]">{t.cc.today}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.cc.accountStatus}</p><p className={`mt-1 text-2xl font-bold ${needsReconnect.length > 0 ? "text-[var(--color-danger)]" : ""}`}>{needsReconnect.length > 0 ? needsReconnect.length : `${accounts.length}/${accounts.length}`}</p><p className="text-[11px] text-[var(--color-muted)]">{needsReconnect.length > 0 ? t.cc.accountsAttention : "OK"}</p></Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {/* D) Needs attention */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold">⚠️ {t.cc.needsAttentionTitle}</h3>
              {attentionItems.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">✅ {t.cc.queueEmptyActive}</p>
              ) : (
                <ul className="space-y-2">
                  {attentionItems.map((it, i) => (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] p-2 text-sm">
                      <span className="min-w-0 flex-1">{it.label}</span>
                      <Link href={it.href} className="shrink-0 rounded-md bg-[var(--color-brand)] px-2.5 py-1 text-xs font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{it.cta}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* C) Today protection summary */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold">📊 {t.cc.todayProtection}</h3>
              {todayActivity === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">{t.cc.noActivityToday}</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  <SummaryRow n={hidesToday} label={t.cc.sumHiddenPublic} href="/dashboard/action-queue?tab=resolved" />
                  <SummaryRow n={pendingApprovals} label={t.cc.sumPending} href="/dashboard/action-queue" />
                  <SummaryRow n={canHideFalseToday} label={t.cc.sumCanHideFalse} href="/dashboard/action-queue?tab=resolved" />
                  <SummaryRow n={deletedToday} label={t.cc.sumDeleted} href="/dashboard/action-queue?tab=resolved" />
                  <SummaryRow n={failedToday} label={t.cc.sumFailed} href="/dashboard/action-queue?tab=blocked" />
                </ul>
              )}
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {/* F) Automatic protection */}
            <Card>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">🤖 {t.cc.autoProtection}</h3>
                <Badge tone={autoState === "on" ? "brand" : autoState === "partial" ? "warn" : "neutral"}>{autoState === "on" ? t.cc.on : autoState === "partial" ? t.cc.partiallyOn : t.cc.off}</Badge>
              </div>
              {autoState === "off" ? (
                <p className="text-sm text-[var(--color-muted)]">{t.cc.autoOffNote}</p>
              ) : (
                <div className="space-y-1.5 text-sm">
                  <div className="flex flex-wrap gap-1">{approvedCats.length ? approvedCats.map((c) => <Badge key={c} tone="neutral">{tEnum(t, "autoProtectCategory", c)}</Badge>) : <span className="text-xs text-[var(--color-muted)]">—</span>}</div>
                  <p className="text-xs text-[var(--color-muted)]">{t.cc.autoHidesToday}: <span className="font-medium text-[var(--color-fg)]">{autoHidesToday}</span></p>
                  <p className="text-xs text-[var(--color-muted)]">{t.cc.autoCapNote.replace("{n}", String(hourlyCap))}</p>
                  {anyKillSwitch ? <p className="text-xs font-bold text-[var(--color-danger)]">🛑 {t.cc.killSwitchActive}</p> : null}
                </div>
              )}
              <Link href="/dashboard/control-center" className="mt-3 inline-block rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.cc.ctaSetRules}</Link>
            </Card>

            {/* E) Connection status */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold">🔌 {t.cc.connectionsTitle}</h3>
              <ul className="space-y-2">
                {fb.map((a) => {
                  const ok = a.connectionStatus === "connected" && a.tokenHealth === "ok";
                  const protectedAuto = ok && a.grantedPermissions.includes(HIDE_PERM) && autoOn;
                  return (
                    <li key={a.id} className="rounded-lg border border-[var(--color-border)] p-2 text-sm">
                      <p className="font-medium">Facebook Page — {a.externalName ?? "—"}</p>
                      <p className="text-xs text-[var(--color-muted)]">
                        <span className={ok ? "text-[var(--color-ok)]" : "text-[var(--color-danger)]"}>{ok ? t.cc.connStatusConnected : t.cc.connStatusNeedsReconnect}</span>
                        {" · "}{protectedAuto ? t.cc.connProtectedOn : t.cc.connProtectedOff}
                      </p>
                      <p className="text-[11px] text-[var(--color-muted)]">{t.cc.lastCheck}: {a.lastTokenCheckAt ? relativeTime(a.lastTokenCheckAt, rel, now) : "—"}</p>
                      {!ok ? <Link href="/dashboard/accounts" className="mt-1 inline-block text-xs font-medium text-[var(--color-brand)] hover:underline">{t.cc.ctaReconnect} →</Link> : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {/* G) Latest important events */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold">🕑 {t.cc.recentEventsTitle}</h3>
              {events.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">{t.cc.noRecentEvents}</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {events.map((e, i) => (
                    <li key={i} className="flex items-start justify-between gap-3">
                      <span className="min-w-0 flex-1">{e.copy}</span>
                      <span className="shrink-0 text-[11px] text-[var(--color-muted)]">{relativeTime(e.at, rel, now)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* H) Incidents preview */}
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">🚨 {t.cc.activeIncidentsTitle}</h3>
                {openIncidents.length > 0 ? <Link href="/dashboard/incidents" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{t.cc.incidentsTitle}</Link> : null}
              </div>
              {openIncidents.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">✅ {t.cc.noIncidents}</p>
              ) : (
                <ul className="space-y-2">
                  {openIncidents.map((inc) => (
                    <li key={inc.id} className="rounded-lg border border-[var(--color-border)] p-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{inc.title}</span>
                        <Badge tone={inc.severity === "critical" ? "danger" : "warn"}>{tEnum(t, "risk", inc.severity)}</Badge>
                      </div>
                      <p className="text-xs text-[var(--color-muted)]">{tEnum(t, "autoProtectCategory", inc.category)}{inc.sourcePlatform ? ` · ${inc.sourcePlatform}` : ""}</p>
                      <Link href={`/dashboard/incidents`} className="mt-1 inline-block text-xs font-medium text-[var(--color-brand)] hover:underline">{t.cc.ctaOpenIncident} →</Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* I) Advanced — technical operational details, collapsed by default */}
          <Card className="mt-5">
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-fg)]">🔧 {t.cc.advanced}</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div><p className="text-xs text-[var(--color-muted)]">{t.cc.safeLiveMode}</p><Badge tone={canExecuteLive ? "warn" : "ok"}>{canExecuteLive ? t.cc.safeLiveEnabled : t.cc.safeLiveDisabled}</Badge></div>
                <div><p className="text-xs text-[var(--color-muted)]">{t.cc.blockedByCanHide}</p><p className="font-medium">{canHideFalseToday}</p></div>
                <div><p className="text-xs text-[var(--color-muted)]">{t.cc.hourlyUsage}</p><p className="font-medium">{autoHidesThisHour}</p></div>
                <div><p className="text-xs text-[var(--color-muted)]">{t.cc.failedLive}</p><p className="font-medium">{failedToday}</p></div>
                <div><p className="text-xs text-[var(--color-muted)]">{t.cc.blockedBySafety}</p><p className="font-medium">{safetyBlocks}</p></div>
                <div><p className="text-xs text-[var(--color-muted)]">{t.cc.rollbackAvailability}</p><Badge tone={ROLLBACK_AVAILABLE ? "ok" : "warn"}>{ROLLBACK_AVAILABLE ? t.cc.rollbackReady : t.cc.rollbackUnavailable}</Badge></div>
                <div><p className="text-xs text-[var(--color-muted)]">{t.cc.lastSync}</p><p className="font-medium">{lastSyncRun ? formatDateTime(lastSyncRun.startedAt) : "—"}</p></div>
                <div><p className="text-xs text-[var(--color-muted)]">{t.cc.controlling}</p><p className="font-medium">{activePolicies}</p></div>
              </div>
            </details>
          </Card>
        </>
      )}
    </>
  );
}

function SummaryRow({ n, label, href }: { n: number; label: string; href: string }) {
  return (
    <li className="flex items-center justify-between">
      <Link href={href} className="hover:underline"><span className="font-semibold">{n}</span> <span className="text-[var(--color-muted)]">{label}</span></Link>
    </li>
  );
}
