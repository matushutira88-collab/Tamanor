import type { Metadata } from "next";
import {
  can, Permission, ALL_BUSINESS_PROVIDERS, BUSINESS_PROVIDER_CATALOGUE, BusinessConnectionStatus,
  BusinessProvider, isBusinessConnectionActive, isMetaLeadCapabilityAvailable,
} from "@guardora/core";
import { listBusinessConnections } from "@guardora/db";
import { getMetaLeadCapability } from "@/server/meta-lead-capability";
import { requireDashboardCapability } from "@/server/route-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { businessDict, bizLabel } from "../business-i18n";
import { disconnectPlatformAction, repairMetaLeadgenSubscriptionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connected platforms", robots: { index: false, follow: false } };

const STATUS_TONE: Record<BusinessConnectionStatus, string> = {
  not_configured: "muted", pending: "info", active: "success", reauth_required: "warning",
  disconnected: "muted", error: "danger", awaiting_provider_approval: "warning",
};
// A connection is "disconnectable" only when it is a genuinely live/errored state (never the default awaiting).
const DISCONNECTABLE: BusinessConnectionStatus[] = [
  BusinessConnectionStatus.Active, BusinessConnectionStatus.Pending, BusinessConnectionStatus.ReauthRequired, BusinessConnectionStatus.Error,
];

export default async function PlatformsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const locale = await getLocale();
  const cap = await requireDashboardCapability("businessConnectedPlatforms");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;
  const session = cap.session;
  if (!can(session.role, Permission.BusinessPlatformsRead)) return <AccessDeniedState locale={locale} />;

  const t = businessDict(locale);
  const canManage = can(session.role, Permission.BusinessPlatformsManage);
  const rows = await listBusinessConnections(session.tenantId);
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  const dtf = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  // TRUTHFUL Meta Lead Ads capability — resolved from real signals (config + linked account + decryptable vault
  // credential + granted permission + VERIFIED Page-level `leadgen` webhook subscription + provider approval).
  // The tenant passed the plan gate above, so `entitled=true`.
  const metaLead = await getMetaLeadCapability(session.tenantId, true);
  const metaLeadState = metaLead.state;
  // BUSINESS-LEADGEN-SUBSCRIPTION-V1 — the one-click repair is offered ONLY when the Page subscription is not
  // verified, a Page account actually exists, and the actor holds the connector-management permission.
  const showLeadWebhookRepair =
    metaLeadState === "webhook_subscription_missing" &&
    metaLead.pageAccountId !== null &&
    can(session.role, Permission.ConnectorManage);

  return (
    <div className="space-y-6">
      <PageHeader title={t.platforms.title} description={t.platforms.desc} />

      {sp.saved === "lead_webhook" || sp.e === "lead_webhook" ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2" role="status">
          <span className="text-sm text-[var(--color-muted)]">
            {sp.saved === "lead_webhook" ? t.platforms.leadWebhookConnected : t.platforms.leadWebhookFailed}
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {ALL_BUSINESS_PROVIDERS.map((provider) => {
          const info = BUSINESS_PROVIDER_CATALOGUE[provider];
          const row = byProvider.get(provider);
          const status = (row?.status ?? info.defaultStatus) as BusinessConnectionStatus;
          const capabilities = row?.capabilities.length ? row.capabilities : info.declaredCapabilities;
          const active = isBusinessConnectionActive(status);
          const showDisconnect = canManage && DISCONNECTABLE.includes(status);
          // Truthful action copy: no live connect flow exists in this checkpoint.
          const actionNote = !info.connectImplemented
            ? (status === BusinessConnectionStatus.AwaitingProviderApproval ? t.platforms.approvalRequired : t.platforms.notAvailable)
            : t.platforms.configRequired;

          return (
            <Card key={provider}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">{bizLabel(t.provider, provider)}</h2>
                  <div className="mt-1">
                    {/* Status conveyed by text + shape (badge), never colour alone. */}
                    <Badge tone={STATUS_TONE[status]}>{bizLabel(t.connStatus, status)}</Badge>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{t.platforms.capabilities}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {capabilities.map((c) => (
                    <li key={c}><span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">{bizLabel(t.capability, c)}</span></li>
                  ))}
                </ul>
              </div>

              {provider === BusinessProvider.Meta ? (
                // TRUTHFUL Lead Ads state — presents as active ONLY when every precondition holds; otherwise it
                // names the missing precondition (never a false "active"). Conveyed by text + badge shape.
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{t.metaLead.title}</p>
                  <div className="mt-1">
                    <Badge tone={isMetaLeadCapabilityAvailable(metaLeadState) ? "success" : "muted"}>{t.metaLead[metaLeadState]}</Badge>
                  </div>
                  {/* Repair the missing Page↔app `leadgen` subscription in place — no disconnect/reconnect. */}
                  {showLeadWebhookRepair ? (
                    <form action={repairMetaLeadgenSubscriptionAction} className="mt-2">
                      <input type="hidden" name="accountId" value={metaLead.pageAccountId ?? ""} />
                      <button type="submit" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--color-surface-2)]">
                        {t.platforms.connectLeadWebhook}
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}

              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--color-muted)]">
                <div><dt className="font-semibold">{t.platforms.lastVerified}</dt><dd>{row?.lastVerifiedAt ? dtf.format(row.lastVerifiedAt) : t.platforms.never}</dd></div>
                <div><dt className="font-semibold">{t.platforms.lastSync}</dt><dd>{row?.lastSuccessfulSyncAt ? dtf.format(row.lastSuccessfulSyncAt) : t.platforms.never}</dd></div>
              </dl>

              <div className="mt-4 flex items-center gap-2">
                {active ? null : (
                  // No live connect flow — a truthful, disabled note (never a fake "Connect" that does nothing).
                  <span className="inline-flex items-center rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)]" aria-disabled="true">
                    {actionNote}
                  </span>
                )}
                {showDisconnect ? (
                  <form action={disconnectPlatformAction}>
                    <input type="hidden" name="provider" value={provider} />
                    <button type="submit" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--color-surface-2)]">{t.platforms.disconnect}</button>
                  </form>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
