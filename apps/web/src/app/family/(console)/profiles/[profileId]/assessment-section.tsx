import { ALL_ASSESSMENT_PURPOSES, AssessmentPurpose } from "@guardora/core";
import type { SafeRecipientAssessmentVM, SafeRecipientDecision, SafeRecipientTimelineEntryVM } from "@guardora/db";
import { Badge, Field, Select } from "@/components/dashboard/ui";
import { famLabel, type FamilyDict } from "../../../family-i18n";
import { ConfirmDialog } from "../../../confirm-dialog";
import { requestAssessmentAction, approveAssessmentAction, resumeAssessmentAction, suspendAssessmentAction, rejectAssessmentAction, expireAssessmentAction } from "./assessment-actions";

/**
 * CS-C11 — per-guardian SAFE-RECIPIENT assessment controls (content-free). The assessment ONLY decides
 * whether a guardian may be a safe recipient of Family safety information for a purpose — it NEVER grants
 * data access (that is CS-C12). Shows the assessment status + a safe/not-safe badge (with a bounded reason
 * from the resolver), request/approve/reject/suspend/resume/expire, and the assessment timeline.
 */
export function GuardianAssessmentSection({ t, profileId, relationshipId, guardianRoleLabel, records, decision, timeline, canManage }: {
  t: FamilyDict; profileId: string; relationshipId: string; guardianRoleLabel: string;
  records: SafeRecipientAssessmentVM[]; decision: SafeRecipientDecision; timeline: SafeRecipientTimelineEntryVM[]; canManage: boolean;
}) {
  const c = t.c11;
  // The manageable assessment for the DEFAULT purpose (safety_information) shown by the resolver decision.
  const live = records.find((r) => r.purpose === AssessmentPurpose.SafetyInformation && (r.assessmentStatus === "pending" || r.assessmentStatus === "approved" || r.assessmentStatus === "suspended") && r.revokedAt === null && r.archivedAt === null);
  const purposeOptions = (ALL_ASSESSMENT_PURPOSES as readonly string[]).map((v) => ({ value: v, label: famLabel(c.purposes, v) }));

  return (
    <div className="rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="neutral">{guardianRoleLabel}</Badge>
          {live ? <>
            <Badge tone={live.assessmentStatus === "approved" ? "ok" : "warn"}>{famLabel(c.statuses, live.assessmentStatus)}</Badge>
            <span className="text-xs text-[var(--color-muted)]">{c.purposeLabel}: {famLabel(c.purposes, live.purpose)}</span>
          </> : <span className="text-xs text-[var(--color-muted)]">{c.noAssessment}</span>}
        </span>
        <Badge tone={decision.safe ? "ok" : "neutral"}>{decision.safe ? c.safe : c.notSafe}</Badge>
      </div>
      {!decision.safe ? <p className="mt-1 text-xs text-[var(--color-muted)]">{c.safeReason}: {famLabel(c.reasons, decision.reason)}</p> : null}

      {canManage && live ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {live.assessmentStatus === "pending" ? (
            <>
              <form action={approveAssessmentAction}>
                <input type="hidden" name="profileId" value={profileId} />
                <input type="hidden" name="assessmentId" value={live.id} />
                <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-brand-strong)] hover:border-[var(--color-brand)]">{c.approve}</button>
              </form>
              <ConfirmDialog action={rejectAssessmentAction} hiddenName="assessmentId" hiddenValue={live.id} extraHidden={{ profileId }} triggerLabel={c.reject} title={c.rejectDialogTitle} body={c.rejectDialogBody} confirmLabel={c.rejectDialogConfirm} cancelLabel={t.dialog.cancel} workingLabel={t.dialog.working} errorTitle={t.dialog.errorTitle} errorMessages={c.errors} danger />
            </>
          ) : null}
          {live.assessmentStatus === "approved" ? (
            <ConfirmDialog action={suspendAssessmentAction} hiddenName="assessmentId" hiddenValue={live.id} extraHidden={{ profileId }} triggerLabel={c.suspend} title={c.suspendDialogTitle} body={c.suspendDialogBody} confirmLabel={c.suspendDialogConfirm} cancelLabel={t.dialog.cancel} workingLabel={t.dialog.working} errorTitle={t.dialog.errorTitle} errorMessages={c.errors} danger />
          ) : null}
          {live.assessmentStatus === "suspended" ? (
            <form action={resumeAssessmentAction}>
              <input type="hidden" name="profileId" value={profileId} />
              <input type="hidden" name="assessmentId" value={live.id} />
              <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-brand-strong)] hover:border-[var(--color-brand)]">{c.resume}</button>
            </form>
          ) : null}
          {live.assessmentStatus === "approved" || live.assessmentStatus === "suspended" ? (
            <ConfirmDialog action={expireAssessmentAction} hiddenName="assessmentId" hiddenValue={live.id} extraHidden={{ profileId }} triggerLabel={c.expire} title={c.expireDialogTitle} body={c.expireDialogBody} confirmLabel={c.expireDialogConfirm} cancelLabel={t.dialog.cancel} workingLabel={t.dialog.working} errorTitle={t.dialog.errorTitle} errorMessages={c.errors} />
          ) : null}
        </div>
      ) : null}

      {canManage && !live ? (
        <form action={requestAssessmentAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="profileId" value={profileId} />
          <input type="hidden" name="guardianRelationshipId" value={relationshipId} />
          <Field label={c.purposeLabel}><Select name="purpose" required options={purposeOptions} defaultValue={AssessmentPurpose.SafetyInformation} /></Field>
          <div className="self-end">
            <button type="submit" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)]">{c.request}</button>
          </div>
        </form>
      ) : null}

      {timeline.length > 0 ? (
        <ol className="mt-3 space-y-1.5 border-t border-[var(--color-border)] pt-3">
          {timeline.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-[var(--color-fg)]">{c.events[e.event] ?? e.event.split(".").slice(-1)[0]?.replace(/_/g, " ")}</span>
              <span className="text-[var(--color-muted)]">{new Date(e.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
