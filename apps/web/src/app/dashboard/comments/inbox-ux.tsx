"use client";

import React, { useState, useTransition } from "react";
import type { InboxMutationResult } from "@guardora/db";

/**
 * V1.42B — shared inbox mutation UX. One hook for every internal control: it blocks
 * double-submit (pending), NEVER shows optimistic success (the banner is set only after the
 * server action resolves), normalizes the repository's machine reasons into human text, and
 * attaches a short correlation ref to unexpected errors. No raw SQL/Prisma/token/note body is
 * ever surfaced — only the whitelisted reason strings below.
 */
const REASONS: Record<string, string> = {
  not_found: "That item no longer exists.",
  assignee_not_member: "That person is not an active member of this workspace.",
  assignee_required: "Pick someone to assign.",
  duplicate_label: "A label with that name already exists.",
  invalid_name: "Enter a label name.",
  item_or_label_missing: "That item or label no longer exists.",
  item_missing: "That item no longer exists.",
  empty_note: "Write something before saving.",
  note_too_long: "Note is too long (max 5000 characters).",
  not_found_or_not_author: "You can only delete your own note.",
  action_not_bulk_eligible: "That action can’t be run in bulk.",
  empty_selection: "Select at least one item.",
  priority_required: "Choose a priority.",
  status_required: "Choose a status.",
  permission_denied: "You don’t have permission to do that.",
};
export function reasonText(reason: string): string {
  return REASONS[reason] ?? "That action could not be completed.";
}

export type ActionMsg = { kind: "ok" | "error"; text: string } | null;

export function useInboxAction() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionMsg>(null);
  /** Runs a server action; sets the banner ONLY from the resolved result (never optimistic). */
  function run(fn: () => Promise<InboxMutationResult | void>, okText = "Saved") {
    setMsg(null);
    start(async () => {
      try {
        const r = await fn();
        if (r && "ok" in r && r.ok === false) setMsg({ kind: "error", text: reasonText(r.reason) });
        else setMsg({ kind: "ok", text: okText });
      } catch {
        const ref = Math.random().toString(36).slice(2, 8);
        setMsg({ kind: "error", text: `Something went wrong. Reference ${ref}.` });
      }
    });
  }
  return { pending, msg, setMsg, run };
}

export function ActionNotice({ msg }: { msg: ActionMsg }) {
  if (!msg) return null;
  const tone = msg.kind === "ok" ? "text-[var(--color-ok)]" : "text-[var(--color-danger)]";
  return <p role="status" data-inbox-msg={msg.kind} className={`mt-1 text-xs ${tone}`}>{msg.text}</p>;
}
