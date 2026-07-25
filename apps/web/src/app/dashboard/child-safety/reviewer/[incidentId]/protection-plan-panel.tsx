"use client";

import { useActionState, useState } from "react";
import type { ReviewerCopy } from "../reviewer-i18n";
import { isReviewActionErrorCode } from "../reviewer-i18n";
import { planStatusTone, actionStatusTone, priorityTone, availablePlanTargets, availableActionTargets, resolveActionTitle, fmtDateTime, shortId } from "../reviewer-view";
import { ChildSafetyProtectionPlanStatus, ChildSafetyProtectionActionStatus, ACTIVE_PLAN_STATUSES } from "@guardora/core";
import {
  createPlanAction, activatePlanAction, completePlanAction, cancelPlanAction, reopenPlanAction, addActionAction, actionOpAction,
  type PlanActionState,
} from "./protection-plan-actions";

export interface PlanAction { id: string; actionType: string; title: string; description: string | null; priority: string; status: string; assignedReviewerId: string | null; dueAt: string | null; completedAt: string | null; completionNote: string | null; blockReason: string | null; sequence: number; }
export interface PlanData {
  plan: { id: string; status: string; priority: string; createdAt: string; activatedAt: string | null; completedAt: string | null; closedReason: string | null } | null;
  actions?: PlanAction[];
  progress?: { total: number; completed: number; skipped: number; blocked: number; overdue: number; completionPct: number };
  timeline?: Array<{ id: string; eventType: string; actorUserId: string | null; at: string }>;
  recommendation?: { priority: string; actions: Array<{ type: string; priority: string; reasonCode: string }>; explanationCodes: string[] };
}

const INITIAL: PlanActionState = { ok: true };
const badge = (tone: string) => `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-current/15 bg-[var(--color-${tone}-soft)] text-[var(--color-${tone})]`;
const btn = "rounded-md border border-[var(--color-border)] px-2 py-1 text-xs font-medium text-[var(--color-fg)] hover:border-[var(--color-border-strong)] disabled:opacity-50";
const primary = "rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50";

function ErrBar({ code, t }: { code: string | null; t: ReviewerCopy }) {
  if (!code || !isReviewActionErrorCode(code)) return null;
  return <div role="alert" className="mt-2 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{t.errors[code] ?? t.errors.retry_later}</div>;
}

/** A hidden-field form bound to a server action, rendered as a single button. */
function OpButton({ action, hidden, label, className, danger }: { action: (p: PlanActionState, fd: FormData) => Promise<PlanActionState>; hidden: Record<string, string>; label: string; className?: string; danger?: boolean }) {
  const [state, run, pending] = useActionState(action, INITIAL);
  return (
    <form action={run} className="inline">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" disabled={pending} className={className ?? `${btn}${danger ? " text-[var(--color-danger)]" : ""}`}>{label}</button>
      {state.ok === false ? <span className="ml-1 text-xs text-[var(--color-danger)]" role="alert">·</span> : null}
    </form>
  );
}

/**
 * Protection Plan tab. Four states: no plan (recommendation preview + create), draft (add actions +
 * activate), active/reopened (progress + action checklist + status controls + timeline + complete/cancel),
 * and terminal (read-only + reopen). Manager-gated; no window.confirm (terminal plan ops use a dialog).
 */
export function ProtectionPlanPanel({ incidentId, data, canManage, t }: { incidentId: string; data: PlanData; canManage: boolean; t: ReviewerCopy }) {
  const pp = t.pp;
  const plan = data.plan;

  if (!plan) {
    const rec = data.recommendation;
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--color-muted)]">{pp.noPlan}</p>
        {rec ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-[var(--color-fg)]">{pp.recommendation}</span><span className={badge(priorityTone(rec.priority))}>{pp.priority[rec.priority]}</span></div>
            <ul className="space-y-1">
              {rec.actions.map((a, i) => <li key={i} className="flex items-center gap-2 text-sm"><span className={badge(priorityTone(a.priority))}>{pp.priority[a.priority]}</span>{pp.actionType[a.type]?.title ?? a.type}</li>)}
            </ul>
            {rec.explanationCodes.length ? <div className="mt-2 flex flex-wrap gap-1">{rec.explanationCodes.map((c) => <span key={c} className="text-[11px] text-[var(--color-muted)]">· {pp.explain[c] ?? c}</span>)}</div> : null}
            {canManage ? (
              <div className="mt-3 flex gap-2">
                <OpButton action={createPlanAction} hidden={{ incidentId, fromRecommendation: "1" }} label={pp.createFromRec} className={primary} />
                <OpButton action={createPlanAction} hidden={{ incidentId, fromRecommendation: "0" }} label={pp.createBlank} />
              </div>
            ) : <p className="mt-3 text-xs text-[var(--color-muted)]">{pp.readOnly}</p>}
          </div>
        ) : null}
      </div>
    );
  }

  const isEditable = (ACTIVE_PLAN_STATUSES as string[]).includes(plan.status);
  const isTerminal = plan.status === "completed" || plan.status === "cancelled";
  const planTargets = availablePlanTargets(plan.status);
  const progress = data.progress;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={badge(planStatusTone(plan.status))}>{pp.planStatus[plan.status] ?? plan.status}</span>
        <span className={badge(priorityTone(plan.priority))}>{pp.priority[plan.priority] ?? plan.priority}</span>
        {progress ? <span className="text-sm text-[var(--color-muted)]">{progress.completionPct}% {pp.completedPct} · {progress.overdue} {pp.overdue} · {progress.blocked} {pp.blockedLabel}</span> : null}
        {!canManage ? <span className="ml-auto text-xs text-[var(--color-muted)]">{pp.readOnly}</span> : null}
      </div>

      {/* Progress bar */}
      {progress ? (
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-neutral-soft)]" role="progressbar" aria-valuenow={progress.completionPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-[var(--color-ok)]" style={{ width: `${progress.completionPct}%` }} />
        </div>
      ) : null}

      {/* Plan-level manager controls */}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {planTargets.includes(ChildSafetyProtectionPlanStatus.Active) ? <OpButton action={activatePlanAction} hidden={{ incidentId, planId: plan.id }} label={pp.activate} className={primary} /> : null}
          {planTargets.includes(ChildSafetyProtectionPlanStatus.Completed) ? <TerminalPlanOp action={completePlanAction} incidentId={incidentId} planId={plan.id} label={pp.complete} body={pp.complete} t={t} /> : null}
          {planTargets.includes(ChildSafetyProtectionPlanStatus.Cancelled) ? <TerminalPlanOp action={cancelPlanAction} incidentId={incidentId} planId={plan.id} label={pp.cancel} body={pp.cancel} t={t} danger /> : null}
          {planTargets.includes(ChildSafetyProtectionPlanStatus.Reopened) ? <TerminalPlanOp action={reopenPlanAction} incidentId={incidentId} planId={plan.id} label={pp.reopen} body={pp.reopen} t={t} /> : null}
        </div>
      ) : null}

      {/* Actions checklist */}
      {(data.actions ?? []).length === 0 ? <p className="text-sm text-[var(--color-muted)]">{pp.empty}</p> : (
        <ul className="space-y-2">
          {(data.actions ?? []).map((a) => <ActionRow key={a.id} incidentId={incidentId} action={a} canManage={canManage && !isTerminal} t={t} />)}
        </ul>
      )}

      {/* Add custom action (editable plans) */}
      {canManage && isEditable ? <AddActionForm incidentId={incidentId} planId={plan.id} t={t} /> : null}

      {/* Timeline */}
      {data.timeline && data.timeline.length ? (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">{pp.timeline}</p>
          <ol className="space-y-1 text-xs">
            {data.timeline.map((e) => <li key={e.id} className="flex items-center gap-2"><span className="font-semibold">{pp.event[e.eventType] ?? e.eventType}</span><span className="text-[var(--color-muted)]">{fmtDateTime(e.at)}</span>{e.actorUserId ? <span className="font-mono text-[var(--color-muted)]">{shortId(e.actorUserId)}</span> : null}</li>)}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function ActionRow({ incidentId, action: a, canManage, t }: { incidentId: string; action: PlanAction; canManage: boolean; t: ReviewerCopy }) {
  const pp = t.pp;
  const targets = availableActionTargets(a.status);
  const title = resolveActionTitle(a.title, a.actionType, pp.actionType);
  return (
    <li className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums text-xs text-[var(--color-muted)]">{a.sequence}.</span>
        <span className="text-sm font-medium text-[var(--color-fg)]">{title}</span>
        <span className={badge(actionStatusTone(a.status))}>{pp.actionStatus[a.status] ?? a.status}</span>
        <span className={badge(priorityTone(a.priority))}>{pp.priority[a.priority] ?? a.priority}</span>
        {a.dueAt ? <span className="text-xs text-[var(--color-muted)]">{pp.due}: {fmtDateTime(a.dueAt)}</span> : null}
        {a.assignedReviewerId ? <span className="font-mono text-xs text-[var(--color-muted)]">{shortId(a.assignedReviewerId)}</span> : null}
      </div>
      {a.blockReason ? <p className="mt-1 text-xs text-[var(--color-danger)]">{pp.blockReason}: {a.blockReason}</p> : null}
      {a.completionNote ? <p className="mt-1 text-xs text-[var(--color-muted)]">{pp.completionNote}: {a.completionNote}</p> : null}
      {canManage ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {targets.includes(ChildSafetyProtectionActionStatus.InProgress) ? <OpButton action={actionOpAction} hidden={{ incidentId, actionId: a.id, op: "start" }} label={pp.start} /> : null}
          {targets.includes(ChildSafetyProtectionActionStatus.Blocked) ? <NoteOp op="block" incidentId={incidentId} actionId={a.id} label={pp.block} field="reason" placeholder={pp.reasonPlaceholder} t={t} /> : null}
          {targets.includes(ChildSafetyProtectionActionStatus.Completed) ? <NoteOp op="complete" incidentId={incidentId} actionId={a.id} label={pp.actionStatus.completed ?? "complete"} field="note" placeholder={pp.notePlaceholder} t={t} /> : null}
          {targets.includes(ChildSafetyProtectionActionStatus.Skipped) ? <OpButton action={actionOpAction} hidden={{ incidentId, actionId: a.id, op: "skip" }} label={pp.skip} /> : null}
          {targets.includes(ChildSafetyProtectionActionStatus.Reopened) ? <OpButton action={actionOpAction} hidden={{ incidentId, actionId: a.id, op: "reopen" }} label={pp.reopenAction} /> : null}
          <AssignOp incidentId={incidentId} actionId={a.id} assigned={a.assignedReviewerId} t={t} />
        </div>
      ) : null}
    </li>
  );
}

function OpButton2({ hidden, label, danger }: { hidden: Record<string, string>; label: string; danger?: boolean }) {
  return <OpButton action={actionOpAction} hidden={hidden} label={label} danger={danger} />;
}
function AssignOp({ incidentId, actionId, assigned, t }: { incidentId: string; actionId: string; assigned: string | null; t: ReviewerCopy }) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState(actionOpAction, INITIAL);
  if (assigned) return <OpButton2 hidden={{ incidentId, actionId, op: "unassign" }} label={t.pp.unassign} />;
  return (
    <>
      <button type="button" className={btn} onClick={() => setOpen((v) => !v)}>{t.pp.assign}</button>
      {open ? (
        <form action={run} className="inline-flex items-center gap-1">
          <input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="actionId" value={actionId} /><input type="hidden" name="op" value="assign" />
          <input name="assigneeUserId" required placeholder={t.pp.assigneePlaceholder} aria-label={t.pp.assign} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs" />
          <button type="submit" disabled={pending} className={btn}>{pending ? t.pp.working : t.pp.save}</button>
          {state.ok === false ? <ErrBar code={state.error} t={t} /> : null}
        </form>
      ) : null}
    </>
  );
}

/** An action op that collects an optional protected note/reason before submitting. */
function NoteOp({ op, incidentId, actionId, label, field, placeholder, t }: { op: string; incidentId: string; actionId: string; label: string; field: "note" | "reason"; placeholder: string; t: ReviewerCopy }) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState(actionOpAction, INITIAL);
  if (!open) return <button type="button" className={btn} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form action={run} className="inline-flex items-center gap-1">
      <input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="actionId" value={actionId} /><input type="hidden" name="op" value={op} />
      <input name={field} placeholder={placeholder} aria-label={label} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs" />
      <button type="submit" disabled={pending} className={btn}>{pending ? t.pp.working : label}</button>
      <button type="button" onClick={() => setOpen(false)} className={btn}>{t.pp.cancelBtn}</button>
      {state.ok === false ? <ErrBar code={state.error} t={t} /> : null}
    </form>
  );
}

function AddActionForm({ incidentId, planId, t }: { incidentId: string; planId: string; t: ReviewerCopy }) {
  const pp = t.pp;
  const [state, run, pending] = useActionState(addActionAction, INITIAL);
  return (
    <form action={run} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="planId" value={planId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{pp.customTitle}<input name="title" required placeholder={pp.customTitle} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-fg)]" /></label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{pp.priority.normal}
          <select name="priority" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-fg)]" defaultValue="normal">
            {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{pp.priority[p]}</option>)}
          </select>
        </label>
        <button type="submit" disabled={pending} className={primary}>{pending ? pp.working : pp.addAction}</button>
      </div>
      {state.ok === false ? <ErrBar code={state.error} t={t} /> : null}
    </form>
  );
}

/** A terminal plan op behind an accessible confirm dialog (no window.confirm). */
function TerminalPlanOp({ action, incidentId, planId, label, body, t, danger }: { action: (p: PlanActionState, fd: FormData) => Promise<PlanActionState>; incidentId: string; planId: string; label: string; body: string; t: ReviewerCopy; danger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState(action, INITIAL);
  return (
    <>
      <button type="button" className={`${btn}${danger ? " text-[var(--color-danger)]" : ""}`} onClick={() => setOpen(true)}>{label}</button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === "Escape" && !pending) setOpen(false); }}>
          <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => !pending && setOpen(false)} className="absolute inset-0 cursor-default bg-black/40" />
          <div role="dialog" aria-modal="true" aria-label={label} className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
            <h2 className="text-base font-semibold text-[var(--color-fg)]">{label}</h2>
            <p className="mt-2 text-sm text-[var(--color-muted)]">{body}</p>
            <ErrBar code={state.ok ? null : state.error} t={t} />
            <form action={run} className="mt-4 flex justify-end gap-3">
              <input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="planId" value={planId} />
              <button type="button" onClick={() => setOpen(false)} disabled={pending} className={btn}>{t.pp.cancelBtn}</button>
              <button type="submit" disabled={pending} className={danger ? "rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" : primary}>{pending ? t.pp.working : t.pp.confirm}</button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
