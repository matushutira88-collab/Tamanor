"use client";

import { useMemo, useState, type ReactNode } from "react";

/**
 * BUSINESS-CRM-V2 (Phase B) — row selection + bulk controls for the contacts list.
 *
 * This component receives ONLY the ids of the rows already rendered on the current page — never the tenant's
 * contact list, and never any contact field. The rows themselves are server-rendered and passed in as children,
 * so no contact data is hydrated into the browser beyond what the page already displays.
 *
 * Selection lives in component state only: it is never written to the URL, never persisted, and is cleared
 * whenever the page changes because the server gives this component a `key` derived from the active
 * search/filter/cursor signature, which remounts it. "Select all" applies strictly to the rendered page —
 * selecting every match across all pages is deliberately not implemented in this phase.
 */
export interface ContactsBulkLabels {
  selectRow: string;
  selectPage: string;
  selectedCount: (n: number) => string;
  clearSelection: string;
  bulkStatus: string;
  bulkAssign: string;
  bulkUnassign: string;
  apply: string;
}

export interface BulkOption { value: string; label: string }

export function ContactsBulkTable({
  pageIds,
  labels,
  statusOptions,
  assigneeOptions,
  canManage,
  statusAction,
  assignAction,
  header,
  renderRow,
}: {
  /** Ids of the rows rendered on THIS page only. */
  pageIds: readonly string[];
  labels: ContactsBulkLabels;
  statusOptions: readonly BulkOption[];
  assigneeOptions: readonly BulkOption[];
  canManage: boolean;
  statusAction: (fd: FormData) => void | Promise<void>;
  assignAction: (fd: FormData) => void | Promise<void>;
  header: ReactNode;
  /** Server-rendered cells for one contact; the checkbox cell is added here. */
  renderRow: (id: string) => ReactNode;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const allOnPageSelected = useMemo(
    () => pageIds.length > 0 && pageIds.every((id) => selected.has(id)),
    [pageIds, selected],
  );
  const selectedIds = useMemo(() => pageIds.filter((id) => selected.has(id)), [pageIds, selected]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const togglePage = () => setSelected(allOnPageSelected ? new Set() : new Set(pageIds));
  const clear = () => setSelected(new Set());

  // The selected ids are submitted as hidden fields — never as a query string.
  const hiddenIds = selectedIds.map((id) => <input key={id} type="hidden" name="contactIds" value={id} />);

  return (
    <div className="space-y-3">
      {canManage && selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <p className="text-sm font-semibold" aria-live="polite">{labels.selectedCount(selectedIds.length)}</p>

          <form action={statusAction} className="flex items-end gap-2">
            {hiddenIds}
            <div>
              <label htmlFor="bulk-status" className="block text-xs font-semibold">{labels.bulkStatus}</label>
              <select id="bulk-status" name="status" defaultValue={statusOptions[0]?.value ?? ""}
                className="mt-1 rounded-lg border border-[var(--color-border-strong)] bg-transparent px-2 py-1.5 text-sm">
                {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <button type="submit" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--color-surface)]">{labels.apply}</button>
          </form>

          <form action={assignAction} className="flex items-end gap-2">
            {hiddenIds}
            <div>
              <label htmlFor="bulk-assignee" className="block text-xs font-semibold">{labels.bulkAssign}</label>
              <select id="bulk-assignee" name="assigneeUserId" defaultValue=""
                className="mt-1 rounded-lg border border-[var(--color-border-strong)] bg-transparent px-2 py-1.5 text-sm">
                <option value="">{labels.bulkUnassign}</option>
                {assigneeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <button type="submit" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--color-surface)]">{labels.apply}</button>
          </form>

          <button type="button" onClick={clear} className="text-xs font-medium text-[var(--color-brand)] hover:underline">
            {labels.clearSelection}
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted)]">
              {canManage ? (
                <th scope="col" className="px-3 py-2">
                  <input
                    type="checkbox" checked={allOnPageSelected} onChange={togglePage}
                    aria-label={labels.selectPage} title={labels.selectPage}
                    className="h-4 w-4 cursor-pointer align-middle"
                  />
                </th>
              ) : null}
              {header}
            </tr>
          </thead>
          <tbody>
            {pageIds.map((id) => (
              <tr key={id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                {canManage ? (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)}
                      aria-label={labels.selectRow}
                      className="h-4 w-4 cursor-pointer align-middle"
                    />
                  </td>
                ) : null}
                {renderRow(id)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
