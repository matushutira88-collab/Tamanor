import { Card, Badge, SectionHeader } from "@/components/dashboard/ui";
import type { Locale } from "@/i18n/config";
import { EscalationSeverity, EscalationReason, EscalationStatus, can, Role, Permission } from "@guardora/core";
import type { IncidentSlaView } from "@guardora/db";
import type { EscalationView } from "@guardora/db";
import { CB_COPY } from "../../cb-i18n";
import { createEscalationAction, resolveEscalationAction, cancelEscalationAction } from "./escalation-actions";

const INPUT = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)]";
const BTN = "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]";
const stateTone = (s: string): "danger" | "warn" | "ok" | "neutral" => (s === "overdue" ? "danger" : s === "due_soon" ? "warn" : s === "satisfied" || s === "on_track" ? "ok" : "neutral");

/** SLA badges never rely on colour alone — the localized state text is always shown. */
function SlaRow({ label, state, t }: { label: string; state: string; t: (typeof CB_COPY)[Locale]["sla"] }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-1.5 text-sm last:border-0">
      <span className="text-[var(--color-muted)]">{label}</span>
      <Badge tone={stateTone(state)}>{t.state[state as keyof typeof t.state] ?? state}</Badge>
    </div>
  );
}

export function CaseSlaEscalation({ locale, incidentId, role, sla, escalation, banner }: {
  locale: Locale; incidentId: string; role: string;
  sla: IncidentSlaView; escalation: EscalationView | null; banner: { ok: boolean; err: string | null };
}) {
  const t = CB_COPY[locale];
  const s = t.sla; const e = t.esc;
  const canManage = can(role as Role, Permission.CyberbullyingEscalate);
  const hidden = <input type="hidden" name="incidentId" value={incidentId} />;

  return (
    <div id="sla" className="mt-8 scroll-mt-20">
      <SectionHeader title={s.title} />
      {banner.err ? <div role="alert" className="mb-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{e.banner[banner.err as keyof typeof e.banner] ?? e.banner.error}</div>
        : banner.ok ? <div role="status" aria-live="polite" className="mb-4 rounded-lg border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-sm text-[var(--color-ok)]"><span aria-hidden="true">✓</span> {e.banner.ok}</div> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* SLA */}
        <Card>
          <SectionHeader title={s.overviewTitle} />
          <SlaRow label={s.firstReview} state={sla.firstReview} t={s} />
          <SlaRow label={s.criticalRisk} state={sla.criticalRisk} t={s} />
          <SlaRow label={s.followUp} state={sla.followUp} t={s} />
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-1.5 text-sm last:border-0">
            <span className="text-[var(--color-muted)]">{s.tasks}</span>
            <span className="flex gap-1"><Badge tone={sla.taskOverdue ? "danger" : "neutral"}>{s.state.overdue}: {sla.taskOverdue}</Badge><Badge tone={sla.taskDueSoon ? "warn" : "neutral"}>{s.state.due_soon}: {sla.taskDueSoon}</Badge></span>
          </div>
          <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="text-[var(--color-muted)]">{s.nextDeadline}</span>
            <span className="text-[var(--color-fg)]">{sla.nextReviewAt ? sla.nextReviewAt.slice(0, 10) : (sla.nearestTaskDue ? sla.nearestTaskDue.slice(0, 10) : s.none)}</span>
          </div>
        </Card>

        {/* Escalation */}
        <Card>
          <SectionHeader title={e.title} />
          {escalation ? (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={escalation.severity === "urgent" ? "danger" : "warn"}>{e.severityLabel[escalation.severity as keyof typeof e.severityLabel] ?? escalation.severity}</Badge>
                <Badge tone="brand">{e.statusLabel[escalation.status as keyof typeof e.statusLabel] ?? escalation.status}</Badge>
                <span className="text-[var(--color-fg)]">{e.reasonLabel[escalation.reasonCode as keyof typeof e.reasonLabel] ?? escalation.reasonCode}</span>
              </div>
              <p className="text-xs text-[var(--color-muted)]">{e.escalatedBy}: {escalation.escalatedByUserId} · {new Date(escalation.escalatedAt).toISOString().slice(0, 16).replace("T", " ")}</p>
              {escalation.targetUserId ? <p className="text-xs text-[var(--color-muted)]">{e.target}: {escalation.targetUserId}</p> : null}
              {escalation.status === EscalationStatus.Active ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <form action={resolveEscalationAction}>{hidden}<input type="hidden" name="escalationId" value={escalation.id} /><button type="submit" className={BTN}>{e.resolve}</button></form>
                  {canManage ? <form action={cancelEscalationAction}>{hidden}<input type="hidden" name="escalationId" value={escalation.id} /><button type="submit" className={BTN}>{e.cancel}</button></form> : null}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-[var(--color-muted)]">{e.none}</p>
              <form action={createEscalationAction} className="space-y-3">
                {hidden}
                <label className="block text-xs font-semibold">{e.severity}
                  <select name="severity" defaultValue={EscalationSeverity.Attention} className={`${INPUT} mt-1`}>
                    {Object.values(EscalationSeverity).map((v) => <option key={v} value={v}>{e.severityLabel[v as keyof typeof e.severityLabel]}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold">{e.reason}
                  <select name="reasonCode" defaultValue={EscalationReason.SafetyConcern} className={`${INPUT} mt-1`}>
                    {Object.values(EscalationReason).map((v) => <option key={v} value={v}>{e.reasonLabel[v as keyof typeof e.reasonLabel]}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold">{e.note}
                  <textarea name="note" rows={2} className={`${INPUT} mt-1`} aria-describedby="esc-note-hint" />
                  <span id="esc-note-hint" className="text-[10px] font-normal text-[var(--color-muted)]">{e.noteRequired}</span>
                </label>
                <button type="submit" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{e.submit}</button>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
