"use client";

import { useState } from "react";
import type { Locale } from "@/i18n";
import { Badge } from "@/components/dashboard/ui";
import { useInboxAction, ActionNotice } from "./inbox-ux";
import { INBOX_COPY } from "./inbox-i18n";
import { addLabelAction, removeLabelAction, createLabelAction, renameLabelAction, deleteLabelAction } from "./inbox-actions";

/**
 * V1.42B — inbox labels. `LabelSelector` is per-item (assign an existing label, remove one,
 * or create-and-assign a new one). `LabelManager` is rendered ONCE for the tenant (create /
 * rename / delete). All persist via the V1.42 repository (tenant-scoped, audited); deleting a
 * label never deletes the tagged items. `colorKey` is constrained server-side to an allowlist.
 */
export type LabelLite = { id: string; name: string; colorKey: string };

export function LabelSelector({
  itemId, labels, allLabels, canAct, locale,
}: { itemId: string; labels: LabelLite[]; allLabels: LabelLite[]; canAct: boolean; locale: Locale }) {
  const L = INBOX_COPY[locale];
  const { pending, msg, run } = useInboxAction(locale);
  const [creating, setCreating] = useState("");
  if (!canAct) {
    // Read-only: still show the labels, just no controls.
    return labels.length ? (
      <div className="flex flex-wrap items-center gap-1" data-inbox-labels>
        {labels.map((l) => <Badge key={l.id} tone={l.colorKey}>{l.name}</Badge>)}
      </div>
    ) : null;
  }
  const assigned = new Set(labels.map((l) => l.id));
  const available = allLabels.filter((l) => !assigned.has(l.id));
  const sel = "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs disabled:opacity-50";
  return (
    <div className="flex flex-col gap-1.5" data-inbox-labels data-testid="label-selector">
      <div className="flex flex-wrap items-center gap-1">
        {labels.map((l) => (
          <span key={l.id} className="inline-flex items-center gap-1">
            <Badge tone={l.colorKey}>{l.name}</Badge>
            <button type="button" disabled={pending} aria-label={L.removeLabel(l.name)} data-testid="label-remove"
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-danger)] disabled:opacity-50"
              onClick={() => run(() => removeLabelAction(itemId, l.id), L.okLabelRemoved)}>×</button>
          </span>
        ))}
        {labels.length === 0 ? <span className="text-xs text-[var(--color-muted)]">{L.noLabels}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {available.length ? (
          <select className={sel} disabled={pending} defaultValue="" data-testid="label-add"
            onChange={(e) => { const id = e.target.value; if (id) { run(() => addLabelAction(itemId, id), L.okLabelAdded); e.target.value = ""; } }}>
            <option value="">{L.addLabelPlaceholder}</option>
            {available.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        ) : null}
        <input value={creating} onChange={(e) => setCreating(e.target.value)} placeholder={L.newLabelPlaceholder}
          className="w-28 rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs" data-testid="label-create-input" />
        <button type="button" disabled={pending || !creating.trim()} data-testid="label-create"
          className="rounded-md border border-[var(--color-border-strong)] px-2 py-1 text-xs font-medium disabled:opacity-50"
          onClick={() => { const name = creating.trim(); if (!name) return;
            run(async () => { const r = await createLabelAction(name); if (r.ok && r.id) { setCreating(""); return addLabelAction(itemId, r.id); } return r; }, L.okLabelCreated); }}>
          {pending ? L.pending : L.create}
        </button>
      </div>
      <ActionNotice msg={msg} />
    </div>
  );
}

export function LabelManager({ allLabels, canAct, locale }: { allLabels: LabelLite[]; canAct: boolean; locale: Locale }) {
  const L = INBOX_COPY[locale];
  const { pending, msg, run } = useInboxAction(locale);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  if (!canAct) return null;
  return (
    <details className="mb-3" data-testid="label-manager">
      <summary className="cursor-pointer text-xs font-medium text-[var(--color-muted)]">{L.manageLabels(allLabels.length)}</summary>
      <div className="mt-2 flex flex-col gap-2 rounded-lg border border-[var(--color-border)] p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={L.newLabelName}
            className="w-40 rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs" />
          <button type="button" disabled={pending || !name.trim()} data-testid="label-manager-create"
            className="rounded-md border border-[var(--color-border-strong)] px-2 py-1 text-xs font-medium disabled:opacity-50"
            onClick={() => run(async () => { const r = await createLabelAction(name.trim()); if (r.ok) setName(""); return r; }, L.okLabelCreated)}>{L.create}</button>
        </div>
        <ul className="flex flex-col gap-1">
          {allLabels.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-1.5 text-xs">
              {editing === l.id ? (
                <>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)}
                    className="w-40 rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1" />
                  <button type="button" disabled={pending} className="rounded-md border px-2 py-0.5"
                    onClick={() => run(async () => { const r = await renameLabelAction(l.id, editName.trim()); if (r.ok) setEditing(null); return r; }, L.okRenamed)}>{L.save}</button>
                  <button type="button" className="text-[var(--color-muted)]" onClick={() => setEditing(null)}>{L.cancel}</button>
                </>
              ) : (
                <>
                  <Badge tone={l.colorKey}>{l.name}</Badge>
                  <button type="button" className="text-[var(--color-muted)] hover:underline" onClick={() => { setEditing(l.id); setEditName(l.name); }}>{L.rename}</button>
                  <button type="button" disabled={pending} data-testid="label-manager-delete"
                    className="text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                    onClick={() => run(() => deleteLabelAction(l.id), L.okLabelDeleted)}>{L.del}</button>
                </>
              )}
            </li>
          ))}
          {allLabels.length === 0 ? <li className="text-[var(--color-muted)]">{L.noLabelsYet}</li> : null}
        </ul>
        <ActionNotice msg={msg} />
      </div>
    </details>
  );
}
