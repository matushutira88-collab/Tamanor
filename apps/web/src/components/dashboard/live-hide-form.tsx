"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { executeLiveHide } from "@/app/dashboard/action-queue/[id]/actions";

const REQUIRED_PHRASE = "LIVE HIDE";

function LiveSubmit({ ready, label, pendingLabel }: { ready: boolean; label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  const disabled = !ready || pending;
  return (
    <button
      type="submit"
      disabled={disabled}
      aria-disabled={disabled}
      className="w-full rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * V1.26 — controlled LIVE Facebook hide confirmation. Deliberately NOT the normal
 * Approve. The button only enables after the operator ticks the acknowledgement and
 * types the exact confirmation phrase; it also disables itself while submitting.
 */
export function LiveHideForm({
  id,
  retry = false,
  warning,
  ackLabel,
  phraseLabel,
  phrasePlaceholder,
  buttonLabel,
  pendingLabel,
}: {
  id: string;
  retry?: boolean;
  warning: string;
  ackLabel: string;
  phraseLabel: string;
  phrasePlaceholder: string;
  buttonLabel: string;
  pendingLabel: string;
}) {
  const [understood, setUnderstood] = useState(false);
  const [phrase, setPhrase] = useState("");
  const ready = understood && phrase.trim() === REQUIRED_PHRASE;

  return (
    <form action={executeLiveHide} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {retry ? <input type="hidden" name="retry" value="1" /> : null}
      <p className="rounded-lg border-2 border-[var(--color-danger)] p-2 text-xs text-[var(--color-danger)]">🚨 {warning}</p>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" name="understood" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5" />
        <span>{ackLabel}</span>
      </label>
      <label className="block text-xs">
        <span className="text-[var(--color-muted)]">{phraseLabel}</span>
        <input
          type="text"
          name="confirmPhrase"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder={phrasePlaceholder}
          autoComplete="off"
          className="mt-1 w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 font-mono text-sm"
        />
      </label>
      <LiveSubmit ready={ready} label={buttonLabel} pendingLabel={pendingLabel} />
    </form>
  );
}
