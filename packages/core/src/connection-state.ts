/**
 * V1.75 (P0 hotfix) — the ONE server-authoritative account CONNECTION-STATE resolver.
 *
 * Before this file, "is the account connected/healthy?" was answered by 4–5 divergent
 * formulas (connector-display, dashboard-metrics.connectionStatusOf, classifyProblem,
 * an inline command-center clause, connectorNeedsReconnect). They disagreed — an
 * expired/failing account could show a green "Connected" badge on one surface while a
 * notification correctly said "reconnect required". This module is the single source of
 * truth used by the dashboard, the accounts table, the sync engine, audit, notifications
 * and manual/auto sync gating. It is PURE (no DB, no network, no clock except an injected
 * `now`) so it is trivially unit-testable and identical on every surface.
 *
 * Truthfulness contract:
 *  - The green "Connected" state (CONNECTED_HEALTHY) is returned ONLY when the connection
 *    is genuinely healthy AND at least one successful sync has completed.
 *  - An expired/invalid/revoked token, or a needs-reconnect connection, is ALWAYS
 *    REAUTH_REQUIRED — never green, never merely "degraded".
 *  - A disconnected account is ALWAYS DISCONNECTED — never green.
 *  - "Last successful sync" and "last attempt" are distinct inputs and never conflated.
 */
import { ConnectorMode } from "./connector-mode";

/** The six canonical connection states. Green UI is allowed ONLY for CONNECTED_HEALTHY. */
export type ConnectionState =
  | "CONNECTED_HEALTHY"
  | "WAITING_FIRST_SYNC"
  | "DEGRADED"
  | "REAUTH_REQUIRED"
  | "SYNC_FAILED"
  | "DISCONNECTED";

/** The five canonical AUTOMATIC-sync states (per account). */
export type AutoSyncState =
  | "ENABLED_HEALTHY"
  | "ENABLED_DEGRADED"
  | "ENABLED_REAUTH_REQUIRED"
  | "DISABLED"
  | "NOT_CONFIGURED";

/**
 * The raw account fields the resolver reads. Every field maps 1:1 to a persisted
 * `ConnectedAccount` column — the resolver invents nothing.
 */
export interface ConnectionStateInput {
  /** ConnectorStatus: pending | active | mock_connected | expired | disconnected | error */
  status: string;
  /** ConnectorMode: placeholder | oauth_ready | read_only | action_disabled */
  mode: string;
  /** ConnectorHealth: unknown | healthy | degraded | error */
  health: string;
  /** connected | needs_reconnect | invalid_token | missing_permission | disabled_by_user | disconnected */
  connectionStatus: string;
  /** unknown | ok | expiring_soon | expired | invalid | revoked */
  tokenHealth: string;
  /** OAuth token expiry (a past expiry ⇒ reauth). */
  tokenExpiresAt?: Date | string | null;
  /** The last error classification recorded by the sync engine (e.g. "token_expired"). */
  lastError?: string | null;
  /** The last time a sync SUCCEEDED (distinct from the last attempt). */
  lastSuccessfulSyncAt?: Date | string | null;
  /** The last time a sync was ATTEMPTED, success or failure. */
  lastSyncedAt?: Date | string | null;
  /** Per-account automatic-sync / monitoring toggle. */
  monitoringEnabled: boolean;
}

const REAUTH_CONNECTION_STATUSES = new Set(["needs_reconnect", "invalid_token", "missing_permission"]);
const REAUTH_TOKEN_HEALTHS = new Set(["expired", "invalid", "revoked"]);

function toMs(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** A test/demo/placeholder connection is never a real, auto-syncable connection. */
export function isTestConnection(input: { status: string; mode: string }): boolean {
  return input.status === "mock_connected" || input.mode === ConnectorMode.Placeholder;
}

/**
 * Resolve the ONE canonical connection state. Precedence is deliberate and ordered by
 * urgency so a single account never maps to two states:
 *   DISCONNECTED → REAUTH_REQUIRED → SYNC_FAILED → DEGRADED → WAITING_FIRST_SYNC → CONNECTED_HEALTHY
 * REAUTH is checked before SYNC_FAILED/DEGRADED because a token failure also flips health
 * to degraded — a reconnect problem must win over a generic "sync degraded".
 */
export function resolveConnectionState(input: ConnectionStateInput, now: Date = new Date()): ConnectionState {
  const nowMs = now.getTime();

  // 1) Hard disconnect — the account is not connected at all.
  if (input.status === "disconnected" || input.connectionStatus === "disconnected") {
    return "DISCONNECTED";
  }

  // 2) Re-auth required — token/permission problems. Checked before any sync-health state
  //    because the sync engine also sets health=degraded on a reconnect failure.
  const expiryMs = toMs(input.tokenExpiresAt);
  if (
    input.status === "expired" ||
    REAUTH_CONNECTION_STATUSES.has(input.connectionStatus) ||
    REAUTH_TOKEN_HEALTHS.has(input.tokenHealth) ||
    (expiryMs !== null && expiryMs <= nowMs) ||
    input.lastError === "token_expired"
  ) {
    return "REAUTH_REQUIRED";
  }

  // 3) Hard sync failure — a real error (health=error) on an account that has actually run a sync
  //    before (an attempt OR a prior success). A brand-new account that has NEVER synced and merely
  //    shows an error is still WAITING_FIRST_SYNC (case 5), not a truthful failure yet.
  if (input.health === "error" && (toMs(input.lastSyncedAt) !== null || toMs(input.lastSuccessfulSyncAt) !== null)) {
    return "SYNC_FAILED";
  }

  // 4) Transient degradation — rate-limited / API-unavailable (health=degraded, auto-retries).
  if (input.health === "degraded") {
    return "DEGRADED";
  }

  // 5) Waiting for the first successful sync — connected, but never synced yet. NOT an error.
  if (toMs(input.lastSuccessfulSyncAt) === null) {
    return "WAITING_FIRST_SYNC";
  }

  // 6) Healthy — reachable only once a real successful sync has landed and nothing is wrong.
  return "CONNECTED_HEALTHY";
}

/**
 * Resolve the ONE canonical AUTO-sync state for an account. `monitoringEnabled` is the
 * per-account automatic-sync toggle — a fresh cron attempt/timestamp must NEVER be read
 * as "enabled". DISABLED is returned ONLY when the account's config truly has it off.
 */
export function resolveAutoSyncState(input: ConnectionStateInput, now: Date = new Date()): AutoSyncState {
  const cs = resolveConnectionState(input, now);

  // A disconnected or test/demo account is not a configured auto-sync target.
  if (cs === "DISCONNECTED") return "NOT_CONFIGURED";
  if (isTestConnection(input)) return "NOT_CONFIGURED";

  // The config toggle is authoritative for DISABLED — nothing else may imply it.
  if (!input.monitoringEnabled) return "DISABLED";

  // Enabled, but the connection has a problem — surface the truthful sub-state.
  if (cs === "REAUTH_REQUIRED") return "ENABLED_REAUTH_REQUIRED";
  if (cs === "DEGRADED" || cs === "SYNC_FAILED") return "ENABLED_DEGRADED";

  // Enabled and healthy (including the pre-first-sync window). Only here may the UI say
  // "running via automatic sync".
  return "ENABLED_HEALTHY";
}

/** A manual "Sync now" must be blocked when the account needs reconnect or is disconnected. */
export function manualSyncBlocked(state: ConnectionState): boolean {
  return state === "REAUTH_REQUIRED" || state === "DISCONNECTED";
}

/** True only when the account is genuinely, verifiably connected and healthy. */
export function connectionIsHealthy(state: ConnectionState): boolean {
  return state === "CONNECTED_HEALTHY";
}

/** True when the account needs the user to reconnect (drives the "Reconnect" CTA). */
export function connectionNeedsReauth(state: ConnectionState): boolean {
  return state === "REAUTH_REQUIRED";
}

export type ConnectionTone = "ok" | "warn" | "danger" | "muted";

/** The recommended primary CTA for a connection state. */
export type ConnectionCta = "sync" | "reconnect" | "disconnect" | "view";

interface ConnectionStatePresentation {
  tone: ConnectionTone;
  /** Stable i18n key suffix under `dash.connState.*` (never a hard-coded string). */
  key: string;
  cta: ConnectionCta;
}

/**
 * Display metadata for a connection state — tone + i18n key + primary CTA. UI layers read
 * this so tone/CTA are decided in exactly ONE place. `CONNECTED_HEALTHY` is the only `ok`
 * (green) tone; every problem state is warn/danger and offers Reconnect where appropriate.
 */
export const CONNECTION_STATE_PRESENTATION: Record<ConnectionState, ConnectionStatePresentation> = {
  CONNECTED_HEALTHY: { tone: "ok", key: "connected_healthy", cta: "sync" },
  WAITING_FIRST_SYNC: { tone: "warn", key: "waiting_first_sync", cta: "sync" },
  DEGRADED: { tone: "warn", key: "degraded", cta: "sync" },
  SYNC_FAILED: { tone: "danger", key: "sync_failed", cta: "sync" },
  REAUTH_REQUIRED: { tone: "danger", key: "reauth_required", cta: "reconnect" },
  DISCONNECTED: { tone: "danger", key: "disconnected", cta: "reconnect" },
};

/** Display metadata for an auto-sync state — tone + i18n key. */
export const AUTO_SYNC_STATE_PRESENTATION: Record<AutoSyncState, { tone: ConnectionTone; key: string }> = {
  ENABLED_HEALTHY: { tone: "ok", key: "enabled_healthy" },
  ENABLED_DEGRADED: { tone: "warn", key: "enabled_degraded" },
  ENABLED_REAUTH_REQUIRED: { tone: "danger", key: "enabled_reauth_required" },
  DISABLED: { tone: "muted", key: "disabled" },
  NOT_CONFIGURED: { tone: "muted", key: "not_configured" },
};
