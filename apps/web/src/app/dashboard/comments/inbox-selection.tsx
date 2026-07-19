"use client";

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import type { Locale } from "@/i18n";
import type { LabelLite } from "./label-editor";
import type { MemberLite } from "./assignee-editor";
import { reasonText } from "./inbox-ux";
import { INBOX_COPY, PRIORITY_LABEL, STATUS_LABEL, somethingWrong } from "./inbox-i18n";
import { bulkAction } from "./inbox-actions";

/**
 * V1.42B — bulk selection. A client context spans the server-rendered card list: each card
 * carries a <SelectCheckbox/>, a <SelectAllCheckbox/> toggles the visible page, and the
 * <BulkActionBar/> runs INTERNAL-only actions (mark read/unread, archive/unarchive, priority,
 * workflow, assign/unassign, add/remove label). Provider WRITE actions (hide/reply/delete/ban)
 * are never offered here AND are rejected by the server allowlist. Max batch is 200 (server).
 */
type Ctx = { selected: Set<string>; toggle: (id: string) => void; clear: () => void; setAll: (ids: string[], on: boolean) => void };
const SelectionCtx = createContext<Ctx | null>(null);
function useSelection(): Ctx {
  const c = useContext(SelectionCtx);
  if (!c) throw new Error("useSelection outside SelectionProvider");
  return c;
}

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ctx = useMemo<Ctx>(() => ({
    selected,
    toggle: (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    clear: () => setSelected(new Set()),
    setAll: (ids, on) => setSelected((prev) => { const n = new Set(prev); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; }),
  }), [selected]);
  return <SelectionCtx.Provider value={ctx}>{children}</SelectionCtx.Provider>;
}

export function SelectCheckbox({ id, locale }: { id: string; locale: Locale }) {
  const { selected, toggle } = useSelection();
  return (
    <input type="checkbox" aria-label={INBOX_COPY[locale].selectItem} data-testid="select-item" data-select-id={id}
      checked={selected.has(id)} onChange={() => toggle(id)}
      className="h-4 w-4 shrink-0 rounded border-[var(--color-border-strong)]" onClick={(e) => e.stopPropagation()} />
  );
}

export function SelectAllCheckbox({ ids, locale }: { ids: string[]; locale: Locale }) {
  const { selected, setAll } = useSelection();
  const allOn = ids.length > 0 && ids.every((i) => selected.has(i));
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
      <input type="checkbox" data-testid="select-all" checked={allOn} onChange={(e) => setAll(ids, e.target.checked)}
        className="h-4 w-4 rounded border-[var(--color-border-strong)]" />
      {INBOX_COPY[locale].selectPage}
    </label>
  );
}

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const STATUSES = ["new", "in_review", "action_required", "resolved"] as const;

export function BulkActionBar({ members, allLabels, locale }: { members: MemberLite[]; allLabels: LabelLite[]; locale: Locale }) {
  const L = INBOX_COPY[locale];
  const { selected, clear } = useSelection();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const ids = [...selected];
  if (ids.length === 0) return null;

  function runBulk(kind: string, opts: Parameters<typeof bulkAction>[2] = {}) {
    setMsg(null);
    start(async () => {
      try {
        const r = await bulkAction(ids, kind, opts);
        if (r.ok) { setMsg({ kind: "ok", text: L.updatedOf(r.affected ?? 0, ids.length) }); clear(); }
        else setMsg({ kind: "error", text: reasonText(r.reason, locale) });
      } catch { setMsg({ kind: "error", text: somethingWrong(Math.random().toString(36).slice(2, 8), locale) }); }
    });
  }
  const btn = "rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-xs font-medium disabled:opacity-50";
  const sel = "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs disabled:opacity-50";

  return (
    <div data-testid="bulk-bar" data-selected-count={ids.length}
      className="sticky bottom-3 z-20 mt-3 flex flex-col gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold" data-testid="bulk-count">{L.selectedCount(ids.length)}</span>
        <button type="button" className={btn} disabled={pending} data-testid="bulk-clear" onClick={() => { clear(); setMsg(null); }}>{L.clear}</button>
        <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
        <button type="button" className={btn} disabled={pending} data-testid="bulk-mark-read" onClick={() => runBulk("mark_read")}>{L.markRead}</button>
        <button type="button" className={btn} disabled={pending} data-testid="bulk-mark-unread" onClick={() => runBulk("mark_unread")}>{L.markUnread}</button>
        <button type="button" className={btn} disabled={pending} data-testid="bulk-archive" onClick={() => runBulk("archive")}>{L.archive}</button>
        <button type="button" className={btn} disabled={pending} data-testid="bulk-unarchive" onClick={() => runBulk("unarchive")}>{L.unarchive}</button>
        <button type="button" className={btn} disabled={pending} data-testid="bulk-unassign" onClick={() => runBulk("unassign")}>{L.unassign}</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={sel} disabled={pending} defaultValue="" data-testid="bulk-priority"
          onChange={(e) => { const v = e.target.value; if (v) { runBulk("set_priority", { priority: v as (typeof PRIORITIES)[number] }); e.target.value = ""; } }}>
          <option value="">{L.setPriority}</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[locale][p]}</option>)}
        </select>
        <select className={sel} disabled={pending} defaultValue="" data-testid="bulk-status"
          onChange={(e) => { const v = e.target.value; if (v) { runBulk("set_workflow_status", { status: v as (typeof STATUSES)[number] }); e.target.value = ""; } }}>
          <option value="">{L.setStatus}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[locale][s]}</option>)}
        </select>
        <select className={sel} disabled={pending} defaultValue="" data-testid="bulk-assign"
          onChange={(e) => { const v = e.target.value; if (v) { runBulk("assign", { assigneeUserId: v }); e.target.value = ""; } }}>
          <option value="">{L.assignTo}</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name ?? m.email}</option>)}
        </select>
        <select className={sel} disabled={pending} defaultValue="" data-testid="bulk-add-label"
          onChange={(e) => { const v = e.target.value; if (v) { runBulk("add_label", { labelId: v }); e.target.value = ""; } }}>
          <option value="">{L.bulkAddLabel}</option>
          {allLabels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select className={sel} disabled={pending} defaultValue="" data-testid="bulk-remove-label"
          onChange={(e) => { const v = e.target.value; if (v) { runBulk("remove_label", { labelId: v }); e.target.value = ""; } }}>
          <option value="">{L.bulkRemoveLabel}</option>
          {allLabels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      {msg ? <p role="status" data-inbox-msg={msg.kind} className={`text-xs ${msg.kind === "ok" ? "text-[var(--color-ok)]" : "text-[var(--color-danger)]"}`}>{msg.text}</p> : null}
    </div>
  );
}
