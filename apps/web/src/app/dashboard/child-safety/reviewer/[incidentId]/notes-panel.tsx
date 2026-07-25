"use client";

import { useActionState, useRef, useState, useEffect } from "react";
import { renderMarkdownSafe, fmtDateTime, shortId } from "../reviewer-view";
import { isReviewActionErrorCode } from "../reviewer-i18n";
import { noteAction, type ReviewActionState } from "./actions";

export interface NotesUi { notes: string; addNote: string; markdownHint: string; preview: string; write: string; notePlaceholder: string; save: string; working: string; errorTitle: string; empty: string; }
export interface NoteRow { id: string; authorUserId: string; body: string; createdAt: string; }

const INITIAL: ReviewActionState = { ok: true };

/**
 * Reviewer notes — APPEND-ONLY. Newest first. There is NO edit and NO delete affordance (the backend
 * has no such path either). The add form (manager-only) offers a live, XSS-safe markdown preview. Note
 * bodies are internal-only and never leave this authenticated view.
 */
export function NotesPanel({ incidentId, notes, canManage, ui, errors }: { incidentId: string; notes: NoteRow[]; canManage: boolean; ui: NotesUi; errors: Record<string, string> }) {
  const [state, add, pending] = useActionState(noteAction, INITIAL);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [draft, setDraft] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok && pending === false) { setDraft(""); setTab("write"); } }, [state, pending]);

  const newestFirst = [...notes].reverse();
  const errorCode = state.ok ? null : state.error;

  return (
    <div className="space-y-4">
      {canManage ? (
        <form ref={formRef} action={add} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <input type="hidden" name="incidentId" value={incidentId} />
          <div className="mb-2 flex gap-1" role="tablist" aria-label={ui.addNote}>
            <button type="button" role="tab" aria-selected={tab === "write"} onClick={() => setTab("write")} className={`rounded-md px-2.5 py-1 text-xs font-medium ${tab === "write" ? "bg-[var(--color-neutral-soft)] text-[var(--color-fg)]" : "text-[var(--color-muted)]"}`}>{ui.write}</button>
            <button type="button" role="tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")} className={`rounded-md px-2.5 py-1 text-xs font-medium ${tab === "preview" ? "bg-[var(--color-neutral-soft)] text-[var(--color-fg)]" : "text-[var(--color-muted)]"}`}>{ui.preview}</button>
          </div>
          {tab === "write" ? (
            <textarea name="body" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={ui.notePlaceholder} rows={4} aria-label={ui.addNote} className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]" />
          ) : (
            <div className="min-h-[6rem] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)] prose-sm" dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(draft) || "<span class='opacity-50'>—</span>" }} />
          )}
          {/* Keep the value submitted even while previewing */}
          {tab === "preview" ? <input type="hidden" name="body" value={draft} /> : null}
          {errorCode && isReviewActionErrorCode(errorCode) ? <div role="alert" className="mt-2 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"><span className="font-medium">{ui.errorTitle}:</span> {errors[errorCode] ?? errors.retry_later}</div> : null}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-[var(--color-muted)]">{ui.markdownHint}</span>
            <button type="submit" disabled={pending || !draft.trim()} className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? ui.working : ui.save}</button>
          </div>
        </form>
      ) : null}

      {newestFirst.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">{ui.empty}</p>
      ) : (
        <ul className="space-y-3">
          {newestFirst.map((n) => (
            <li key={n.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-muted)]">
                <span className="font-mono">{shortId(n.authorUserId)}</span>
                <time dateTime={n.createdAt}>{fmtDateTime(n.createdAt)}</time>
              </div>
              <div className="text-sm text-[var(--color-fg)]" dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(n.body) }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
