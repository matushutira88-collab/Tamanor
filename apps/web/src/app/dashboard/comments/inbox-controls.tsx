"use client";

import { useTransition } from "react";
import type { Locale } from "@/i18n";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { INBOX_COPY, PRIORITY_LABEL, STATUS_LABEL } from "./inbox-i18n";
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
  id, isRead, archived, priority, workflowStatus, canAct, locale,
}: {
  id: string; isRead: boolean; archived: boolean; priority: string; workflowStatus: string; canAct: boolean; locale: Locale;
}) {
  // Independent transitions so changing priority never blocks the workflow control (and vice versa).
  const [prioPending, startPrio] = useTransition();
  const [wfPending, startWf] = useTransition();
  if (!canAct) return null;
  const L = INBOX_COPY[locale];
  const sel = "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-inbox-controls>
      <form action={markReadFormAction.bind(null, id, !isRead)}>
        <SubmitButton pendingLabel={L.pending} variant="secondary">{isRead ? L.markUnread : L.markRead}</SubmitButton>
      </form>
      <form action={archiveFormAction.bind(null, id, !archived)}>
        <SubmitButton pendingLabel={L.pending} variant="secondary">{archived ? L.unarchive : L.archive}</SubmitButton>
      </form>
      <label className="sr-only" htmlFor={`prio-${id}`}>{L.priority}</label>
      <select id={`prio-${id}`} disabled={prioPending} defaultValue={priority} className={sel} data-testid="priority-select"
        onChange={(e) => { const v = e.target.value as (typeof PRIORITIES)[number]; startPrio(async () => { await setPriorityAction(id, v); }); }}>
        {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[locale][p]}</option>)}
      </select>
      <label className="sr-only" htmlFor={`wf-${id}`}>{L.workflowStatus}</label>
      <select id={`wf-${id}`} disabled={wfPending} defaultValue={workflowStatus} className={sel} data-testid="status-select"
        onChange={(e) => { const v = e.target.value as (typeof STATUSES)[number]; startWf(async () => { await setWorkflowStatusAction(id, v); }); }}>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[locale][s]}</option>)}
      </select>
    </div>
  );
}
