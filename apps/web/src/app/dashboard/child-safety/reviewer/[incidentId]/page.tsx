import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVerifiedSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import { Card, Badge } from "@/components/dashboard/ui";
import { canViewChildSafetyReview, canManageChildSafetyReview, canManageChildSafetyEvidence, canViewChildSafetyProtectionPlan, canManageChildSafetyProtectionPlan } from "@guardora/core";
import { getChildSafetyIncidentDetail, listChildSafetyEvidence, getProtectionPlanForIncident, generateProtectionRecommendation, getProtectionPlanTimeline, ChildSafetyReviewNotFoundError, type ReviewerActor } from "@guardora/db";
import { REVIEWER_COPY } from "../reviewer-i18n";
import { Unauthorized } from "../unauthorized";
import { severityTone, urgencyTone, statusTone, escalationTone, availableReviewActions, isTerminalReviewTarget, fmtDateTime, shortId } from "../reviewer-view";
import { ReviewActions } from "./review-actions";
import { NotesPanel } from "./notes-panel";
import { TimelineView } from "./timeline-view";
import { EvidencePanel } from "./evidence-panel";
import { ProtectionPlanPanel, type PlanData } from "./protection-plan-panel";

export const dynamic = "force-dynamic";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">{label}</dt><dd className="mt-1 text-sm text-[var(--color-fg)]">{children}</dd></div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="p-5"><h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">{title}</h2>{children}</Card>;
}

export default async function IncidentDetailPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const locale = await getLocale();
  const t = REVIEWER_COPY[locale];
  const session = await requireVerifiedSession();
  if (!canViewChildSafetyReview(session.role)) return <Unauthorized t={t} />;
  const canManage = canManageChildSafetyReview(session.role);
  const actor: ReviewerActor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const { incidentId } = await params;

  let detail: Awaited<ReturnType<typeof getChildSafetyIncidentDetail>>;
  try { detail = await getChildSafetyIncidentDetail(actor, incidentId); }
  catch (e) { if (e instanceof ChildSafetyReviewNotFoundError) notFound(); throw e; }
  const inc = detail.incident;
  const evidence = await listChildSafetyEvidence(actor, incidentId).catch(() => []);
  const canManageEvidence = canManageChildSafetyEvidence(session.role);

  // Protection plan (view-gated): the current non-terminal plan + timeline, or the recommendation preview.
  let planData: PlanData | null = null;
  if (canViewChildSafetyProtectionPlan(session.role)) {
    const p = await getProtectionPlanForIncident(actor, incidentId).catch(() => null);
    if (p) planData = { plan: p.plan, actions: p.actions, progress: p.progress, timeline: await getProtectionPlanTimeline(actor, p.plan.id).catch(() => []) };
    else planData = { plan: null, recommendation: await generateProtectionRecommendation(actor, incidentId).catch(() => undefined) };
  }
  const canManagePlan = canManageChildSafetyProtectionPlan(session.role);
  const actions = availableReviewActions(inc.status, inc.assignedReviewerId);

  const actionsUi = {
    assign: t.actions.assign, assignToMe: t.actions.assignToMe, reassign: t.actions.reassign, unassign: t.actions.unassign,
    changeStatus: t.actions.changeStatus, confirm: t.actions.confirm, cancel: t.actions.cancel, working: t.actions.working,
    assigneePlaceholder: t.actions.assigneePlaceholder, assignTitle: t.actions.assignTitle, assignBody: t.actions.assignBody,
    statusConfirmBody: t.actions.statusConfirmBody, errorTitle: t.errorTitle,
  };
  const notesUi = { notes: t.detail.notes, addNote: t.actions.addNote, markdownHint: t.actions.markdownHint, preview: t.actions.preview, write: t.actions.write, notePlaceholder: t.actions.notePlaceholder, save: t.actions.save, working: t.actions.working, errorTitle: t.errorTitle, empty: t.detail.noNotes };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/dashboard/child-safety/reviewer" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]">← {t.detail.back}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-lg font-semibold text-[var(--color-fg)]">{shortId(inc.id)}</h1>
          <Badge tone={statusTone(inc.status)}>{t.statusLabel[inc.status] ?? inc.status}</Badge>
          <Badge tone={severityTone(inc.severity)}>{t.severityLabel[inc.severity] ?? inc.severity}</Badge>
          <Badge tone={urgencyTone(inc.urgency)}>{t.urgencyLabel[inc.urgency] ?? inc.urgency}</Badge>
          {inc.escalationState === "escalated" ? <Badge tone={escalationTone(inc.escalationState)}>{t.filter.escalated}</Badge> : null}
          {!canManage ? <span className="ml-auto text-xs text-[var(--color-muted)]">{t.detail.readOnly}</span> : null}
        </div>
      </div>

      {/* Review actions (manager only — never rendered for a read-only reviewer) */}
      {canManage ? (
        <Card className="p-4">
          <ReviewActions incidentId={inc.id} assignedReviewerId={inc.assignedReviewerId} targets={actions.statusTargets} ui={actionsUi} statusTarget={t.statusTarget} errors={t.errors} terminalTargets={["resolved", "dismissed"].filter((s) => isTerminalReviewTarget(s as never))} />
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title={t.detail.overview}>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label={t.table.profile}><span className="font-mono text-xs">{shortId(inc.protectedProfileId)}</span></Field>
              <Field label={t.detail.assignment}>{inc.assignedReviewerId ? <span className="font-mono text-xs">{shortId(inc.assignedReviewerId)}</span> : <span className="italic text-[var(--color-muted)]">{t.table.unassigned}</span>}</Field>
              <Field label="risk family">{inc.riskFamily}</Field>
              <Field label={t.table.created}>{fmtDateTime(inc.createdAt)}</Field>
              <Field label={t.table.updated}>{fmtDateTime(inc.updatedAt)}</Field>
              <Field label={t.detail.linkedAt}>{fmtDateTime(inc.lastSignalAt)}</Field>
              <Field label={t.detail.guardianDelivery}>{detail.guardianDelivery.total} · {Object.entries(detail.guardianDelivery.byStatus).map(([k, v]) => `${k}:${v}`).join(" ") || "—"}</Field>
              <Field label={t.detail.recovery}>{t.detail.recoveryRepairs}: {detail.recoveryStatus.repairs} · {t.detail.recoveryIncomplete}: {detail.recoveryStatus.incomplete}</Field>
              <Field label={t.table.signals}>{inc.signalCount}</Field>
            </dl>
          </Section>

          <Section title={t.detail.signals}>
            {detail.signals.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.detail.noSignals}</p> : (
              <ul className="space-y-2">
                {detail.signals.map((s) => (
                  <li key={s.safetySignalId} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-[var(--color-muted)]">{shortId(s.safetySignalId)}</span>
                    <Badge tone="neutral">{s.signalType}</Badge>
                    <Badge tone={severityTone(s.severity)}>{t.severityLabel[s.severity] ?? s.severity}</Badge>
                    <span className="text-xs text-[var(--color-muted)]">{t.detail.confidence}: {s.confidenceBand}</span>
                    <span className="text-xs text-[var(--color-muted)]">· {t.detail.linkedAt} {fmtDateTime(s.linkedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t.detail.escalations}>
            {detail.escalations.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.detail.noEscalations}</p> : (
              <ul className="space-y-2">{detail.escalations.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="danger">{e.escalationType}</Badge><span className="text-xs">{e.reasonCode}</span><Badge tone={urgencyTone(e.urgency)}>{t.urgencyLabel[e.urgency] ?? e.urgency}</Badge><span className="text-xs text-[var(--color-muted)]">· {t.detail.triggeredAt} {fmtDateTime(e.triggeredAt)}</span></li>
              ))}</ul>
            )}
          </Section>

          <Section title={t.detail.notifications}>
            {detail.notifications.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.detail.noNotifications}</p> : (
              <ul className="space-y-2">{detail.notifications.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="warn">{n.type}</Badge><Badge tone={n.severity === "critical" ? "danger" : "neutral"}>{n.severity}</Badge><span className="text-xs text-[var(--color-muted)]">{fmtDateTime(n.createdAt)}</span></li>
              ))}</ul>
            )}
          </Section>

          <Section title={t.detail.timeline}><TimelineView timeline={detail.timeline} t={t} /></Section>
        </div>

        <div className="space-y-4">
          <Section title={t.detail.executionSummary}>
            <dl className="grid grid-cols-2 gap-3">
              <Field label={t.detail.ledgerSignals}>{detail.ledgerSummary.signals}</Field>
              <Field label={t.detail.ledgerCompleted}>{detail.ledgerSummary.completed}</Field>
              <Field label={t.detail.ledgerDelivered}>{detail.ledgerSummary.delivered}</Field>
              <Field label={t.detail.ledgerEscalated}>{detail.ledgerSummary.escalated}</Field>
            </dl>
          </Section>

          <Section title={t.detail.auditSummary}>
            {detail.auditReferences.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.detail.noAudit}</p> : (
              <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">{detail.auditReferences.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2"><span className="truncate text-[var(--color-muted)]">{a.event}</span><span className="shrink-0 text-[var(--color-muted)]">{fmtDateTime(a.at)}</span></li>
              ))}</ul>
            )}
          </Section>

          <Section title={t.detail.notes}>
            <NotesPanel incidentId={inc.id} notes={detail.notes} canManage={canManage} ui={notesUi} errors={t.errors} />
          </Section>
        </div>
      </div>

      {/* Evidence tab — canonical evidence + chain of custody */}
      <Section title={`🗂️ ${t.evidence.tab}`}>
        <EvidencePanel incidentId={inc.id} items={evidence} canManage={canManageEvidence} t={t} />
      </Section>

      {/* Protection plan tab — internal protective-action coordination */}
      {planData ? (
        <Section title={`🧭 ${t.pp.tab}`}>
          <ProtectionPlanPanel incidentId={inc.id} data={planData} canManage={canManagePlan} t={t} />
        </Section>
      ) : null}
    </div>
  );
}
