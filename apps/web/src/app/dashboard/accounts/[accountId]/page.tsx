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
} from "@guardora/core";
import { getMetaConfig, loadEnv } from "@guardora/config";
import { PageHeader, Badge, StatCard } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { humanize, formatDateTime } from "@/lib/format";
import { CONNECTOR_TONE } from "@/lib/ui-maps";
import { runSyncAction } from "../actions";

const META_PLATFORMS = new Set<string>([
  Platform.FacebookPage,
  Platform.InstagramBusiness,
]);

export const dynamic = "force-dynamic";

const NOTICE_TONE: Record<string, string> = { ok: "ok", error: "danger" };
const HEALTH_TONE: Record<string, string> = {
  healthy: "ok",
  degraded: "warn",
  error: "danger",
  unknown: "neutral",
};
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
  const account = await prisma.connectedAccount.findFirst({
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
  });
  if (!account) notFound();

  // Latest inbound webhook for this platform (global; not tenant-scoped).
  const lastWebhook = META_PLATFORMS.has(account.platform)
    ? await prisma.webhookEvent.findFirst({
        where: { platform: account.platform },
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true, eventType: true, signatureValid: true },
      })
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
          <p className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Health</p>
          <p className="mt-2">
            <Badge tone={HEALTH_TONE[account.health] ?? "neutral"}>{humanize(account.health)}</Badge>
          </p>
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

      {/* Sync control */}
      <div className="mt-6 gu-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Read-only sync</h3>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              Pulls comments into the inbox. Creates ReputationItems. Never
              performs moderation actions.
            </p>
          </div>
          {manage && canSync ? (
            <form action={runSyncAction.bind(null, account.id)}>
              <button
                type="submit"
                className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-brand-strong)] hover:text-white"
              >
                Run read-only sync{mode === ConnectorMode.Placeholder ? " (mock)" : ""}
              </button>
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
                      <Badge tone="neutral">mock</Badge>
                    ) : (
                      <Badge tone="brand">live</Badge>
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
