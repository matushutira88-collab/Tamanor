/**
 * V1.39 — the ONE truthful connector display model. Maps a connected account's real DB
 * state (status / health / connectionStatus / tokenHealth / contentPermissionState / mode)
 * AND the centralized provider-status into a user-facing {state, label, tone, copy, cta}.
 *
 * Guarantees (enforced by tests):
 *  - Instagram / Google Business are NEVER shown healthy/live just because OAuth connected —
 *    their provider verification is pending, so the display shows that truth.
 *  - A disconnected / expired / permission-missing account always shows the connection
 *    problem (never "connected").
 *  - A sync-disabled account is never shown as healthy without the disabled note.
 */
import { providerStatusFor } from "./provider-status";

export type ConnectorDisplayState =
  | "healthy"
  | "connected"
  | "disconnected"
  | "reconnect_required"
  | "permission_missing"
  | "token_expired"
  | "provider_verification_pending"
  | "rate_limited"
  | "api_unavailable"
  | "transient_error"
  | "sync_disabled"
  | "unsupported";

export type DisplayTone = "ok" | "warn" | "danger" | "muted";

export interface ConnectorAccountLike {
  platformKey: string; // facebook | instagram | google_business | ...
  status?: string | null; // ConnectorStatus: active|expired|disconnected|...
  health?: string | null; // ConnectorHealth: healthy|degraded|error|unknown
  connectionStatus?: string | null; // connected|needs_reconnect|invalid_token|missing_permission|disabled_by_user|disconnected
  tokenHealth?: string | null; // ok|expiring_soon|expired|invalid|revoked|unknown
  contentPermissionState?: string | null; // permission_missing|rate_limited|api_unavailable|...
  mode?: string | null; // placeholder|read_only|...
}

export interface ConnectorDisplay {
  state: ConnectorDisplayState;
  /** Short badge label. */
  label: string;
  /** Longer headline (same as label today; kept distinct for callers that want both). */
  headline: string;
  tone: DisplayTone;
  /** Severity alias of tone, for callers that prefer the word. */
  severity: DisplayTone;
  /** One-line human description. */
  copy: string;
  description: string;
  cta?: { label: string; kind: "reconnect" | "view" | "none" };
  /** True ONLY when the connector is verified live-monitoring today (Facebook only). */
  whetherLive: boolean;
  whetherSyncEnabled: boolean;
  whetherReconnectRequired: boolean;
}

const RECONNECT = { label: "Reconnect", kind: "reconnect" as const };

/** Decorate the raw {state,label,tone,copy,cta} with the derived truth booleans. */
function finalize(d: { state: ConnectorDisplayState; label: string; tone: DisplayTone; copy: string; cta?: ConnectorDisplay["cta"] }): ConnectorDisplay {
  return {
    ...d,
    headline: d.label,
    severity: d.tone,
    description: d.copy,
    whetherLive: d.state === "healthy",
    whetherSyncEnabled: d.state === "healthy",
    whetherReconnectRequired: d.cta?.kind === "reconnect",
  };
}

function connectorDisplayRaw(a: ConnectorAccountLike, opts: { liveSyncEnabled?: boolean } = {}): { state: ConnectorDisplayState; label: string; tone: DisplayTone; copy: string; cta?: ConnectorDisplay["cta"] } {
  const provider = providerStatusFor(a.platformKey);

  // 0) Unsupported / research providers are never "connected".
  if (!provider || provider.status === "research" || provider.status === "unsupported") {
    return { state: "unsupported", label: "Not supported", tone: "muted", copy: "This platform is not supported yet.", cta: { label: "Learn more", kind: "view" } };
  }

  // 1) Hard connection problems (most urgent, always truthful).
  if (a.status === "disconnected" || a.connectionStatus === "disconnected") {
    return { state: "disconnected", label: "Disconnected", tone: "danger", copy: "This account is disconnected and is not being monitored.", cta: RECONNECT };
  }
  if (a.status === "expired" || ["expired", "invalid", "revoked"].includes(a.tokenHealth ?? "")) {
    return { state: "token_expired", label: "Reconnect required", tone: "danger", copy: "The access token has expired. Reconnect to resume monitoring.", cta: RECONNECT };
  }
  if (["needs_reconnect", "invalid_token"].includes(a.connectionStatus ?? "")) {
    return { state: "reconnect_required", label: "Reconnect required", tone: "danger", copy: "This account needs to be reconnected.", cta: RECONNECT };
  }
  if (a.connectionStatus === "missing_permission" || a.contentPermissionState === "permission_missing") {
    return { state: "permission_missing", label: "Permission needed", tone: "danger", copy: "A required permission is missing. Reconnect and grant the requested access.", cta: RECONNECT };
  }
  if (a.contentPermissionState === "rate_limited") {
    return { state: "rate_limited", label: "Rate limited", tone: "warn", copy: "The platform temporarily rate-limited this account. Monitoring retries automatically.", cta: { label: "View", kind: "view" } };
  }
  if (a.contentPermissionState === "api_unavailable") {
    return { state: "api_unavailable", label: "Platform unavailable", tone: "warn", copy: "The platform's API is temporarily unavailable. Monitoring retries automatically.", cta: { label: "View", kind: "view" } };
  }

  // 2) Provider-level verification: Instagram / Google Business are NOT live yet, even
  //    when the account is connected — show that truth instead of "healthy/live".
  if (provider.verificationPending) {
    return {
      state: "provider_verification_pending",
      label: "Connected · verification pending",
      tone: "warn",
      copy: `${provider.name} is connected, but live monitoring is pending provider verification. It is not live yet.`,
      cta: { label: "View", kind: "view" },
    };
  }

  // 3) Sync disabled (placeholder mode or live sync turned off for a real account).
  if (a.mode === "placeholder" || opts.liveSyncEnabled === false) {
    return { state: "sync_disabled", label: "Connected · sync off", tone: "warn", copy: "This account is connected, but automatic sync is currently disabled.", cta: { label: "View", kind: "view" } };
  }

  // 4) Healthy — only reachable for a live-verified provider with a healthy connection.
  if (a.status === "active" && (a.health === "healthy" || a.health === "unknown")) {
    return { state: "healthy", label: "Connected", tone: "ok", copy: "Connected and monitoring.", cta: { label: "View", kind: "view" } };
  }

  // 5) Fallback — a transient/unknown state is never dressed up as healthy.
  return { state: "transient_error", label: "Attention", tone: "warn", copy: "This account needs a check. Open it to see the latest status.", cta: { label: "View", kind: "view" } };
}

/** The truthful connector display for an account. This is the ONE model tenant UI uses. */
export function connectorDisplay(a: ConnectorAccountLike, opts: { liveSyncEnabled?: boolean } = {}): ConnectorDisplay {
  return finalize(connectorDisplayRaw(a, opts));
}
