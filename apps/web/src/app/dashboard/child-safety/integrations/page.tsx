import Link from "next/link";
import { requireVerifiedSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, Badge, EmptyState } from "@/components/dashboard/ui";
import { canViewChildSafetyIntegration, canManageChildSafetyIntegration, canManageChildSafetyIntegrationKeys, canUseChildSafetyIntegrationSandbox, INTEGRATION_ERROR_CODES } from "@guardora/core";
import { systemDb, listIntegrationPartners, listIntegrationReceipts, type IntegrationActor } from "@guardora/db";
import { INTEGRATION_COPY } from "./integration-i18n";
import { Unauthorized } from "./unauthorized";
import { IntegrationConsole } from "./integration-console";
import { installationStatusTone, resultCodeTone, fmtDateTime } from "./integration-view";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const locale = await getLocale();
  const t = INTEGRATION_COPY[locale];
  const session = await requireVerifiedSession();
  if (!canViewChildSafetyIntegration(session.role)) return <Unauthorized t={t} />;
  const membership = await systemDb.membership.findFirst({ where: { userId: session.userId, tenantId: session.tenantId }, select: { id: true } });
  if (!membership) return <Unauthorized t={t} />;
  const actor: IntegrationActor = { tenantId: session.tenantId, userId: session.userId, membershipId: membership.id, role: session.role };
  const caps = { manage: canManageChildSafetyIntegration(session.role), keys: canManageChildSafetyIntegrationKeys(session.role), sandbox: canUseChildSafetyIntegrationSandbox(session.role) };

  const [partners, receipts] = await Promise.all([
    listIntegrationPartners(actor),
    listIntegrationReceipts(actor, { pageSize: 20 }).catch(() => ({ items: [] as Array<Record<string, unknown>> })),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader eyebrow="🔌" title={t.title} description={t.subtitle} />
        <Link href="/dashboard/child-safety/reviewer" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.backToConsole}</Link>
      </div>

      <div className="rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-2 text-xs font-semibold text-[var(--color-warn)]">🧪 {t.sandboxBanner}</div>

      <Card className="grid gap-1.5 p-4 text-xs text-[var(--color-muted)] sm:grid-cols-2">
        <p>🔒 {t.notices.privacy}</p><p>🛡️ {t.notices.noRawContent}</p>
        <p>🚫 {t.notices.noCredentials}</p><p>↔️ {t.notices.noBypass}</p>
        <p>👁️ {t.notices.notSurveillance}</p><p>🔑 {t.notices.noPrivateKey}</p>
        <p>⚖️ {t.notices.riskNotGuilt}</p><p>📞 {t.notices.noAutoContact}</p>
      </Card>

      {/* Interactive registry + sandbox (client). */}
      <IntegrationConsole t={t} caps={caps} partners={partners} />

      {/* Receipts */}
      <section aria-label={t.sections.receipts} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.receipts}</h2>
        <Card className="overflow-hidden p-0">
          {(receipts.items as Array<Record<string, unknown>>).length === 0 ? (
            <div className="p-6"><EmptyState title={t.labels.empty} body={t.builder.noRawFieldNote} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]">
                    <th className="px-4 py-2 font-semibold">{t.labels.resultCode}</th>
                    <th className="px-3 py-2 font-semibold">{t.labels.canonicalSignal}</th>
                    <th className="px-3 py-2 font-semibold">v</th>
                    <th className="px-3 py-2 font-semibold">{t.labels.receivedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {(receipts.items as Array<{ id: string; resultCode: string; canonicalSignalId: string | null; protocolVersion: string; receivedAt: string }>).map((r) => (
                    <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-2"><Badge tone={resultCodeTone(r.resultCode)}>{t.resultLabel[r.resultCode] ?? r.resultCode}</Badge></td>
                      <td className="px-3 py-2 font-mono text-[var(--color-muted)]">{r.canonicalSignalId ? "✓" : "—"}</td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">{r.protocolVersion}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)]">{fmtDateTime(r.receivedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* Error-code reference */}
      <section aria-label={t.sections.errors} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.errors}</h2>
        <Card className="p-4">
          <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
            {INTEGRATION_ERROR_CODES.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <Badge tone={installationStatusTone(c === "SIGNAL_ACCEPTED" ? "active" : "revoked")}>{c}</Badge>
                {t.errorRef[c] ? <span className="text-[var(--color-muted)]">{t.errorRef[c]}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
