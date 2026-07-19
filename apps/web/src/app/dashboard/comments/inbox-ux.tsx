"use client";

import React, { useState, useTransition } from "react";
import type { InboxMutationResult } from "@guardora/db";
import type { Locale } from "@/i18n";
import { reasonText, somethingWrong } from "./inbox-i18n";

/**
 * V1.42B — shared inbox mutation UX. One hook for every internal control: it blocks
 * double-submit (pending), NEVER shows optimistic success (the banner is set only after the
 * server action resolves), normalizes the repository's machine reasons into human text, and
 * attaches a short correlation ref to unexpected errors. No raw SQL/Prisma/token/note body is
 * ever surfaced — only the whitelisted reason strings in inbox-i18n.ts.
 * V1.65 — reason/error copy is localized (SK/EN/DE) via inbox-i18n; `reasonText` is re-exported
 * for inbox-selection's bulk path.
 */
export { reasonText };

export type ActionMsg = { kind: "ok" | "error"; text: string } | null;

export function useInboxAction(locale: Locale) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionMsg>(null);
  /** Runs a server action; sets the banner ONLY from the resolved result (never optimistic). */
  function run(fn: () => Promise<InboxMutationResult | void>, okText: string) {
    setMsg(null);
    start(async () => {
      try {
        const r = await fn();
        if (r && "ok" in r && r.ok === false) setMsg({ kind: "error", text: reasonText(r.reason, locale) });
        else setMsg({ kind: "ok", text: okText });
      } catch {
        const ref = Math.random().toString(36).slice(2, 8);
        setMsg({ kind: "error", text: somethingWrong(ref, locale) });
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
