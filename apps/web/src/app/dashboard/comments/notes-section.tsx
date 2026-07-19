"use client";

import { useState } from "react";
import type { Locale } from "@/i18n";
import { useInboxAction, ActionNotice } from "./inbox-ux";
import { INBOX_COPY } from "./inbox-i18n";
import { addNoteAction, deleteNoteAction } from "./inbox-actions";

/**
 * V1.42B — internal notes (plain text, max 5000). Notes are NEVER sent to a provider and their
 * body is NEVER written to the audit log. React escapes the body on render (no raw HTML). A note
 * is author-scoped for deletion. Empty notes are rejected client- and server-side; double-submit
 * is blocked by the pending state.
 */
const NOTE_MAX = 5000;
export type NoteLite = { id: string; body: string; authorName: string; authorId: string | null; createdAtLabel: string };

export function NotesSection({
  itemId, notes, selfId, canAct, locale,
}: { itemId: string; notes: NoteLite[]; selfId: string; canAct: boolean; locale: Locale }) {
  const L = INBOX_COPY[locale];
  const { pending, msg, run, setMsg } = useInboxAction(locale);
  const [body, setBody] = useState("");
  const over = body.length > NOTE_MAX;
  return (
    <div className="flex flex-col gap-2" data-testid="notes-section" data-notecount={notes.length}>
      <ul className="flex flex-col gap-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2" data-testid="note-item">
            <p className="whitespace-pre-wrap text-xs">{n.body}</p>
            <p className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
              <span>{n.authorName} · {n.createdAtLabel}</span>
              {canAct && n.authorId && n.authorId === selfId ? (
                <button type="button" disabled={pending} data-testid="note-delete"
                  className="hover:text-[var(--color-danger)] disabled:opacity-50"
                  onClick={() => run(() => deleteNoteAction(n.id), L.okNoteDeleted)}>{L.del}</button>
              ) : null}
            </p>
          </li>
        ))}
        {notes.length === 0 ? <li className="text-xs text-[var(--color-muted)]">{L.noNotesYet}</li> : null}
      </ul>
      {canAct ? (
        <div className="flex flex-col gap-1">
          <textarea value={body} onChange={(e) => { setBody(e.target.value); if (msg) setMsg(null); }} rows={2}
            placeholder={L.notePlaceholder} data-testid="note-input"
            className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs" />
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending || !body.trim() || over} data-testid="note-add"
              className="rounded-md bg-[var(--color-brand)] px-2.5 py-1 text-xs font-semibold text-[var(--color-brand-fg)] disabled:opacity-50"
              onClick={() => run(async () => { const r = await addNoteAction(itemId, body); if (r.ok) setBody(""); return r; }, L.okNoteAdded)}>
              {pending ? L.saving : L.addNote}
            </button>
            <span className={`text-[11px] ${over ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"}`}>{body.length}/{NOTE_MAX}</span>
          </div>
          <ActionNotice msg={msg} />
        </div>
      ) : null}
    </div>
  );
}
