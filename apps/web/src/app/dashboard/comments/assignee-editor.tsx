"use client";

import { useInboxAction, ActionNotice } from "./inbox-ux";
import { assignAction } from "./inbox-actions";

/**
 * V1.42B — inbox assignment. Only ACTIVE members of THIS tenant are offered (the server also
 * re-checks membership, so a removed/foreign user is rejected even via a hand-built request).
 * A deleted assignee is rendered safely as "Unassigned". Viewers get no controls.
 */
export type MemberLite = { id: string; name: string | null; email: string };

export function AssigneeSelector({
  itemId, assigneeId, members, selfId, canAct,
}: { itemId: string; assigneeId: string | null; members: MemberLite[]; selfId: string; canAct: boolean }) {
  const { pending, msg, run } = useInboxAction();
  const current = members.find((m) => m.id === assigneeId) ?? null;
  const label = (m: MemberLite) => m.name ?? m.email;
  if (!canAct) {
    return <p className="text-xs text-[var(--color-muted)]" data-inbox-assignee>{current ? `Assigned to ${label(current)}` : "Unassigned"}</p>;
  }
  const sel = "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs disabled:opacity-50";
  return (
    <div className="flex flex-col gap-1.5" data-inbox-assignee data-testid="assignee-selector">
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="sr-only" htmlFor={`asg-${itemId}`}>Assignee</label>
        <select id={`asg-${itemId}`} className={sel} disabled={pending} value={assigneeId ?? ""} data-testid="assignee-select"
          onChange={(e) => { const v = e.target.value || null; run(() => assignAction(itemId, v), v ? "Assigned" : "Unassigned"); }}>
          <option value="">Unassigned</option>
          {members.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}
        </select>
        {assigneeId !== selfId ? (
          <button type="button" disabled={pending} data-testid="assign-self"
            className="rounded-md border border-[var(--color-border-strong)] px-2 py-1 text-xs font-medium disabled:opacity-50"
            onClick={() => run(() => assignAction(itemId, selfId), "Assigned to you")}>Assign to me</button>
        ) : null}
        {assigneeId ? (
          <button type="button" disabled={pending} data-testid="assign-clear"
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs font-medium disabled:opacity-50"
            onClick={() => run(() => assignAction(itemId, null), "Unassigned")}>Unassign</button>
        ) : null}
      </div>
      <ActionNotice msg={msg} />
    </div>
  );
}
