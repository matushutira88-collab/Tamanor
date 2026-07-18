"use client";

import { useFormStatus } from "react-dom";
import { toggleMonitoringAction } from "@/app/dashboard/accounts/monitoring-actions";

/**
 * V1.59 hotfix — a real monitoring switch with an IMMEDIATE pending state. On click the button disables
 * itself (double-click protection) and shows a pulsing knob, so the user gets feedback in <100ms instead
 * of staring at a frozen switch while the server action runs. The SECURITY logic is unchanged and stays
 * on the server: toggleMonitoringAction → enableAccountMonitoringWithinLimit (atomic, tenant-scoped, RLS).
 * A currently-ON account can always be turned off; an OFF account is disabled only when the plan is full.
 */
function Toggle({ enabled, disabled, on, off, limit }: { enabled: boolean; disabled: boolean; on: string; off: string; limit: string }) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      role="switch"
      aria-checked={enabled}
      aria-busy={pending}
      aria-label={enabled ? on : off}
      title={disabled ? limit : enabled ? on : off}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed ${enabled ? "bg-[var(--color-ok)]" : "bg-[var(--color-border-strong)]"} ${pending ? "opacity-60" : ""}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${enabled ? "translate-x-4" : "translate-x-0.5"} ${pending ? "animate-pulse" : ""}`} />
    </button>
  );
}

export function MonitoringSwitch({ accountId, enabled, disabled, on, off, limit }: {
  accountId: string; enabled: boolean; disabled: boolean; on: string; off: string; limit: string;
}) {
  return (
    <form action={toggleMonitoringAction}>
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="enable" value={String(!enabled)} />
      <Toggle enabled={enabled} disabled={disabled} on={on} off={off} limit={limit} />
    </form>
  );
}
