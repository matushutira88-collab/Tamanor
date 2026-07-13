"use client";

import { useTransition } from "react";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { markReadFormAction, archiveFormAction, setPriorityAction, setWorkflowStatusAction } from "./inbox-actions";

/**
 * V1.42B — inbox item internal controls. Read/archive use server-action FORMS (Next's built-in
 * progressive-enhancement path → reliable persist + revalidate + double-submit-safe SubmitButton).
 * Priority/workflow use client selects. All call the V1.42 server actions, which persist to DB,
 * are permission-gated + audited. Viewers (no InboxAct) see NO controls — the server also rejects
 * them, so this is defense in depth, not the only gate.
 */
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const STATUSES = ["new", "in_review", "action_required", "resolved"] as const;

export function InboxControls({
  id, isRead, archived, priority, workflowStatus, canAct,
}: {
  id: string; isRead: boolean; archived: boolean; priority: string; workflowStatus: string; canAct: boolean;
}) {
  // Independent transitions so changing priority never blocks the workflow control (and vice versa).
  const [prioPending, startPrio] = useTransition();
  const [wfPending, startWf] = useTransition();
  if (!canAct) return null;
  const sel = "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-inbox-controls>
      <form action={markReadFormAction.bind(null, id, !isRead)}>
        <SubmitButton pendingLabel="…" variant="secondary">{isRead ? "Mark unread" : "Mark read"}</SubmitButton>
      </form>
      <form action={archiveFormAction.bind(null, id, !archived)}>
        <SubmitButton pendingLabel="…" variant="secondary">{archived ? "Unarchive" : "Archive in Tamanor"}</SubmitButton>
      </form>
      <label className="sr-only" htmlFor={`prio-${id}`}>Priority</label>
      <select id={`prio-${id}`} disabled={prioPending} defaultValue={priority} className={sel} data-testid="priority-select"
        onChange={(e) => { const v = e.target.value as (typeof PRIORITIES)[number]; startPrio(async () => { await setPriorityAction(id, v); }); }}>
        {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <label className="sr-only" htmlFor={`wf-${id}`}>Workflow status</label>
      <select id={`wf-${id}`} disabled={wfPending} defaultValue={workflowStatus} className={sel} data-testid="status-select"
        onChange={(e) => { const v = e.target.value as (typeof STATUSES)[number]; startWf(async () => { await setWorkflowStatusAction(id, v); }); }}>
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}
