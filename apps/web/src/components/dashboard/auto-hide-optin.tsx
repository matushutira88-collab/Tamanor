"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { setBrandAutoHide } from "@/app/dashboard/safety-actions";

function Submit({ ready, label }: { ready: boolean; label: string }) {
  const { pending } = useFormStatus();
  const disabled = !ready || pending;
  return (
    <button type="submit" disabled={disabled} aria-disabled={disabled}
      className="rounded-lg bg-[var(--color-danger)] px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
      {label}
    </button>
  );
}

/**
 * V1.27 — per-brand "Enable safe auto-hide" opt-in. Enabling requires ticking the
 * acknowledgement; disabling is a one-click action. Safety limits + the hard floor
 * always apply regardless of this toggle.
 */
export function AutoHideOptIn({ brandId, enabled, ackLabel, enableLabel, disableLabel }: {
  brandId: string; enabled: boolean; ackLabel: string; enableLabel: string; disableLabel: string;
}) {
  const [ack, setAck] = useState(false);
  if (enabled) {
    return (
      <form action={setBrandAutoHide}>
        <input type="hidden" name="brandId" value={brandId} />
        <input type="hidden" name="on" value="0" />
        <button type="submit" className="rounded-md border border-[var(--color-ok)] px-2 py-1 text-xs">{disableLabel}</button>
      </form>
    );
  }
  return (
    <form action={setBrandAutoHide} className="space-y-2">
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="on" value="1" />
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" name="ack" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        <span>{ackLabel}</span>
      </label>
      <Submit ready={ack} label={enableLabel} />
    </form>
  );
}
