"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { eraseLeadAction } from "@/app/dashboard/leads/actions";

function EraseSubmit({ ready, label }: { ready: boolean; label: string }) {
  const { pending } = useFormStatus();
  const disabled = !ready || pending;
  return (
    <button
      type="submit"
      data-testid="lead-erase-btn"
      disabled={disabled}
      aria-disabled={disabled}
      className="mt-3 inline-flex items-center justify-center rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

export interface LeadEraseCopy {
  heading: string;
  description: string;
  confirmLabel: string;
  confirmWord: string;
  ackLabel: string;
  button: string;
}

/**
 * V1.45C3 — Platform-Admin-only irreversible lead erasure control. Rendered ONLY when the viewer holds
 * `leads:erase` (the server re-authorizes independently regardless). The button stays disabled until
 * the operator types the exact confirmation word AND ticks the acknowledgement. The lead id is a bound
 * server-action argument (the existing route resource id) — no lead email/PII is placed in any URL.
 */
export function LeadEraseZone({ leadId, copy }: { leadId: string; copy: LeadEraseCopy }) {
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const ready = typed.trim().toUpperCase() === copy.confirmWord.toUpperCase() && ack;

  return (
    <div data-testid="lead-erase-zone" className="rounded-xl border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_6%,white)] p-5">
      <h3 className="text-sm font-semibold text-[var(--color-danger)]">{copy.heading}</h3>
      <p className="mt-1.5 text-sm text-[var(--color-muted)]">{copy.description}</p>
      <form action={eraseLeadAction.bind(null, leadId)} className="mt-3">
        <label htmlFor="lead-erase-confirm" className="block text-sm font-medium">{copy.confirmLabel}</label>
        <input
          id="lead-erase-confirm"
          type="text"
          data-testid="lead-erase-input"
          aria-label={copy.confirmLabel}
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-1.5 w-full max-w-xs rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-danger)]"
        />
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" data-testid="lead-erase-ack" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
          <span>{copy.ackLabel}</span>
        </label>
        <EraseSubmit ready={ready} label={copy.button} />
      </form>
    </div>
  );
}
