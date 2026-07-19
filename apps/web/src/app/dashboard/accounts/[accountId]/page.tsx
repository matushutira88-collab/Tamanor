import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CONNECTOR_MODE_META,
  ConnectorMode,
  PLATFORM_META,
  Permission,
  Platform,
  can,
  connectorNeedsReconnect,
  modeAllowsSync,
  modeAllowsActions,
  platformKeyFor,
} from "@guardora/core";
import { getMetaConfig, loadEnv, getAutoSyncConfig, getLiveActionsConfig, getProductionSafetyConfig } from "@guardora/config";
import { ROLLBACK_AVAILABLE } from "@guardora/sync";
import { PageHeader, Badge, StatCard, Card } from "@/components/dashboard/ui";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { ConnectorStatusBadge } from "@/components/dashboard/connector-status-badge";
import { toggleAccountKillSwitch } from "../../safety-actions";
import { requireSession } from "@/server/auth";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { withTenant, getLatestWebhookForPlatform } from "@guardora/db";
import { humanize, formatDate, formatDateTime } from "@/lib/format";
import { CONNECTOR_TONE } from "@/lib/ui-maps";
import { runSyncAction } from "../actions";

const META_PLATFORMS = new Set<string>([
  Platform.FacebookPage,
  Platform.InstagramBusiness,
]);

export const dynamic = "force-dynamic";

const NOTICE_TONE: Record<string, string> = { ok: "ok", error: "danger" };
const RUN_TONE: Record<string, string> = {
  completed: "ok",
  running: "brand",
  failed: "danger",
};

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { accountId } = await params;
  const sp = await searchParams;
  const session = await requireSession();
  const manage = can(session.role, Permission.ConnectorManage);

  // NOTE: token columns are intentionally NOT selected — never exposed to the UI.
  const account = await withTenant(session.tenantId, (db) => db.connectedAccount.findFirst({
    where: { id: accountId, tenantId: session.tenantId },
    select: {
      id: true,
      platform: true,
      status: true,
      mode: true,
      health: true,
      externalName: true,
      externalId: true,
      pageId: true,
      igBusinessId: true,
      scopes: true,
      grantedPermissions: true,
      killSwitch: true,
      connectionStatus: true,
      tokenHealth: true,
      contentPermissionState: true,
      lastTokenCheckAt: true,
      lastSuccessfulGraphCheckAt: true,
      requiresReconnectReason: true,
      tokenExpiresAt: true,
      lastSyncedAt: true,
      lastSuccessfulSyncAt: true,
      lastCursor: true,
      lastError: true,
      lastErrorAt: true,
      syncAttempts: true,
      nextRetryAt: true,
      brand: { select: { id: true, name: true } },
      syncRuns: { orderBy: { startedAt: "desc" }, take: 10 },
    },
  }));
  if (!account) notFound();

  // V1.23 — action capability matrix + linked control policies + recent queue.
  const HIDE_PERMISSION = "pages_manage_engagement";
  const live = getLiveActionsConfig();
  const safety = getProductionSafetyConfig();
  const [linkedPolicies, recentQueue, lastDryRun, lastBlocked, lastExecuted, lastFailed] = await withTenant(session.tenantId, (db) => Promise.all([
    db.controlPolicy.count({ where: { brandId: account.brand.id, isActive: true } }),
    db.actionQueueItem.findMany({ where: { brandId: account.brand.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.platformActionExecution.findFirst({ where: { connectedAccountId: account.id, status: "dry_run" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.platformActionExecution.findFirst({ where: { connectedAccountId: account.id, status: "blocked" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, reason: true } }),
    db.platformActionExecution.findFirst({ where: { connectedAccountId: account.id, status: "executed" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.platformActionExecution.findFirst({ where: { connectedAccountId: account.id, status: "failed" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, providerErrorCode: true, providerErrorMessage: true } }),
  ]));
  const tokenHealthy = !account.tokenExpiresAt || account.tokenExpiresAt > new Date();
  const anyKill = safety.globalKillSwitch || account.killSwitch;
  const hideCapKey = account.platform !== Platform.FacebookPage ? "capNotImplemented"
    : !live.facebookHideEnabled || !live.liveEnabled ? "capDisabledEnv"
    : account.grantedPermissions.includes(HIDE_PERMISSION) ? "capAvailable" : "capMissingPerm";
  const CAP_TONE: Record<string, string> = { capAvailable: "ok", capMissingPerm: "warn", capDisabledEnv: "neutral", capNotImplemented: "neutral", capBlockedSafety: "neutral" };
  const capabilities: { labelKey: "capRead" | "capHide" | "capReply" | "capDelete"; key: string }[] = [
    { labelKey: "capRead", key: "capAvailable" },
    { labelKey: "capHide", key: hideCapKey },
    { labelKey: "capReply", key: "capNotImplemented" },
    { labelKey: "capDelete", key: "capNotImplemented" },
  ];

  // Latest inbound webhook for this platform (global; not tenant-scoped) — system repo.
  const lastWebhook = META_PLATFORMS.has(account.platform)
    ? await getLatestWebhookForPlatform(account.platform)
    : null;

  const platformMeta = PLATFORM_META[account.platform as Platform];
  const mode = account.mode as unknown as ConnectorMode;
  const canSync = modeAllowsSync(mode);
  const modeInfo = CONNECTOR_MODE_META[mode];
  const notice = sp.notice;
  const noticeKind = sp.kind ?? "ok";
  const isMeta = META_PLATFORMS.has(account.platform);
  const needsReconnect = connectorNeedsReconnect({
    health: account.health as never,
    tokenExpiresAt: account.tokenExpiresAt,
  });
  const meta = getMetaConfig();
  const appUrl = loadEnv().APP_URL;
  const t = await getT();
  const autoSync = getAutoSyncConfig();
  const nextSyncAt =
    autoSync.enabled && account.lastSyncedAt
      ? new Date(account.lastSyncedAt.getTime() + autoSync.intervalSeconds * 1000)
      : null;

  return (
    <>
      <PageHeader
        title={account.externalName ?? platformMeta.label}
        description={`${account.brand.name} · ${platformMeta.label}`}
        action={
          <Badge tone={CONNECTOR_TONE[account.status as keyof typeof CONNECTOR_TONE] ?? "neutral"}>
            {humanize(account.status)}
          </Badge>
        }
      />

      <Link
        href="/dashboard/accounts"
        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
      >
        ← All connected accounts
      </Link>

      {notice ? (
        <div className="mt-4" role="status">
          <Badge tone={NOTICE_TONE[noticeKind] ?? "neutral"}>{humanize(noticeKind)}</Badge>{" "}
          <span className="text-sm text-[var(--color-muted)]">{notice}</span>
        </div>
      ) : null}

      {needsReconnect && isMeta ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-danger)] bg-[var(--color-surface)] px-4 py-3">
          <span className="text-sm">
            <Badge tone="danger">Reconnect required</Badge>{" "}
            <span className="text-[var(--color-muted)]">
              {account.lastError ?? "The connection needs to be re-authorized."}
            </span>
          </span>
          {manage && meta.configured ? (
            <a
              href={`/api/connectors/meta/start?brandId=${account.brand.id}&accountId=${account.id}`}
              className="shrink-0 rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--color-brand-strong)] hover:text-white"
            >
              Reconnect with Meta
            </a>
          ) : (
            <span className="shrink-0 text-xs text-[var(--color-warn)]">
              {meta.configured ? "Needs connector permission" : "Meta config missing"}
            </span>
          )}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Mode" value={modeInfo?.label ?? mode} hint={modeInfo?.description} />
        <div className="gu-card p-5">
          <p className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Status</p>
          <div className="mt-2">
            {/* V1.39B — same truthful model as the Accounts list (never fake Live/Healthy). */}
            <ConnectorStatusBadge
              account={{ platformKey: platformKeyFor(account.platform), status: account.status, health: account.health, connectionStatus: account.connectionStatus, tokenHealth: account.tokenHealth, contentPermissionState: account.contentPermissionState, mode: account.mode }}
              liveSyncEnabled={meta.liveSync}
              withDescription
            />
          </div>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Actions {modeAllowsActions(mode) ? "enabled" : "disabled"} · Sync {canSync ? "allowed" : "off"}
          </p>
        </div>
        <div className="gu-card p-5">
          <p className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Last sync</p>
          <p className="mt-2 text-sm">
            {account.lastSuccessfulSyncAt
              ? formatDateTime(account.lastSuccessfulSyncAt)
              : "Never"}
          </p>
          {account.lastError ? (
            <p className="mt-1 text-xs text-[var(--color-danger)]">{account.lastError}</p>
          ) : (
            <p className="mt-1 text-xs text-[var(--color-muted)]">No errors</p>
          )}
        </div>
      </div>

      {/* Connection details */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="gu-card p-5">
          <h3 className="mb-3 text-sm font-semibold">Connection</h3>
          <dl className="space-y-2 text-sm">
            <Row label="External ID">{account.externalId}</Row>
            {account.pageId ? <Row label="Page ID">{account.pageId}</Row> : null}
            {account.igBusinessId ? <Row label="IG business ID">{account.igBusinessId}</Row> : null}
            <Row label="Token expires">
              {account.tokenExpiresAt ? formatDateTime(account.tokenExpiresAt) : "—"}
            </Row>
            <Row label="Last cursor">{account.lastCursor ?? "—"}</Row>
          </dl>
          <p className="mt-3 text-[11px] text-[var(--color-muted)]">
            Tokens are stored server-side only and never shown here or logged.
          </p>
        </div>

        <div className="gu-card p-5">
          <h3 className="mb-3 text-sm font-semibold">Scopes &amp; permissions</h3>
          <p className="text-xs text-[var(--color-muted)]">Requested scopes</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {account.scopes.length ? (
              account.scopes.map((s) => <Badge key={s}>{s}</Badge>)
            ) : (
              <span className="text-xs text-[var(--color-muted)]">None</span>
            )}
          </div>
          <p className="mt-3 text-xs text-[var(--color-muted)]">Granted permissions</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {account.grantedPermissions.length ? (
              account.grantedPermissions.map((s) => <Badge key={s} tone="ok">{s}</Badge>)
            ) : (
              <span className="text-xs text-[var(--color-muted)]">None</span>
            )}
          </div>
        </div>
      </div>

      {/* V1.27 — Safe live operations for this account */}
      <div className="mt-6 gu-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">🛡️ {t.cc.safeLiveTitle}</h3>
          {manage ? (
            <form action={toggleAccountKillSwitch}>
              <input type="hidden" name="accountId" value={account.id} />
              <input type="hidden" name="on" value={account.killSwitch ? "0" : "1"} />
              <SubmitButton variant="secondary" className="text-xs">{account.killSwitch ? t.cc.killSwitchOffLabel : t.cc.killSwitchOnLabel}</SubmitButton>
            </form>
          ) : null}
        </div>
        {anyKill ? <p className="mb-3 rounded-lg border-2 border-[var(--color-danger)] p-2 text-xs font-bold text-[var(--color-danger)]">🛑 {t.cc.killSwitchActive}</p> : null}
        {account.lastError === "token_expired" ? (
          <div className="mb-3 rounded-lg border-2 border-[var(--color-danger)] p-2 text-xs">
            <p className="font-bold text-[var(--color-danger)]">🔑 {t.cc.tokenExpired}</p>
            {manage && meta.configured ? (
              <a href={`/api/connectors/meta/start?brandId=${account.brand.id}&accountId=${account.id}`} className="mt-1 inline-block text-[var(--color-brand)] hover:underline">{t.cc.reconnectPage} →</a>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><p className="text-xs text-[var(--color-muted)]">{t.cc.connectionStatusLabel}</p><Badge tone={account.connectionStatus === "connected" ? "ok" : "danger"}>{account.connectionStatus === "connected" ? t.cc.connStatusConnected : account.connectionStatus === "missing_permission" ? t.cc.connStatusMissingPermission : t.cc.connStatusNeedsReconnect}</Badge></div>
          <div><p className="text-xs text-[var(--color-muted)]">{t.cc.tokenHealthLabel}</p><Badge tone={account.tokenHealth === "ok" ? "ok" : account.tokenHealth === "unknown" ? "neutral" : "danger"}>{account.tokenHealth === "ok" ? t.cc.tokenOk : account.tokenHealth === "unknown" ? t.cc.tokenUnknown : t.cc.tokenInvalidLabel}</Badge></div>
          <div><p className="text-xs text-[var(--color-muted)]">{t.cc.lastTokenCheck}</p><p className="font-medium">{account.lastTokenCheckAt ? formatDateTime(account.lastTokenCheckAt) : "—"}</p></div>
          <div><p className="text-xs text-[var(--color-muted)]">{t.cc.lastGraphCheck}</p><p className="font-medium">{account.lastSuccessfulGraphCheckAt ? formatDateTime(account.lastSuccessfulGraphCheckAt) : "—"}</p></div>
          <div><p className="text-xs text-[var(--color-muted)]">{t.cc.capRead}</p><Badge tone="ok">{t.cc.safeLiveEnabled}</Badge></div>
          <div><p className="text-xs text-[var(--color-muted)]">{t.cc.capHide}</p><Badge tone={account.grantedPermissions.includes(HIDE_PERMISSION) ? "ok" : "warn"}>{account.grantedPermissions.includes(HIDE_PERMISSION) ? HIDE_PERMISSION : t.cc.safeLiveDisabled}</Badge></div>
          <div><p className="text-xs text-[var(--color-muted)]">Token</p><Badge tone={tokenHealthy ? "ok" : "danger"}>{tokenHealthy ? t.cc.on : t.cc.off}</Badge></div>
          <div><p className="text-xs text-[var(--color-muted)]">{t.cc.killSwitch}</p><Badge tone={anyKill ? "danger" : "ok"}>{anyKill ? t.cc.killSwitchOn : t.cc.killSwitchOff}</Badge></div>
          <div><p className="text-xs text-[var(--color-muted)]">{t.cc.lastSuccessfulHide}</p><p className="font-medium">{lastExecuted ? formatDateTime(lastExecuted.createdAt) : "—"}</p></div>
          <div><p className="text-xs text-[var(--color-muted)]">{t.cc.lastFailedHide}</p><p className="font-medium">{lastFailed ? `${formatDateTime(lastFailed.createdAt)} · ${lastFailed.providerErrorCode ?? "error"}` : "—"}</p></div>
          <div><p className="text-xs text-[var(--color-muted)]">{t.cc.rollbackAvailability}</p><Badge tone={ROLLBACK_AVAILABLE ? "ok" : "warn"}>{ROLLBACK_AVAILABLE ? t.cc.rollbackReady : t.cc.rollbackUnavailable}</Badge></div>
        </div>
        {lastFailed?.providerErrorMessage ? <p className="mt-2 text-xs text-[var(--color-danger)]">{lastFailed.providerErrorMessage}</p> : null}
      </div>

      {/* Sync control */}
      <div className="mt-6 gu-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t.dash.autoSync}</h3>
              <Badge tone={autoSync.enabled ? "ok" : "neutral"}>
                {autoSync.enabled ? t.dash.autoSyncOn : t.dash.autoSyncOff}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              Pulls comments into the inbox. Creates ReputationItems. Never
              performs moderation actions.
            </p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              {account.lastSyncedAt ? `${t.dash.lastSync}: ${formatDateTime(account.lastSyncedAt)}` : t.home.noSyncYet}
              {nextSyncAt ? ` · ${t.dash.nextSync}: ${formatDate(nextSyncAt)}` : ""}
            </p>
          </div>
          {manage && canSync ? (
            <form action={runSyncAction.bind(null, account.id)}>
              <SubmitButton pendingLabel="Syncing…">
                {t.dash.runReadOnlySync}{mode === ConnectorMode.Placeholder ? ` ${t.dash.mockSuffix}` : ""}
              </SubmitButton>
            </form>
          ) : (
            <span className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)]">
              {canSync ? "Requires connector permission" : `Sync unavailable in ${mode} mode`}
            </span>
          )}
        </div>

        {account.lastError ? (
          <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
            <span className="text-[var(--color-danger)]">Last error:</span>{" "}
            <span className="text-[var(--color-muted)]">{account.lastError}</span>
            <div className="mt-1 text-[var(--color-muted)]">
              Recommended: {recommendedAction(account.lastError, needsReconnect)}
              {account.syncAttempts > 0 ? ` · attempts: ${account.syncAttempts}` : ""}
              {account.nextRetryAt
                ? ` · next retry: ${formatDateTime(account.nextRetryAt)}`
                : ""}
            </div>
          </div>
        ) : null}

        {/* Sync history */}
        <div className="mt-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
            Recent runs
          </h4>
          {account.syncRuns.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">No sync runs yet.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
              <div className="grid grid-cols-[1fr_0.6fr_0.6fr_0.7fr_0.6fr_0.7fr_1.1fr] gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[11px] uppercase tracking-widest text-[var(--color-muted)]">
                <span>Status</span>
                <span>Fetched</span>
                <span>New</span>
                <span>Deduped</span>
                <span>Errors</span>
                <span>Duration</span>
                <span>Started</span>
              </div>
              {account.syncRuns.map((r) => (
                <div
                  key={r.id}
                  className="grid grid-cols-[1fr_0.6fr_0.6fr_0.7fr_0.6fr_0.7fr_1.1fr] items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-sm last:border-0"
                >
                  <span className="flex items-center gap-1.5">
                    <Badge tone={RUN_TONE[r.status] ?? "neutral"}>{humanize(r.status)}</Badge>
                    {r.mock ? (
                      <Badge tone="neutral">{t.dash.syncModeDemo}</Badge>
                    ) : (
                      <Badge tone="brand">{t.dash.syncModeLive}</Badge>
                    )}
                  </span>
                  <span>{r.fetched}</span>
                  <span>{r.created}</span>
                  <span>{r.deduped}</span>
                  <span>{r.errors}</span>
                  <span className="text-xs text-[var(--color-muted)]">
                    {r.durationMs != null ? `${r.durationMs} ms` : "—"}
                  </span>
                  <span className="text-xs text-[var(--color-muted)]">
                    {formatDateTime(r.startedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Webhook status (Meta) */}
      {isMeta ? (
        <div className="mt-6 gu-card p-5">
          <h3 className="mb-3 text-sm font-semibold">Webhook status</h3>
          <dl className="space-y-2 text-sm">
            <Row label="Verify token">
              {meta.webhookVerifyToken ? (
                <Badge tone="ok">configured</Badge>
              ) : (
                <Badge tone="warn">missing</Badge>
              )}
            </Row>
            <Row label="App secret (signature)">
              {meta.appSecret ? (
                <Badge tone="ok">configured</Badge>
              ) : (
                <Badge tone="warn">missing</Badge>
              )}
            </Row>
            <Row label="Callback URL">{`${appUrl}/api/webhooks/meta`}</Row>
            <Row label="Last received">
              {lastWebhook ? (
                <span className="flex items-center gap-1.5">
                  {formatDateTime(lastWebhook.receivedAt)}
                  <Badge tone={lastWebhook.signatureValid ? "ok" : "warn"}>
                    {lastWebhook.signatureValid ? "signed" : "unsigned"}
                  </Badge>
                </span>
              ) : (
                "none yet"
              )}
            </Row>
          </dl>
          <p className="mt-3 text-[11px] text-[var(--color-muted)]">
            Set this callback URL and verify token in your Meta App dashboard.
            Inbound events are stored and signature-checked; no automatic
            moderation action is taken (a follow-up sync is gated by
            META_WEBHOOK_SYNC, off by default). See docs/META_SETUP.md.
          </p>
        </div>
      ) : null}

      {/* Action capabilities + linked control policies + recent queue (V1.23) */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <h3 className="mb-3 text-sm font-semibold">{t.cc.capabilities}</h3>
          <div className="space-y-2">
            {capabilities.map((c) => (
              <div key={c.labelKey} className="flex items-center justify-between text-sm">
                <span>{t.cc[c.labelKey]}</span>
                <Badge tone={CAP_TONE[c.key] ?? "neutral"}>{t.cc[c.key as "capAvailable"]}</Badge>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-[var(--color-border)] p-2 text-[11px] text-[var(--color-muted)]">
            {t.cc.envGates}: LIVE_ACTIONS_ENABLED={String(live.liveEnabled)} · FACEBOOK_HIDE_ENABLED={String(live.facebookHideEnabled)} · DRY_RUN={String(live.dryRun)}
          </div>
          <dl className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between"><dt className="text-[var(--color-muted)]">{t.cc.lastDryRunAction}</dt><dd>{lastDryRun ? formatDateTime(lastDryRun.createdAt) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--color-muted)]">{t.cc.lastBlockedAction}</dt><dd>{lastBlocked ? formatDateTime(lastBlocked.createdAt) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--color-muted)]">{t.cc.lastExecutedAction}</dt><dd className={lastExecuted ? "text-[var(--color-warn)]" : ""}>{lastExecuted ? formatDateTime(lastExecuted.createdAt) : "—"}</dd></div>
          </dl>
        </Card>
        <div className="space-y-3">
          <Card>
            <h3 className="mb-1 text-sm font-semibold">{t.cc.linkedPolicies}</h3>
            <p className="text-2xl font-semibold">{linkedPolicies}</p>
            <Link href="/dashboard/control-center" className="text-xs text-[var(--color-brand)] hover:underline">{t.cc.controlTitle} →</Link>
          </Card>
          <Card>
            <h3 className="mb-2 text-sm font-semibold">{t.cc.recentQueue}</h3>
            {recentQueue.length === 0 ? <p className="text-xs text-[var(--color-muted)]">{t.cc.queueEmpty}</p> : (
              <div className="space-y-1">
                {recentQueue.map((qi) => (
                  <Link key={qi.id} href={`/dashboard/action-queue/${qi.id}`} className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-border-strong)]">
                    <span>{tEnum(t, "autoProtectCategory", qi.category)}</span>
                    <Badge tone="neutral">{tEnum(t, "queueState", qi.queueState)}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function recommendedAction(lastError: string, needsReconnect: boolean): string {
  if (needsReconnect || /reconnect/i.test(lastError)) return "Reconnect with Meta";
  if (/permission/i.test(lastError)) return "Reconnect and re-grant permissions";
  return "It will retry automatically after backoff";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="truncate font-mono text-xs">{children}</dd>
    </div>
  );
}
