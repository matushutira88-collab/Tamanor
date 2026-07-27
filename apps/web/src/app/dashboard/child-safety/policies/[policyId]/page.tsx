import Link from "next/link";
import { requireVerifiedSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, Badge, EmptyState } from "@/components/dashboard/ui";
import {
  canViewChildSafetyPolicy, canManageChildSafetyPolicy, canSubmitChildSafetyPolicy,
  canApproveChildSafetyPolicy, canActivateChildSafetyPolicy, canSimulateChildSafetyPolicy,
} from "@guardora/core";
import { systemDb, getChildSafetyPolicy, listChildSafetyPolicyDecisions, type PolicyActor } from "@guardora/db";
import { POLICY_COPY } from "../policy-i18n";
import { Unauthorized } from "../unauthorized";
import { VersionActions } from "./version-actions";
import { policyStatusTone, shortHash, fmtDateTime } from "../policy-view";

export const dynamic = "force-dynamic";

export default async function PolicyDetailPage({ params }: { params: Promise<{ policyId: string }> }) {
  const locale = await getLocale();
  const t = POLICY_COPY[locale];
  const session = await requireVerifiedSession();
  if (!canViewChildSafetyPolicy(session.role)) return <Unauthorized t={t} />;
  const membership = await systemDb.membership.findFirst({ where: { userId: session.userId, tenantId: session.tenantId }, select: { id: true } });
  if (!membership) return <Unauthorized t={t} />;
  const actor: PolicyActor = { tenantId: session.tenantId, userId: session.userId, membershipId: membership.id, role: session.role };
  const { policyId } = await params;

  const policy = await getChildSafetyPolicy(actor, policyId).catch(() => null);
  if (!policy) return <div className="p-8"><EmptyState title={t.errors.not_found ?? "Not found"} body="" /></div>;
  const decisions = await listChildSafetyPolicyDecisions(actor, { purpose: policy.purpose, pageSize: 15 }).catch(() => ({ items: [] as Array<Record<string, unknown>> }));

  const caps = {
    manage: canManageChildSafetyPolicy(session.role), submit: canSubmitChildSafetyPolicy(session.role),
    approve: canApproveChildSafetyPolicy(session.role), activate: canActivateChildSafetyPolicy(session.role),
    simulate: canSimulateChildSafetyPolicy(session.role),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader eyebrow="⚖️" title={`${policy.policyKey}`} description={`${t.purpose[policy.purpose] ?? policy.purpose}`} />
        <Link href="/dashboard/child-safety/policies" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.detail.back}</Link>
      </div>

      <section aria-label={t.detail.versions} className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.detail.versions}</h2>
        {policy.versions.length === 0 ? <Card className="p-6"><EmptyState title={t.detail.noVersions} body="" /></Card> : policy.versions.map((v) => (
          <Card key={v.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{t.detail.version} v{v.versionNumber}</span>
              <Badge tone={policyStatusTone(v.status)}>{t.statusLabel[v.status] ?? v.status}</Badge>
              {v.immutable ? <Badge tone="neutral">🔒 {t.detail.immutable}</Badge> : null}
              <span className="ml-auto font-mono text-[11px] text-[var(--color-muted)]" title={t.detail.hash}>{shortHash(v.definitionHash)}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-[var(--color-muted)] sm:grid-cols-4">
              <span>{t.detail.engine}: {v.engineVersion}</span>
              <span>{t.detail.schema}: {v.schemaVersion}</span>
              <span>{t.detail.created}: {fmtDateTime(v.createdAt)}</span>
              <span>{t.detail.activated}: {fmtDateTime(v.activatedAt)}</span>
              {v.rejectionReasonCode ? <span>{t.detail.rejected}: {v.rejectionReasonCode}</span> : null}
              {v.supersedesVersionId ? <span>{t.detail.supersedes}: ✓</span> : null}
            </div>
            {v.immutable ? <p className="text-[11px] text-[var(--color-muted)]">🔒 {t.immutableNotice}</p> : null}
            <VersionActions t={t} policyId={policy.id} version={{ id: v.id, versionNumber: v.versionNumber, status: v.status, definition: v.definition }} caps={caps} purpose={policy.purpose} />
          </Card>
        ))}
      </section>

      <section aria-label={t.decisions.title} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.decisions.title}</h2>
        <Card className="overflow-hidden p-0">
          <div className="border-b border-[var(--color-border)] px-4 py-2 text-[11px] text-[var(--color-muted)]">🔒 {t.decisions.noRawInput}</div>
          {(decisions.items as Array<Record<string, unknown>>).length === 0 ? (
            <p className="p-6 text-center text-sm text-[var(--color-muted)]">{t.decisions.empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]">
                    <th className="px-4 py-2 font-semibold">{t.decisions.context}</th>
                    <th className="px-3 py-2 font-semibold">{t.decisions.decision}</th>
                    <th className="px-3 py-2 font-semibold">{t.detail.engine}</th>
                    <th className="px-3 py-2 font-semibold">{t.decisions.evaluatedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {(decisions.items as Array<{ id: string; evaluationContextType: string; evaluationContextId: string | null; decisionCode: string; engineVersion: string; evaluatedAt: string }>).map((d) => (
                    <tr key={d.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-2 font-mono text-[var(--color-muted)]">{d.evaluationContextType}{d.evaluationContextId ? ` · ${d.evaluationContextId.slice(0, 8)}` : ""}</td>
                      <td className="px-3 py-2"><Badge tone="neutral">{d.decisionCode}</Badge></td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">{d.engineVersion}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)]">{fmtDateTime(d.evaluatedAt)}</td>
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
