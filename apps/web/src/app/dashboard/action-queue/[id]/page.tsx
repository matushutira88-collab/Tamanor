import Link from "next/link";
import { notFound } from "next/navigation";
import { Permission, PLATFORM_META, Platform, can } from "@guardora/core";
import { NEVER_AUTONOMOUS } from "@guardora/ai";
import { PageHeader, Card, Badge, SecondaryButton, PrimaryButton } from "@/components/dashboard/ui";
import { Notice } from "@/components/dashboard/notice";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { formatDateTime } from "@/lib/format";
import { approveQueueItem, rejectQueueItem, markSafeQueueItem, markHarmfulQueueItem, createIncidentFromQueue } from "./actions";

export const dynamic = "force-dynamic";

export default async function ApprovalDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await getT();
  const session = await requireSession();
  const canApprove = can(session.role, Permission.ProposalApprove);
  const canAct = can(session.role, Permission.InboxAct);

  const q = await prisma.actionQueueItem.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!q) notFound();

  const [item, policy, audits] = await Promise.all([
    prisma.reputationItem.findFirst({ where: { id: q.itemId }, include: { contentItem: true, brand: { select: { name: true } } } }),
    prisma.controlPolicy.findFirst({ where: { brandId: q.brandId, category: q.category, isActive: true } }),
    prisma.auditLog.findMany({ where: { tenantId: session.tenantId, OR: [{ targetId: q.id }, { targetId: q.itemId }] }, orderBy: { createdAt: "desc" }, take: 10, select: { event: true, createdAt: true } }),
  ]);
  const meta = item ? PLATFORM_META[item.platform as Platform] : null;
  const neverAuto = NEVER_AUTONOMOUS.has(q.category as never);
  const fpRisk = q.confidence >= 0.85 ? "Low" : q.confidence >= 0.7 ? "Medium" : "High";

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex justify-between gap-4 border-b border-[var(--color-border)] py-1.5 text-sm last:border-0">
      <span className="text-[var(--color-muted)]">{label}</span><span className="text-right font-medium">{children}</span>
    </div>
  );

  return (
    <>
      <PageHeader eyebrow={t.cc.queueTitle} title={t.cc.approvalTitle} description={item?.contentItem.text ?? ""} action={<Badge tone="neutral">{t.cc.noLiveAction}</Badge>} />
      <Notice notice={sp.notice} kind={sp.kind} />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card>
            <h3 className="mb-2 text-sm font-semibold">{t.cc.whatHappened}</h3>
            <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">{item?.contentItem.text}</p>
            <dl className="mt-3">
              <Field label={t.cc.colCategory}>{tEnum(t, "autoProtectCategory", q.category)}</Field>
              <Field label="Confidence">{(q.confidence * 100).toFixed(0)}%</Field>
              <Field label={meta?.label ?? "Platform"}>{item?.brand.name} · {item?.contentItem.authorDisplayName ?? "—"}</Field>
              <Field label={t.cc.proposedActionLabel}>{q.proposedAction.replace(/_/g, " ")}</Field>
              <Field label={t.cc.colState}><Badge tone="warn">{tEnum(t, "queueState", q.queueState)}</Badge></Field>
              <Field label={t.cc.whyLabel}><span className="text-xs">{q.reason}</span></Field>
              <Field label={t.cc.triggeredPolicy}>{policy ? `${tEnum(t, "autoProtectCategory", policy.category)} → ${tEnum(t, "controlMode", policy.mode)}` : "—"}</Field>
              <Field label={t.cc.falsePositiveRisk}>{fpRisk}</Field>
            </dl>
          </Card>

          <Card>
            <h3 className="mb-2 text-sm font-semibold">{t.cc.ifAutonomous}</h3>
            <p className="text-sm text-[var(--color-muted)]">{t.cc.ifAutonomousBody}</p>
          </Card>

          <Card>
            <h3 className="mb-2 text-sm font-semibold">{t.cc.safetyChecks}</h3>
            <ul className="space-y-1 text-xs">
              <li>{neverAuto ? "🛡️" : "✅"} {t.cc.neverHideCriticism}</li>
              <li>✅ {t.cc.liveDisabled} · {t.cc.noLiveAction}</li>
              <li>{q.safetyBlocked ? "🛡️ " + tEnum(t, "queueState", "blocked_by_safety") : "✅ " + t.cc.dryRun}</li>
            </ul>
          </Card>

          <Card>
            <h3 className="mb-2 text-sm font-semibold">{t.cc.auditTrail}</h3>
            {audits.length === 0 ? <p className="text-xs text-[var(--color-muted)]">—</p> : (
              <ul className="space-y-1 text-xs">
                {audits.map((a, i) => (<li key={i} className="flex justify-between"><span className="font-mono">{a.event}</span><span className="text-[var(--color-muted)]">{formatDateTime(a.createdAt)}</span></li>))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-3">
          <Card>
            <p className="mb-1 text-xs font-medium">{t.cc.approveExplains}</p>
            <p className="mb-3 text-[11px] text-[var(--color-muted)]">{t.cc.approveExplainsBody} {t.cc.approveNote}</p>
            <div className="space-y-2">
              {canApprove ? (
                <>
                  <form action={approveQueueItem}><input type="hidden" name="id" value={q.id} /><PrimaryButton type="submit" className="w-full">{t.cc.approve}</PrimaryButton></form>
                  <form action={rejectQueueItem}><input type="hidden" name="id" value={q.id} /><SecondaryButton type="submit" className="w-full">{t.cc.reject}</SecondaryButton></form>
                </>
              ) : null}
              {canAct ? (
                <div className="grid grid-cols-2 gap-2">
                  <form action={markSafeQueueItem}><input type="hidden" name="id" value={q.id} /><button type="submit" className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs hover:border-[var(--color-border-strong)]">{t.cc.markSafe}</button></form>
                  <form action={markHarmfulQueueItem}><input type="hidden" name="id" value={q.id} /><button type="submit" className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs hover:border-[var(--color-border-strong)]">{t.cc.markHarmful}</button></form>
                  <form action={createIncidentFromQueue} className="col-span-2"><input type="hidden" name="id" value={q.id} /><button type="submit" className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs hover:border-[var(--color-border-strong)]">{t.cc.createIncidentBtn}</button></form>
                </div>
              ) : null}
            </div>
          </Card>
          <Card>
            <div className="space-y-1.5 text-xs">
              <Link href={`/dashboard/inbox/${q.itemId}`} className="block text-[var(--color-brand)] hover:underline">{t.cc.openItem} →</Link>
              <Link href="/dashboard/control-center" className="block text-[var(--color-brand)] hover:underline">{t.cc.editPolicy} →</Link>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
