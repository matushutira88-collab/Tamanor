import { Card, Badge, SectionHeader } from "@/components/dashboard/ui";
import type { Locale } from "@/i18n/config";
import { CaseRiskLevel, CaseProtectionStatus, CaseMilestoneKey, CaseTaskStatus, CASE_LIMITS } from "@guardora/core";
import type { CaseManagementView } from "@/server/cyberbullying-case";
import { CB_COPY } from "../../cb-i18n";
import { updateProtectionPlanAction, updateFollowUpAction, setMilestoneAction, createCaseTaskAction, updateCaseTaskAction } from "./case-actions";

const INPUT = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)]";
const BTN = "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]";
const PRIMARY = "rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]";
const riskTone = (r: string | null): "danger" | "warn" | "neutral" => (r === "critical" || r === "high" ? "danger" : r === "medium" ? "warn" : "neutral");
const taskTone = (s: string): "ok" | "brand" | "neutral" => (s === "done" ? "ok" : s === "in_progress" ? "brand" : "neutral");
const dateVal = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/** Quick status actions available for a task's current status. */
function taskActions(status: string, t: CbCase): { to: string; label: string }[] {
  switch (status) {
    case "todo": return [{ to: "in_progress", label: t.tasks.start }, { to: "done", label: t.tasks.complete }, { to: "cancelled", label: t.tasks.cancel }];
    case "in_progress": return [{ to: "done", label: t.tasks.complete }, { to: "cancelled", label: t.tasks.cancel }];
    case "done": return [{ to: "in_progress", label: t.tasks.reopen }];
    case "cancelled": return [{ to: "todo", label: t.tasks.reopen }];
    default: return [];
  }
}
type CbCase = (typeof CB_COPY)[Locale]["case"];

export function CaseManagement({ locale, incidentId, view, banner }: { locale: Locale; incidentId: string; view: CaseManagementView; banner: { ok: boolean; err: string | null } }) {
  const t = CB_COPY[locale].case;
  const rw = view.canManage;
  const hidden = <input type="hidden" name="incidentId" value={incidentId} />;

  return (
    <div id="case" className="mt-8 scroll-mt-20">
      <SectionHeader title={t.title} description={rw ? undefined : t.readOnly} />

      {banner.err ? <div className="mb-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{t.banner[banner.err as keyof typeof t.banner] ?? t.banner.error}</div>
        : banner.ok ? <div className="mb-4 rounded-lg border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-sm text-[var(--color-ok)]"><span aria-hidden="true">✓</span> {t.banner.ok}</div> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Protection plan */}
        <Card>
          <SectionHeader title={t.protection.title} action={<Badge tone={riskTone(view.protection.riskLevel)}>{view.protection.riskLevel ? t.risk[view.protection.riskLevel as keyof typeof t.risk] : t.protection.noRisk}</Badge>} />
          {rw ? (
            <form action={updateProtectionPlanAction} className="space-y-3">
              {hidden}
              <label className="block text-xs font-semibold">{t.protection.riskLevel}
                <select name="riskLevel" defaultValue={view.protection.riskLevel ?? ""} className={`${INPUT} mt-1`}>
                  <option value="">{t.protection.noRisk}</option>
                  {Object.values(CaseRiskLevel).map((r) => <option key={r} value={r}>{t.risk[r as keyof typeof t.risk]}</option>)}
                </select>
              </label>
              <label className="block text-xs font-semibold">{t.protection.status}
                <select name="protectionStatus" defaultValue={view.protection.protectionStatus} className={`${INPUT} mt-1`}>
                  {Object.values(CaseProtectionStatus).map((s) => <option key={s} value={s}>{t.protStatus[s as keyof typeof t.protStatus]}</option>)}
                </select>
              </label>
              <label className="block text-xs font-semibold">{t.protection.objective}
                <input name="objective" defaultValue={view.protection.objective ?? ""} maxLength={CASE_LIMITS.objectiveMax} className={`${INPUT} mt-1`} />
              </label>
              <label className="block text-xs font-semibold">{t.protection.notes}
                <textarea name="notes" defaultValue={view.protection.notes ?? ""} maxLength={CASE_LIMITS.notesMax} rows={3} className={`${INPUT} mt-1`} />
              </label>
              <button type="submit" className={PRIMARY}>{t.protection.save}</button>
            </form>
          ) : (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">{t.protection.status}</dt><dd>{t.protStatus[view.protection.protectionStatus as keyof typeof t.protStatus]}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">{t.protection.objective}</dt><dd className="max-w-[60%] text-right">{view.protection.objective ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">{t.protection.notes}</dt><dd className="max-w-[60%] text-right whitespace-pre-wrap">{view.protection.notes ?? "—"}</dd></div>
            </dl>
          )}
        </Card>

        {/* Follow-up */}
        <Card>
          <SectionHeader title={t.followUp.title} />
          {rw ? (
            <form action={updateFollowUpAction} className="space-y-3">
              {hidden}
              <label className="block text-xs font-semibold">{t.followUp.next}<input type="date" name="nextReviewAt" defaultValue={dateVal(view.followUp.nextReviewAt)} className={`${INPUT} mt-1`} /></label>
              <label className="block text-xs font-semibold">{t.followUp.last}<input type="date" name="lastReviewAt" defaultValue={dateVal(view.followUp.lastReviewAt)} className={`${INPUT} mt-1`} /></label>
              <label className="block text-xs font-semibold">{t.followUp.notes}<textarea name="followUpNotes" defaultValue={view.followUp.followUpNotes ?? ""} maxLength={CASE_LIMITS.followUpNotesMax} rows={2} className={`${INPUT} mt-1`} /></label>
              <button type="submit" className={PRIMARY}>{t.followUp.save}</button>
            </form>
          ) : (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">{t.followUp.next}</dt><dd>{view.followUp.nextReviewAt ? view.followUp.nextReviewAt.slice(0, 10) : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">{t.followUp.last}</dt><dd>{view.followUp.lastReviewAt ? view.followUp.lastReviewAt.slice(0, 10) : "—"}</dd></div>
            </dl>
          )}
        </Card>

        {/* Milestones */}
        <Card>
          <SectionHeader title={t.milestones.title} />
          <ul className="space-y-2">
            {Object.values(CaseMilestoneKey).map((k) => {
              const done = view.milestones[k];
              return (
                <li key={k} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2"><Badge tone={done ? "ok" : "neutral"}>{done ? "✓" : "○"}</Badge>{t.milestones.label[k as keyof typeof t.milestones.label]}</span>
                  {rw ? (
                    <form action={setMilestoneAction}>{hidden}<input type="hidden" name="milestone" value={k} /><input type="hidden" name="achieved" value={done ? "0" : "1"} /><button type="submit" className={BTN}>{done ? t.milestones.unmark : t.milestones.mark}</button></form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Tasks */}
        <Card>
          <SectionHeader title={t.tasks.title} />
          {view.tasks.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.tasks.empty}</p> : (
            <ul className="space-y-2">
              {view.tasks.map((task) => (
                <li key={task.id} className="rounded-lg border border-[var(--color-border)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-fg)]">{task.title}</p>
                      {task.description ? <p className="mt-0.5 text-xs text-[var(--color-muted)] whitespace-pre-wrap">{task.description}</p> : null}
                      <p className="mt-1 text-xs text-[var(--color-muted)]">{task.dueDate ? `${t.tasks.due}: ${task.dueDate.slice(0, 10)}` : ""}{task.assigneeUserId ? ` · ${t.tasks.assignee}: ${task.assigneeUserId}` : ""}</p>
                    </div>
                    <Badge tone={taskTone(task.status)}>{t.taskStatus[task.status as keyof typeof t.taskStatus] ?? task.status}</Badge>
                  </div>
                  {rw ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {taskActions(task.status, t).map((qa) => (
                        <form key={qa.to} action={updateCaseTaskAction}>{hidden}<input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="status" value={qa.to} /><button type="submit" className={BTN}>{qa.label}</button></form>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {rw ? (
            <form action={createCaseTaskAction} className="mt-4 space-y-2 border-t border-[var(--color-border)] pt-4">
              {hidden}
              <label className="block text-xs font-semibold">{t.tasks.titleLabel}<input name="title" required maxLength={CASE_LIMITS.taskTitleMax} className={`${INPUT} mt-1`} /></label>
              <label className="block text-xs font-semibold">{t.tasks.descLabel}<textarea name="description" maxLength={CASE_LIMITS.taskDescriptionMax} rows={2} className={`${INPUT} mt-1`} /></label>
              <div className="flex flex-wrap gap-2">
                <label className="flex-1 text-xs font-semibold">{t.tasks.due}<input type="date" name="dueDate" className={`${INPUT} mt-1`} /></label>
              </div>
              <button type="submit" className={BTN}>{t.tasks.create}</button>
            </form>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
