"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { requestWorkspaceDeletion } from "@/app/dashboard/settings/actions";

function DeleteSubmit({ ready, label }: { ready: boolean; label: string }) {
  const { pending } = useFormStatus();
  const disabled = !ready || pending;
  return (
    <button
      type="submit"
      data-testid="danger-delete-btn"
      disabled={disabled}
      aria-disabled={disabled}
      className="mt-3 inline-flex items-center justify-center rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

export interface DangerZoneCopy {
  title: string;
  deleteHeading: string;
  description: string;
  credentialsNote: string;
  providerNote: string;
  backupsNote: string;
  confirmLabel: string;
  confirmCheckbox: string;
  button: string;
  mismatchNotice: string;
}

/**
 * V1.45C1 — Owner-only Danger Zone. The button stays disabled until the user has typed the EXACT
 * workspace name AND ticked the acknowledgement; server authorization re-verifies both regardless.
 * The workspace name is passed in (from the trusted session) and never placed in a query string.
 */
export function DangerZone({
  workspaceName,
  copy,
  showMismatch,
}: {
  workspaceName: string;
  copy: DangerZoneCopy;
  showMismatch: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const ready = typed === workspaceName && ack;

  return (
    <div data-testid="danger-zone" className="mt-8 rounded-xl border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_6%,white)] p-5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-danger)]">{copy.title}</span>
      </div>
      <h3 className="mt-2 text-base font-semibold">{copy.deleteHeading}</h3>
      <p className="mt-1.5 text-sm text-[var(--color-muted)]">{copy.description}</p>
      <ul className="mt-3 space-y-1.5 text-sm text-[var(--color-muted)]">
        <li>• {copy.credentialsNote}</li>
        <li>• {copy.providerNote}</li>
        <li>• {copy.backupsNote}</li>
      </ul>

      {showMismatch ? (
        <p className="mt-3 rounded-lg border border-[var(--color-danger)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-danger)]">
          {copy.mismatchNotice}
        </p>
      ) : null}

      <form action={requestWorkspaceDeletion} className="mt-4 max-w-md">
        <label htmlFor="danger-confirm-name" className="block text-sm font-medium">
          {copy.confirmLabel}
          <span data-testid="danger-workspace-name" className="ml-1 font-mono text-[var(--color-fg)]">{workspaceName}</span>
        </label>
        <input
          id="danger-confirm-name"
          type="text"
          name="confirmName"
          data-testid="danger-confirm-input"
          aria-label={copy.confirmLabel}
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-danger)]"
        />
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" name="ack" data-testid="danger-ack" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
          <span>{copy.confirmCheckbox}</span>
        </label>
        <DeleteSubmit ready={ready} label={copy.button} />
      </form>
    </div>
  );
}
