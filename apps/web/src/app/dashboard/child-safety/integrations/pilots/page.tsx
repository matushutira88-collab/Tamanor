import Link from "next/link";
import { requireVerifiedSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, Badge, EmptyState } from "@/components/dashboard/ui";
import {
  canViewChildSafetyPilot, canManageChildSafetyPilot,
} from "@guardora/core";
import { systemDb, listPartnerPilots, listIntegrationPartners, type PilotActor } from "@guardora/db";
import { PILOT_COPY } from "./pilot-i18n";
import { PilotListConsole } from "./pilot-list-console";
import { pilotStatusTone, readinessTone, severityTone, statusGlyph, fmtDate } from "./pilot-view";
import { Unauthorized } from "./unauthorized";

export const dynamic = "force-dynamic";

export default async function PartnerPilotsPage() {
  const locale = await getLocale();
  const t = PILOT_COPY[locale];
  const session = await requireVerifiedSession();
  if (!canViewChildSafetyPilot(session.role)) return <Unauthorized t={t} />;
  const membership = await systemDb.membership.findFirst({ where: { userId: session.userId, tenantId: session.tenantId }, select: { id: true } });
  if (!membership) return <Unauthorized t={t} />;
  const actor: PilotActor = { tenantId: session.tenantId, userId: session.userId, membershipId: membership.id, role: session.role };
  const canManage = canManageChildSafetyPilot(session.role);

  const [{ items }, partners] = await Promise.all([
    listPartnerPilots(actor, { pageSize: 50 }),
    canManage ? listIntegrationPartners(actor).catch(() => []) : Promise.resolve([]),
  ]);
  const appOptions = (partners as Array<{ id: string; partnerKey: string; applications: Array<{ id: string; applicationKey: string; environment: string }> }>)
    .flatMap((p) => p.applications.map((a) => ({ partnerId: p.id, partnerKey: p.partnerKey, applicationId: a.id, applicationKey: a.applicationKey, environment: a.environment })));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader eyebrow="🚦" title={t.title} description={t.subtitle} />
        <Link href="/dashboard/child-safety/integrations" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.back}</Link>
      </div>

      <Card className="grid gap-1.5 p-4 text-xs text-[var(--color-muted)]">
        {t.privacyWarnings.map((w, i) => <p key={i}>⚠️ {w}</p>)}
      </Card>

      {canManage ? <PilotListConsole t={t} apps={appOptions} /> : null}

      <section aria-label={t.title} className="space-y-2">
        <Card className="overflow-hidden p-0">
          {items.length === 0 ? (
            <div className="p-6"><EmptyState title={t.fields.empty} body={t.subtitle} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <caption className="sr-only">{t.title}</caption>
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]">
                    <th scope="col" className="px-4 py-2 font-semibold">{t.fields.status}</th>
                    <th scope="col" className="px-3 py-2 font-semibold">{t.fields.environment}</th>
                    <th scope="col" className="px-3 py-2 font-semibold">{t.fields.readiness}</th>
                    <th scope="col" className="px-3 py-2 font-semibold">{t.fields.capabilities}</th>
                    <th scope="col" className="px-3 py-2 font-semibold">{t.fields.alertSeverity}</th>
                    <th scope="col" className="px-3 py-2 font-semibold">{t.fields.reviewDate}</th>
                    <th scope="col" className="px-3 py-2 font-semibold">{t.fields.endDate}</th>
                    <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-2"><Badge tone={pilotStatusTone(p.status)}><span aria-hidden="true">{statusGlyph(pilotStatusTone(p.status))} </span>{t.statusLabel[p.status] ?? p.status}</Badge></td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">{p.environment}</td>
                      <td className="px-3 py-2"><Badge tone={readinessTone(p.readinessState)}>{t.readinessLabel[p.readinessState] ?? p.readinessState}</Badge></td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">{p.approvedCapabilities.join(", ") || "—"}</td>
                      <td className="px-3 py-2">{p.alertSeverity ? <Badge tone={severityTone(p.alertSeverity)}>{t.severityLabel[p.alertSeverity] ?? p.alertSeverity}</Badge> : <span className="text-[var(--color-muted)]">—</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)]">{fmtDate(p.pilotReviewDate)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)]">{fmtDate(p.pilotEndDate)}</td>
                      <td className="px-3 py-2"><Link href={`/dashboard/child-safety/integrations/pilots/${p.id}`} className="font-medium text-[var(--color-brand-strong)] hover:underline">→</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
