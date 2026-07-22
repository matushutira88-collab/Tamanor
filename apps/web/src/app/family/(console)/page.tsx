import Link from "next/link";
import { listProtectedProfiles, listSafetySignals, listRecipientAuthorizationDecisions, listSafetySignalDeliveries, withTenant } from "@guardora/db";
import { requireFamilyConsole } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, SectionHeader, StatCard, Badge, EmptyState } from "@/components/dashboard/ui";
import { familyDict, famLabel } from "../family-i18n";

export const dynamic = "force-dynamic";

function fmt(d: Date): string { return new Date(d).toISOString().slice(0, 10); }

export default async function FamilyDashboard() {
  const { session, actor } = await requireFamilyConsole();
  const t = familyDict(await getLocale());

  // Real, tenant-scoped (RLS) data — never test fixtures.
  const [profiles, signalsPage, authPage, deliveriesPage, counts] = await Promise.all([
    listProtectedProfiles(actor),
    listSafetySignals(actor, { limit: 5 }),
    listRecipientAuthorizationDecisions(actor, { decisionStatus: "pending", limit: 5 }),
    listSafetySignalDeliveries(actor, { deliveryStatus: "available", limit: 5 }),
    withTenant(session.tenantId, (db) => Promise.all([
      db.guardianRelationship.count({ where: { tenantId: session.tenantId, status: "verified", revokedAt: null, archivedAt: null } }),
      db.safetySignal.count({ where: { tenantId: session.tenantId, archivedAt: null } }),
      db.safetyRecipientAuthorizationDecision.count({ where: { tenantId: session.tenantId, decisionStatus: "pending" } }),
      db.safetySignalDelivery.count({ where: { tenantId: session.tenantId, deliveryStatus: "available", archivedAt: null } }),
    ])),
  ]);
  const [activeGuardians, signalCount, pendingAuth, availableDeliveries] = counts;
  const recentProfiles = profiles.slice(0, 5);
  const noActivity = signalsPage.items.length === 0 && deliveriesPage.items.length === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t.dash.welcome}
        description={`${t.dash.primaryGuardian}: ${session.userName}`}
        action={<Badge tone="brand">{t.brand}</Badge>}
      />
      <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-xs text-[var(--color-muted)]">{t.privacy.messages}</p>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Link href="/family/profiles"><StatCard label={t.dash.kpiProfiles} value={String(profiles.length)} tone="brand" /></Link>
        <Link href="/family/guardians"><StatCard label={t.dash.kpiGuardians} value={String(activeGuardians)} /></Link>
        <Link href="/family/signals"><StatCard label={t.dash.kpiSignals} value={String(signalCount)} /></Link>
        <Link href="/family/authorizations"><StatCard label={t.dash.kpiPendingAuth} value={String(pendingAuth)} tone={pendingAuth > 0 ? "warn" : "neutral"} /></Link>
        <Link href="/family/deliveries"><StatCard label={t.dash.kpiDeliveries} value={String(availableDeliveries)} /></Link>
      </div>

      {/* Protected profiles overview */}
      <Card>
        <SectionHeader title={t.dash.recentProfiles} action={<Link href="/family/profiles" className="text-xs font-medium text-[var(--color-brand-strong)]">{t.common.view}</Link>} />
        {recentProfiles.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">{t.profiles.emptyText}</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {recentProfiles.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <Link href={`/family/profiles/${p.id}`} className="min-w-0 truncate font-medium hover:underline">{p.guardianLabel ?? famLabel(t.labels.ageBand, p.ageBand)}</Link>
                <span className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <Badge tone="neutral">{famLabel(t.labels.ageBand, p.ageBand)}</Badge>
                  <Badge tone={p.archivedAt ? "neutral" : "ok"}>{p.archivedAt ? t.profiles.archived : famLabel(t.labels.protectionStatus, p.protectionStatus)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Recent safety signals + empty state */}
      <Card>
        <SectionHeader title={t.dash.recentSignals} action={<Link href="/family/signals" className="text-xs font-medium text-[var(--color-brand-strong)]">{t.common.view}</Link>} />
        {signalsPage.items.length === 0 ? (
          <EmptyState title={t.dash.emptyTitle} body={t.dash.emptyText} hint={t.privacy.messages} />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {signalsPage.items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <Badge tone={s.severity === "critical" || s.severity === "high" ? "warn" : "neutral"}>{famLabel(t.labels.signalType, s.signalType)}</Badge>
                  <span className="text-xs text-[var(--color-muted)]">{famLabel(t.labels.severity, s.severity)} · {famLabel(t.labels.reviewStatus, s.reviewStatus)}</span>
                </span>
                <span className="text-xs text-[var(--color-muted)]">{fmt(s.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Internal deliveries preview */}
      {deliveriesPage.items.length > 0 && (
        <Card>
          <SectionHeader title={t.dash.deliveriesSection} action={<Link href="/family/deliveries" className="text-xs font-medium text-[var(--color-brand-strong)]">{t.common.view}</Link>} />
          <ul className="divide-y divide-[var(--color-border)]">
            {deliveriesPage.items.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <span className="flex items-center gap-2"><Badge tone="ok">{famLabel(t.labels.deliveryStatus, d.deliveryStatus)}</Badge><span className="text-xs text-[var(--color-muted)]">{famLabel(t.labels.signalType, d.signalType)}</span></span>
                <span className="text-xs text-[var(--color-muted)]">{d.availableAt ? fmt(d.availableAt) : fmt(d.preparedAt)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--color-muted)]">{t.privacy.delivery}</p>
        </Card>
      )}
    </div>
  );
}
