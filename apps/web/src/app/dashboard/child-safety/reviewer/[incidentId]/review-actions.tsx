"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { ChildSafetyReviewStatus } from "@guardora/core/child-safety-review";
import { isReviewActionErrorCode } from "../reviewer-i18n";
import { assignAction, assignToMeAction, unassignAction, statusAction, type ReviewActionState } from "./actions";

/** Serializable copy for the interactive review controls (strings only — no functions cross the boundary). */
export interface ActionsUi {
  assign: string; assignToMe: string; reassign: string; unassign: string; changeStatus: string;
  confirm: string; cancel: string; working: string; assigneePlaceholder: string; assignTitle: string;
  assignBody: string; statusConfirmBody: string; errorTitle: string;
}

const INITIAL: ReviewActionState = { ok: true };

/** Accessible modal (role=dialog, aria-modal, focus-trapped, Esc/backdrop cancel). No window.confirm. */
function Modal({ open, onClose, title, body, children, pending }: { open: boolean; onClose: () => void; title: string; body: string; children: React.ReactNode; pending: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId(); const bodyId = useId();
  const close = () => { if (!pending) onClose(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const f = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,[href]');
    if (!f || f.length === 0) return;
    const first = f[0]!, last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={onKeyDown}>
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={close} className="absolute inset-0 cursor-default bg-black/40" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
        <h2 id={titleId} className="text-base font-semibold text-[var(--color-fg)]">{title}</h2>
        <p id={bodyId} className="mt-2 text-sm text-[var(--color-muted)]">{body}</p>
        {children}
      </div>
    </div>
  );
}

function ErrorAlert({ code, errors, title }: { code: string | null; errors: Record<string, string>; title: string }) {
  if (!code || !isReviewActionErrorCode(code)) return null;
  return <div role="alert" className="mt-3 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"><span className="font-medium">{title}:</span> {errors[code] ?? errors.retry_later}</div>;
}

const btn = "rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-fg)] disabled:opacity-50";
const primary = "rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";
const danger = "rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";

export function ReviewActions(props: {
  incidentId: string; assignedReviewerId: string | null; targets: ChildSafetyReviewStatus[];
  ui: ActionsUi; statusTarget: Record<string, string>; errors: Record<string, string>;
  terminalTargets: readonly string[];
}) {
  const { incidentId, assignedReviewerId, targets, ui, statusTarget, errors, terminalTargets } = props;
  const [assignOpen, setAssignOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<ChildSafetyReviewStatus | null>(null);

  const [assignState, assign, assignPending] = useActionState(assignAction, INITIAL);
  const [, assignMe, assignMePending] = useActionState(assignToMeAction, INITIAL);
  const [, unassign, unassignPending] = useActionState(unassignAction, INITIAL);
  const [statusState, doStatus, statusPending] = useActionState(statusAction, INITIAL);

  useEffect(() => { if (assignState.ok && assignOpen) setAssignOpen(false); }, [assignState, assignOpen]);
  useEffect(() => { if (statusState.ok && confirmTarget) setConfirmTarget(null); }, [statusState, confirmTarget]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={assignMe}><input type="hidden" name="incidentId" value={incidentId} /><button type="submit" disabled={assignMePending} className={btn}>{ui.assignToMe}</button></form>
      <button type="button" onClick={() => setAssignOpen(true)} className={btn}>{assignedReviewerId ? ui.reassign : ui.assign}</button>
      {assignedReviewerId ? <form action={unassign}><input type="hidden" name="incidentId" value={incidentId} /><button type="submit" disabled={unassignPending} className={btn}>{ui.unassign}</button></form> : null}

      <span className="mx-1 h-5 w-px bg-[var(--color-border)]" aria-hidden="true" />

      {targets.map((to) => {
        const isTerminal = terminalTargets.includes(to);
        if (isTerminal) return <button key={to} type="button" onClick={() => setConfirmTarget(to)} className={btn}>{statusTarget[to] ?? to}</button>;
        return <form key={to} action={doStatus}><input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="status" value={to} /><button type="submit" disabled={statusPending} className={btn}>{statusTarget[to] ?? to}</button></form>;
      })}

      {/* Assign dialog */}
      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title={ui.assignTitle} body={ui.assignBody} pending={assignPending}>
        <form action={assign} className="mt-4">
          <input type="hidden" name="incidentId" value={incidentId} />
          <input name="assigneeUserId" required placeholder={ui.assigneePlaceholder} aria-label={ui.assigneePlaceholder} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)]" />
          <ErrorAlert code={assignState.ok ? null : assignState.error} errors={errors} title={ui.errorTitle} />
          <div className="mt-4 flex justify-end gap-3">
            <button type="button" onClick={() => setAssignOpen(false)} disabled={assignPending} className={btn}>{ui.cancel}</button>
            <button type="submit" disabled={assignPending} className={primary}>{assignPending ? ui.working : ui.confirm}</button>
          </div>
        </form>
      </Modal>

      {/* Terminal status confirm dialog */}
      <Modal open={confirmTarget !== null} onClose={() => setConfirmTarget(null)} title={confirmTarget ? (statusTarget[confirmTarget] ?? confirmTarget) : ""} body={ui.statusConfirmBody} pending={statusPending}>
        <form action={doStatus} className="mt-4">
          <input type="hidden" name="incidentId" value={incidentId} />
          <input type="hidden" name="status" value={confirmTarget ?? ""} />
          <ErrorAlert code={statusState.ok ? null : statusState.error} errors={errors} title={ui.errorTitle} />
          <div className="mt-4 flex justify-end gap-3">
            <button type="button" onClick={() => setConfirmTarget(null)} disabled={statusPending} className={btn}>{ui.cancel}</button>
            <button type="submit" disabled={statusPending} className={danger}>{statusPending ? ui.working : ui.confirm}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
