"use client";

// The default React import is what makes this component renderable from the standalone tsx test scripts
// (they compile JSX with the classic runtime), exactly like connector-status-badge.tsx.
import React, { useMemo, useState, type ReactNode } from "react";

/**
 * BUSINESS-CRM-V2 (Phase B) — row selection + bulk controls for the contacts list.
 *
 * SERIALIZATION CONTRACT (this is a Client Component — every prop crosses the RSC boundary):
 * the ONLY functions this component may receive are Server Actions. It must never take a render
 * callback, a label formatter or any other ordinary function, because React cannot serialize one
 * into the RSC payload and the whole route fails at render time.
 *
 * Rows are therefore passed as DATA: the server builds `{ id, cells }` pairs where `cells` is
 * already-rendered server markup. This component adds the checkbox cell, owns selection state and
 * nothing else. It still receives only the rows of the CURRENT page — never the tenant's contact
 * list, and never a contact field beyond what the page already displays.
 *
 * Selection lives in component state only: it is never written to the URL, never persisted, and is
 * cleared whenever the page changes because the server gives this component a `key` derived from the
 * active search/filter/cursor signature, which remounts it. "Select all" applies strictly to the
 * rendered page — selecting every match across all pages is deliberately not implemented.
 */

/** The single placeholder inside `selectedCountTemplate`. Kept in sync with business-i18n.ts. */
export const SELECTED_COUNT_PLACEHOLDER = "{count}";

/**
 * Localized count text WITHOUT a formatter function crossing the boundary: the server passes the
 * translated template string, the client substitutes the number.
 */
export function formatSelectedCount(template: string, n: number): string {
  return template.split(SELECTED_COUNT_PLACEHOLDER).join(String(n));
}

/** Selection helpers — pure, so the page-scoping rule is provable without a browser. */
export function nextPageSelection(pageIds: readonly string[], selected: ReadonlySet<string>): ReadonlySet<string> {
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  // Selecting always yields EXACTLY the rendered page — never a union with ids from another page.
  return allSelected ? new Set<string>() : new Set(pageIds);
}
export function selectedOnPage(pageIds: readonly string[], selected: ReadonlySet<string>): string[] {
  // Submitting filters through the page ids too, so a stale id can never reach a bulk action.
  return pageIds.filter((id) => selected.has(id));
}

export interface ContactsBulkLabels {
  selectRow: string;
  selectPage: string;
  /** Template containing SELECTED_COUNT_PLACEHOLDER, e.g. "{count} selected". Never a function. */
  selectedCountTemplate: string;
  clearSelection: string;
  bulkStatus: string;
  bulkAssign: string;
  bulkUnassign: string;
  apply: string;
}

export interface BulkOption { value: string; label: string }

/** One rendered row: its contact id and the server-rendered `<td>` cells that belong to THAT id. */
export interface ContactsBulkRow { id: string; cells: ReactNode }

export function ContactsBulkTable({
  rows,
  labels,
  statusOptions,
  assigneeOptions,
  canManage,
  statusAction,
  assignAction,
  header,
}: {
  /** Rows rendered on THIS page only, each id paired with its own server-rendered cells. */
  rows: readonly ContactsBulkRow[];
  labels: ContactsBulkLabels;
  statusOptions: readonly BulkOption[];
  assigneeOptions: readonly BulkOption[];
  canManage: boolean;
  statusAction: (fd: FormData) => void | Promise<void>;
  assignAction: (fd: FormData) => void | Promise<void>;
  header: ReactNode;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allOnPageSelected = useMemo(
    () => pageIds.length > 0 && pageIds.every((id) => selected.has(id)),
    [pageIds, selected],
  );
  const selectedIds = useMemo(() => selectedOnPage(pageIds, selected), [pageIds, selected]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const togglePage = () => setSelected((prev) => nextPageSelection(pageIds, prev));
  const clear = () => setSelected(new Set());

  // The selected ids are submitted as hidden fields — never as a query string.
  const hiddenIds = selectedIds.map((id) => <input key={id} type="hidden" name="contactIds" value={id} />);

  return (
    <div className="space-y-3">
      {canManage && selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <p className="text-sm font-semibold" aria-live="polite">{formatSelectedCount(labels.selectedCountTemplate, selectedIds.length)}</p>

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
            {rows.map((row) => (
              <tr key={row.id} data-contact-row={row.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                {canManage ? (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)}
                      aria-label={labels.selectRow}
                      className="h-4 w-4 cursor-pointer align-middle"
                    />
                  </td>
                ) : null}
                {row.cells}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
