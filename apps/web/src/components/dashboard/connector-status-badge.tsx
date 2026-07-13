import React from "react";
import { connectorDisplay, type ConnectorAccountLike } from "../../lib/connector-display";

/**
 * V1.39B — the single truthful connector status badge. Every tenant surface (accounts
 * list, account detail, connector cards) renders THIS, so the same provider truth is
 * shown everywhere: Instagram / Google Business can never read "Live", a sync-disabled
 * account never reads "Healthy", and unsupported platforms get no connect/reconnect CTA.
 *
 * Self-contained (relative import + inline span) so it renders in unit tests without a
 * browser, while matching the app's Badge styling.
 */
const TONE_CLASS: Record<string, string> = {
  ok: "bg-[var(--color-ok-soft)] text-[var(--color-ok)]",
  warn: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
  danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  muted: "bg-[var(--color-neutral-soft)] text-[var(--color-muted)]",
};

export function ConnectorStatusBadge({
  account,
  liveSyncEnabled,
  withDescription = false,
}: {
  account: ConnectorAccountLike;
  liveSyncEnabled?: boolean;
  withDescription?: boolean;
}) {
  const d = connectorDisplay(account, { liveSyncEnabled });
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-current/15 ${TONE_CLASS[d.tone] ?? TONE_CLASS.muted}`}
        data-connector-state={d.state}
        data-whether-live={d.whetherLive ? "true" : "false"}
      >
        {d.label}
      </span>
      {withDescription ? <span className="text-xs text-[var(--color-muted)]">{d.description}</span> : null}
    </span>
  );
}
