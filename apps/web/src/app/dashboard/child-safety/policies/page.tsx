import Link from "next/link";
import { requireVerifiedSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, Badge, EmptyState } from "@/components/dashboard/ui";
import { canViewChildSafetyPolicy, canManageChildSafetyPolicy } from "@guardora/core";
import { systemDb, listChildSafetyPolicies, type PolicyActor } from "@guardora/db";
import { POLICY_COPY } from "./policy-i18n";
import { Unauthorized } from "./unauthorized";
import { NewPolicyForm } from "./new-policy-form";
import { policyStatusTone, fmtDateTime } from "./policy-view";

export const dynamic = "force-dynamic";

export default async function ChildSafetyPoliciesPage() {
  const locale = await getLocale();
  const t = POLICY_COPY[locale];
  const session = await requireVerifiedSession();
  if (!canViewChildSafetyPolicy(session.role)) return <Unauthorized t={t} />;

  const membership = await systemDb.membership.findFirst({ where: { userId: session.userId, tenantId: session.tenantId }, select: { id: true } });
  if (!membership) return <Unauthorized t={t} />;
  const actor: PolicyActor = { tenantId: session.tenantId, userId: session.userId, membershipId: membership.id, role: session.role };
  const canManage = canManageChildSafetyPolicy(session.role);
  const policies = await listChildSafetyPolicies(actor);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader eyebrow="⚖️" title={t.title} description={t.subtitle} />
        <Link href="/dashboard/child-safety/reviewer" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.backToConsole}</Link>
      </div>

      {/* Safety + governance notices (not color-only; explicit text). */}
      <Card className="space-y-1.5 p-4 text-xs text-[var(--color-muted)]">
        <p>🔒 {t.privacyNotice}</p>
        <p>🛡️ {t.guardianNotice}</p>
        <p>✋ {t.manualOnlyNotice}</p>
        <p>👥 {t.twoPersonNotice}</p>
        <p>⏭️ {t.prospectiveNotice}</p>
      </Card>

      {canManage ? <NewPolicyForm t={t} /> : null}

      <Card className="overflow-hidden p-0">
        {policies.length === 0 ? (
          <div className="p-8"><EmptyState title={t.list.empty} body={t.editor.help} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                  <th className="px-4 py-2 font-semibold">{t.list.policyKey}</th>
                  <th className="px-3 py-2 font-semibold">{t.list.purpose}</th>
                  <th className="px-3 py-2 font-semibold">{t.list.activeVersion}</th>
                  <th className="px-3 py-2 font-semibold">{t.list.lastActivation}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t.list.versions}</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-neutral-soft)]">
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/child-safety/policies/${p.id}`} className="font-mono text-xs font-semibold text-[var(--color-brand-strong)] hover:underline" aria-label={`${t.list.open} ${p.policyKey}`}>{p.policyKey}</Link>
                    </td>
                    <td className="px-3 py-2.5">{t.purpose[p.purpose] ?? p.purpose}</td>
                    <td className="px-3 py-2.5">
                      {p.activeVersion ? (
                        <Badge tone={policyStatusTone(p.activeVersion.status)}>v{p.activeVersion.versionNumber} · {t.statusLabel[p.activeVersion.status] ?? p.activeVersion.status}</Badge>
                      ) : <span className="text-xs text-[var(--color-muted)]">{t.list.noActive}</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-[var(--color-muted)]">{fmtDateTime(p.lastActivationAt)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{p.versionCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
