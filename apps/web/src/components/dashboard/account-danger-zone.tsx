"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { requestAccountDeletion } from "@/app/dashboard/settings/account-actions";

function DeleteSubmit({ ready, label }: { ready: boolean; label: string }) {
  const { pending } = useFormStatus();
  const disabled = !ready || pending;
  return (
    <button
      type="submit"
      data-testid="account-delete-btn"
      disabled={disabled}
      aria-disabled={disabled}
      className="mt-3 inline-flex items-center justify-center rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

export interface AccountDangerZoneCopy {
  title: string;
  deleteHeading: string;
  description: string;
  historyNote: string;
  workspaceNote: string;
  soleOwnerHeading: string;
  soleOwnerNote: string;
  soleOwnerDeleting: string;
  confirmLabel: string;
  confirmCheckbox: string;
  button: string;
  mismatchNotice: string;
  blockedNotice: string;
}

export interface SoleOwnerBlockerView {
  tenantId: string;
  tenantName: string;
  deletionState: string;
}

/**
 * V1.45C2 — Account (global identity) Danger Zone. Distinct from the workspace Danger Zone. Visible to
 * EVERY authenticated user (self-service; no tenant role gates it). When the user solely owns any
 * workspace, the confirm form is replaced by a blocker list (their OWN workspaces — safe to show them).
 * The confirm button stays disabled until the user types their exact email AND ticks the acknowledgement;
 * the server re-verifies both. The email is the viewer's own, so echoing it to them is not a leak.
 */
export function AccountDangerZone({
  email,
  blockers,
  copy,
  notice,
}: {
  email: string;
  blockers: SoleOwnerBlockerView[];
  copy: AccountDangerZoneCopy;
  notice: "mismatch" | "owner" | null;
}) {
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const ready = typed === email && ack;
  const blocked = blockers.length > 0;

  return (
    <div data-testid="account-danger-zone" className="mt-6 rounded-xl border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_6%,white)] p-5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-danger)]">{copy.title}</span>
      </div>
      <h3 className="mt-2 text-base font-semibold">{copy.deleteHeading}</h3>
      <p className="mt-1.5 text-sm text-[var(--color-muted)]">{copy.description}</p>
      <ul className="mt-3 space-y-1.5 text-sm text-[var(--color-muted)]">
        <li>• {copy.historyNote}</li>
        <li>• {copy.workspaceNote}</li>
      </ul>

      {notice === "mismatch" ? (
        <p className="mt-3 rounded-lg border border-[var(--color-danger)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-danger)]">{copy.mismatchNotice}</p>
      ) : null}
      {notice === "owner" ? (
        <p className="mt-3 rounded-lg border border-[var(--color-danger)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-danger)]">{copy.blockedNotice}</p>
      ) : null}

      {blocked ? (
        <div data-testid="account-sole-owner-blockers" className="mt-4 rounded-lg border border-[var(--color-border-strong)] bg-white p-3">
          <h4 className="text-sm font-semibold">{copy.soleOwnerHeading}</h4>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{copy.soleOwnerNote}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {blockers.map((b) => (
              <li key={b.tenantId} className="font-medium">
                • {b.tenantName}
                {b.deletionState !== "active" ? <span className="ml-1 text-[var(--color-muted)]">{copy.soleOwnerDeleting}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form action={requestAccountDeletion} className="mt-4 max-w-md">
          <label htmlFor="account-confirm-email" className="block text-sm font-medium">
            {copy.confirmLabel}
            <span data-testid="account-email" className="ml-1 font-mono text-[var(--color-fg)]">{email}</span>
          </label>
          <input
            id="account-confirm-email"
            type="text"
            name="confirmEmail"
            data-testid="account-confirm-input"
            aria-label={copy.confirmLabel}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-danger)]"
          />
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" name="ack" data-testid="account-ack" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
            <span>{copy.confirmCheckbox}</span>
          </label>
          <DeleteSubmit ready={ready} label={copy.button} />
        </form>
      )}
    </div>
  );
}
