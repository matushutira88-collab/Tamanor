import Link from "next/link";
import {
  ALL_PLATFORMS,
  ConnectorStatus,
  PLATFORM_META,
  Permission,
  Platform,
  can,
  getPlatformConnector,
  platformKeyFor,
  hideCapabilityState,
  platformSupportLevel,
} from "@guardora/core";
import { getMetaConfig, getMetaSetupStatus, getAutoSyncConfig, getLiveActionsConfig, getGoogleBusinessConfig } from "@guardora/config";
import { PageHeader, Badge, Card } from "@/components/dashboard/ui";
import { ConnectorStatusBadge } from "@/components/dashboard/connector-status-badge";
import { BrandIcon } from "@/components/dashboard/platform-icon";
import { AccountsTable } from "@/components/dashboard/accounts-table";
import { getLocale } from "@/i18n/locale-server";
import { requireSession } from "@/server/auth";
import { withTenant } from "@guardora/db";
import { getRealModeFilter } from "@/server/data-mode";
import { navItem } from "@/lib/nav";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { formatDateTime } from "@/lib/format";
import { CONNECTOR_TONE } from "@/lib/ui-maps";
import { connectMock, disconnect } from "./actions";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/accounts");

const META_PLATFORMS = new Set<string>([
  Platform.FacebookPage,
  Platform.InstagramBusiness,
]);

// V1.45B — official Facebook page for removing a connected business integration (app). The
// user finishes provider-side removal here; Meta exposes no per-Page/IG token revoke API.
const FACEBOOK_REMOVE_APP_URL = "https://www.facebook.com/help/405094243235242";

const CHECK_TONE: Record<string, string> = {
  configured: "ok",
  on: "ok",
  off: "neutral",
  missing: "warn",
  invalid: "danger",
};

const META_NOTICES: Record<string, { tone: string; text: string }> = {
  config_missing: { tone: "warn", text: "Meta OAuth is not configured. Set the required env vars below." },
  denied: { tone: "danger", text: "You do not have permission to connect accounts." },
  bad_brand: { tone: "danger", text: "Could not start Meta OAuth: brand not found." },
  oauth_denied: { tone: "warn", text: "Meta sign-in was cancelled." },
  invalid_state: { tone: "danger", text: "Meta OAuth failed: invalid state (possible CSRF). Try again." },
  token_exchange_failed: { tone: "danger", text: "Meta token exchange failed. No account was connected." },
  discovery_failed: { tone: "danger", text: "Could not read your Facebook Pages from Meta. No account was connected." },
  no_pages: { tone: "warn", text: "No Facebook Pages were available on that Meta account. Make sure you are an admin of at least one Page." },
  missing_permission: { tone: "warn", text: "Tamanor didn't get permission to read your Facebook Pages. Reconnect and keep the Pages permission enabled (don't uncheck it)." },
  meta_api_error: { tone: "danger", text: "Meta returned an error while reading your Pages. Please try again; if it keeps happening, contact support." },
  save_failed: { tone: "danger", text: "We couldn't save your connection. Please try connecting again." },
};

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const hdrT = await getT();
  const manage = can(session.role, Permission.ConnectorManage);
  const meta = getMetaConfig();
  const gbp = getGoogleBusinessConfig();
  const setup = getMetaSetupStatus();
  const sp = await searchParams;
  const metaNotice = sp.meta ? META_NOTICES[sp.meta] : undefined;

  const brands = await withTenant(session.tenantId, (db) => db.brand.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "asc" },
    include: { connectedAccounts: true },
  }));

  const realMode = await getRealModeFilter(session.tenantId);

  // Connected accounts summary — real (live) accounts first, demo/mock after.
  // In real mode, demo/mock accounts are hidden entirely.
  const brandNameById = new Map(brands.map((b) => [b.id, b.name]));
  const connectedAccounts = brands
    .flatMap((b) => b.connectedAccounts)
    .filter((a) => a.status === ConnectorStatus.Active || (!realMode.isRealMode && a.status === ConnectorStatus.MockConnected))
    .sort((a, b) => {
      const live = (x: typeof a) => (x.status === ConnectorStatus.Active ? 0 : 1);
      return live(a) - live(b) || (b.lastSuccessfulSyncAt?.getTime() ?? 0) - (a.lastSuccessfulSyncAt?.getTime() ?? 0);
    });

  const autoSync = getAutoSyncConfig();
  const live = getLiveActionsConfig();
  const hideCapability = (grantedPermissions: string[]): { key: string; tone: string } =>
    !live.facebookHideEnabled || !live.liveEnabled
      ? { key: "capDisabledEnv", tone: "neutral" }
      : grantedPermissions.includes("pages_manage_engagement")
        ? { key: "capAvailable", tone: "ok" }
        : { key: "capMissingPerms", tone: "warn" };
  const [lastAutoRow, lastManualRow] = await withTenant(session.tenantId, (db) => Promise.all([
    db.auditLog.findFirst({ where: { tenantId: session.tenantId, event: "sync.completed", metadata: { path: ["trigger"], equals: "automatic" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.auditLog.findFirst({ where: { tenantId: session.tenantId, event: "sync.completed", metadata: { path: ["trigger"], equals: "manual" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]));
  const lastErrorAccount = connectedAccounts.find((a) => a.lastError);
  const nextSyncEstimate = autoSync.enabled && lastAutoRow ? new Date(lastAutoRow.createdAt.getTime() + autoSync.intervalSeconds * 1000) : null;

  return (
    <>
      <PageHeader
        title={hdrT.dashHeaders[nav.icon].title}
        description={hdrT.dashHeaders[nav.icon].desc}
        action={
          <Badge tone={meta.configured ? "ok" : "warn"}>
            {hdrT.dash.metaOauth}: {meta.configured ? hdrT.dash.configured : hdrT.dash.notConfiguredLower}
          </Badge>
        }
      />

      {metaNotice ? (
        <div className="mb-5" role="status">
          <Badge tone={metaNotice.tone}>Meta</Badge>{" "}
          <span className="text-sm text-[var(--color-muted)]">{metaNotice.text}</span>
        </div>
      ) : null}

      {/* V1.59 2b — Watched Accounts PRODUCT TABLE (each FB Page + each IG its own row), real today
          metrics, connection status separate from monitoring, row actions. Desktop table + mobile cards. */}
      <div className="mb-6">
        <AccountsTable tenantId={session.tenantId} locale={await getLocale()} />
      </div>

      {/* V1.45B — truthful post-disconnect notice: local credential removal is done; for Meta
          we clearly state provider-side revocation was NOT performed and link the official
          manual-removal page (no token in the URL, opened safely). */}
      {sp.disconnected ? (
        <div className="mb-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2" role="status">
          <p className="text-sm font-medium">{hdrT.dash.disconnectedTitle}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{hdrT.dash.disconnectedLocal}</p>
          {META_PLATFORMS.has(sp.disconnected) ? (
            <>
              <p className="mt-1 text-sm text-[var(--color-muted)]">{hdrT.dash.disconnectedMetaProvider}</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                {hdrT.dash.disconnectedManualHint}{" "}
                <a
                  href={FACEBOOK_REMOVE_APP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[var(--color-brand)] hover:underline"
                >
                  {hdrT.dash.disconnectedManualCta} →
                </a>
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {realMode.isRealMode ? (
        <div className="mb-4 rounded-lg border border-[var(--color-brand)] px-3 py-2 text-sm">
          🧪 <span className="font-medium">{hdrT.dash.realTestMode}</span> · <span className="text-[var(--color-muted)]">{hdrT.dash.realTestModeHint}</span>
        </div>
      ) : null}

      {/* Connected accounts + Auto-sync status (V1.21A) */}
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <h3 className="mb-3 text-sm font-semibold">{hdrT.dash.connectedAccountsTitle}</h3>
          {connectedAccounts.length === 0 ? (
            <div>
              <p className="text-sm font-medium">{hdrT.dash.noConnectedAccounts}</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">{hdrT.dash.noAccountsBody}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {connectedAccounts.map((a) => {
                const live = a.status === ConnectorStatus.Active;
                return (
                  <div key={a.id} className="rounded-lg border border-[var(--color-border)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.externalName ?? PLATFORM_META[a.platform as Platform].label}</span>
                      <Badge>{PLATFORM_META[a.platform as Platform].label}</Badge>
                      {/* V1.39B — single truthful connector status (never fake "Live"/"Healthy"). */}
                      <ConnectorStatusBadge
                        account={{ platformKey: platformKeyFor(a.platform), status: a.status, health: a.health, connectionStatus: a.connectionStatus, tokenHealth: a.tokenHealth, contentPermissionState: a.contentPermissionState, mode: a.mode }}
                        liveSyncEnabled={meta.liveSync}
                      />
                      {!live ? <Badge tone="neutral">{hdrT.dash.demoAccount}</Badge> : null}
                      <Badge tone="neutral">{hdrT.dash.syncModeReadOnly}</Badge>
                      {a.platform === Platform.FacebookPage ? (() => {
                        const cap = hideCapability(a.grantedPermissions);
                        return <Badge tone={cap.tone}>{hdrT.autoProtect.hideCapability}: {hdrT.autoProtect[cap.key as "capAvailable" | "capMissingPerms" | "capDisabledEnv"]}</Badge>;
                      })() : null}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
                      <div>{hdrT.dash.brand}: <span className="text-[var(--color-fg)]">{brandNameById.get(a.brandId) ?? ""}</span></div>
                      <div>{hdrT.dash.lastSync}: <span className="text-[var(--color-fg)]">{a.lastSuccessfulSyncAt ? formatDateTime(a.lastSuccessfulSyncAt) : "—"}</span></div>
                      <div>{hdrT.dash.connectedAtLabel}: <span className="text-[var(--color-fg)]">{formatDateTime(a.createdAt)}</span></div>
                    </dl>
                    {/* V1.31/V1.35 — honest, capability-derived summary per platform. */}
                    {(() => {
                      const conn = getPlatformConnector(platformKeyFor(a.platform));
                      const caps = conn.capabilities;
                      const level = platformSupportLevel(conn.platform);
                      // Research / limited platforms: one honest line, no ⛔ noise.
                      if (level === "research" || level === "limited") {
                        return (
                          <div className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
                            <p className="text-xs">🔬 {level === "research" ? hdrT.cap.researchBeta : hdrT.cap.limited}</p>
                          </div>
                        );
                      }
                      // Monitoring line: comments (FB/IG/YT) or reviews (Google).
                      const monitorLine = caps.canReviewSync ? hdrT.cap.reviewsOn : caps.canReadComments ? hdrT.cap.commentsOn : hdrT.cap.commentsOff;
                      // Hide wording: enabled (FB) / test_only (IG) / not-yet / unsupported.
                      const hideState = hideCapabilityState(conn.platform);
                      const hideLine = hideState === "enabled" ? hdrT.cap.hideSupported
                        : hideState === "test_only" ? hdrT.cap.hideTestOnly
                        : conn.supported ? hdrT.cap.hideNotYet : hdrT.cap.hideUnsupported;
                      return (
                        <div className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{hdrT.cap.summaryTitle}</p>
                          <ul className="space-y-0.5 text-xs">
                            <li>{caps.canReadComments || caps.canReviewSync ? "✅" : "⛔"} {monitorLine}</li>
                            {level !== "reviews" ? <li>{caps.canHideComment ? "✅" : "🕓"} {hideLine}</li> : null}
                            <li>{caps.canModerateAutomatically ? "✅" : "⛔"} {caps.canModerateAutomatically ? hdrT.cap.autoOn : hdrT.cap.autoOff}</li>
                          </ul>
                          {caps.publicHiddenStillVisibleToAuthorOrAdmin ? (
                            <p className="mt-1 text-[11px] text-[var(--color-muted)]">{hdrT.cap.visibilityNote}</p>
                          ) : null}
                          {conn.supported && !caps.canHideComment ? (
                            <p className="mt-1 text-[11px] text-[var(--color-muted)]">{hdrT.cap.actionsDepend}</p>
                          ) : null}
                        </div>
                      );
                    })()}
                    {a.grantedPermissions.length > 0 || a.pageId ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-medium text-[var(--color-muted)]">{hdrT.cap.advanced}</summary>
                        <div className="mt-1 space-y-1 text-[11px] text-[var(--color-muted)]">
                          <div>{hdrT.dash.pageIdLabel}: <span className="font-mono text-[var(--color-fg)]">{a.pageId ?? a.externalId}</span></div>
                          {a.grantedPermissions.length > 0 ? <div>{hdrT.dash.grantedPermsLabel}: {a.grantedPermissions.join(", ")}</div> : null}
                        </div>
                      </details>
                    ) : null}
                    {a.lastError ? (
                      <p className="mt-1.5 text-[11px] text-[var(--color-danger)]">{hdrT.dash.lastSyncErrorLabel}: {a.lastError}</p>
                    ) : null}
                    <Link href={`/dashboard/accounts/${a.id}`} className="mt-2 inline-block text-xs font-medium text-[var(--color-brand)] hover:underline">
                      {hdrT.dash.openAccountDetail} →
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="h-fit">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold">{hdrT.dash.autoSyncStatusTitle}</h3>
            <Badge tone={autoSync.enabled ? "ok" : "warn"}>{autoSync.enabled ? hdrT.dash.autoSyncEnabled : hdrT.dash.autoSyncDisabled}</Badge>
          </div>
          <p className="mb-2 text-[11px] text-[var(--color-muted)]">{hdrT.dash.syncCadence.replace("{n}", String(autoSync.intervalSeconds))}</p>
          <dl className="space-y-1.5 text-xs">
            <div className="text-[var(--color-muted)]">{hdrT.dash.workerRequired}</div>
            <div>{hdrT.dash.lastAutomaticSync}: <span className="font-medium">{lastAutoRow ? formatDateTime(lastAutoRow.createdAt) : hdrT.dash.noAutomaticSyncYet}</span></div>
            <div>{hdrT.dash.lastManualSync}: <span className="font-medium">{lastManualRow ? formatDateTime(lastManualRow.createdAt) : "—"}</span></div>
            {autoSync.enabled ? (
              <div>{hdrT.dash.nextSyncEstimate}: <span className="font-medium">{nextSyncEstimate ? formatDateTime(nextSyncEstimate) : "—"}</span></div>
            ) : null}
            {lastErrorAccount?.lastError ? (
              <div className="text-[var(--color-danger)]">{hdrT.dash.lastSyncErrorLabel}: {lastErrorAccount.lastError}</div>
            ) : null}
          </dl>
        </Card>
      </div>

      {/* V1.36 — Google Business Profile connection (review monitoring, read-only). */}
      <Card className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <BrandIcon platform={Platform.GoogleBusiness} size={24} />
          <h3 className="text-sm font-semibold">{PLATFORM_META[Platform.GoogleBusiness].label}</h3>
          <Badge tone="neutral">{hdrT.gbp.reviewMonitoring}</Badge>
          {sp.google ? <Badge tone={sp.google === "disconnected" ? "neutral" : "warn"}>{hdrT.gbp[(`state_${sp.google}` as "state_not_configured")] ?? hdrT.gbp.state_not_configured}</Badge> : null}
        </div>
        {gbp.status === "not_configured" ? (
          <p className="text-sm text-[var(--color-muted)]">{hdrT.gbp.state_not_configured}</p>
        ) : gbp.status === "api_disabled" ? (
          <p className="text-sm text-[var(--color-muted)]">{hdrT.gbp.state_api_disabled}</p>
        ) : (
          <>
            <p className="text-sm text-[var(--color-muted)]">{hdrT.gbp.readyToConnectBody}</p>
            {manage ? (
              <a href="/api/connectors/google-business/connect" className="mt-3 inline-block rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{hdrT.gbp.connect}</a>
            ) : null}
          </>
        )}
        <ul className="mt-3 space-y-0.5 text-xs text-[var(--color-muted)]">
          <li>✅ {hdrT.cap.reviewsOn}</li>
          <li>⛔ {hdrT.gbp.protectionUnavailable}</li>
        </ul>
        <p className="mt-2 text-[11px] text-[var(--color-muted)]">{hdrT.gbp.policyNote}</p>
      </Card>

      {brands.length === 0 ? (
        <div className="gu-card p-6 text-sm text-[var(--color-muted)]">
          {hdrT.dash.createBrandFirst}
        </div>
      ) : (
        <div className="space-y-8">
          {(realMode.isRealMode ? brands.filter((b) => realMode.realBrandIds.includes(b.id)) : brands).map((brand) => {
            const byPlatform = new Map(
              brand.connectedAccounts.map((a) => [a.platform, a]),
            );
            return (
              <section key={brand.id}>
                <h2 className="mb-3 text-sm font-semibold">{brand.name}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {ALL_PLATFORMS.map((p) => {
                    const pMeta = PLATFORM_META[p];
                    const account = byPlatform.get(p);
                    const connected =
                      account?.status === ConnectorStatus.MockConnected ||
                      account?.status === ConnectorStatus.Active;
                    const isMeta = META_PLATFORMS.has(p);
                    return (
                      <div key={p} className="gu-card p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <BrandIcon platform={p} size={26} />
                            <div className="min-w-0">
                            <h3 className="text-sm font-semibold">{pMeta.label}</h3>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Badge
                                tone={
                                  account
                                    ? CONNECTOR_TONE[account.status as keyof typeof CONNECTOR_TONE] ?? "neutral"
                                    : "neutral"
                                }
                              >
                                {account ? tEnum(hdrT, "connector", account.status) : hdrT.dash.notConnected}
                              </Badge>
                              {account ? (
                                <Badge tone="neutral">
                                  {tEnum(hdrT, "mode", account.mode)}
                                </Badge>
                              ) : null}
                            </div>
                            </div>
                          </div>
                          {manage ? (
                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              {isMeta && meta.configured && !connected ? (
                                <a
                                  href={`/api/connectors/meta/start?brandId=${brand.id}`}
                                  className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--color-brand-strong)] hover:text-white"
                                >
                                  {hdrT.dash.connectWithMeta}
                                </a>
                              ) : isMeta && !meta.configured && !connected ? (
                                <span className="rounded-lg border border-[var(--color-warn)] px-3 py-1.5 text-xs text-[var(--color-warn)]">
                                  {hdrT.dash.configMissing}
                                </span>
                              ) : null}

                              {connected ? (
                                <>
                                  <Link
                                    href={`/dashboard/accounts/${account!.id}`}
                                    className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs transition hover:border-[var(--color-brand)]"
                                  >
                                    {hdrT.dash.details}
                                  </Link>
                                  <form action={disconnect.bind(null, account!.id)}>
                                    <button
                                      type="submit"
                                      className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs transition hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
                                    >
                                      {hdrT.dash.disconnect}
                                    </button>
                                  </form>
                                </>
                              ) : (
                                <form action={connectMock.bind(null, brand.id, p as Platform)}>
                                  <button
                                    type="submit"
                                    className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] transition hover:text-[var(--color-fg)]"
                                  >
                                    {hdrT.dash.connectMock}
                                  </button>
                                </form>
                              )}
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-1.5">
                          {pMeta.supportsReviews ? <Badge tone="ok">{hdrT.dash.reviews}</Badge> : null}
                          <Badge tone="ok">{hdrT.dash.comments}</Badge>
                          {pMeta.supportsReply ? <Badge>{hdrT.dash.reply}</Badge> : null}
                          {pMeta.supportsHide ? (
                            <Badge>{hdrT.dash.hide}</Badge>
                          ) : (
                            <Badge tone="warn">{hdrT.dash.noApiHide}</Badge>
                          )}
                          {pMeta.supportsDelete ? <Badge>{hdrT.dash.delete}</Badge> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Developer diagnostics — technical env checklist, collapsed by default. */}
      <details className="mt-8 gu-card p-5">
        <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <span className="text-[var(--color-muted)]">{hdrT.dash.developerDiagnostics}</span>
            <Badge tone={setup.ready ? "ok" : "warn"}>{setup.ready ? hdrT.dash.ready : hdrT.dash.incomplete}</Badge>
          </span>
          <Link
            href="/dashboard/accounts/meta/test"
            className="text-xs font-normal text-[var(--color-brand)] hover:underline"
          >
            {hdrT.dash.liveTestChecklist}
          </Link>
        </summary>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          {hdrT.dash.devDiagIntro} <code>docs/META_SETUP.md</code>.
        </p>
        <ul className="mt-3 space-y-1.5">
          {setup.checks.map((c) => (
            <li key={c.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <code className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs">
                  {c.key}
                </code>
                {c.note ? (
                  <span className="text-xs text-[var(--color-muted)]">{c.note}</span>
                ) : null}
              </span>
              <Badge tone={CHECK_TONE[c.status]}>{tEnum(hdrT, "check", c.status)}</Badge>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
