/**
 * Bounded key → tone mappings for Accounts.
 *
 * Pure and dictionary-free: the LABEL always comes from i18n; this file only says
 * which tone reinforces it. Tone is never the sole carrier of meaning.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE GREEN RULE. `CONNECTED_HEALTHY` is the ONLY connection state that may be
 * styled as a success, because it is the only one the canonical resolver returns
 * when the connection is genuinely healthy AND a sync has actually succeeded.
 *
 * Monitoring, auto-sync and capability have their OWN tones and are never allowed
 * to upgrade the connection's. A reconnect-required account with monitoring on
 * still reads as a problem.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type {
  AccountCapabilities, AccountPlatform, AutoSyncState, CapabilityState,
  ConnectedAccountItem, ConnectionState, FirstSyncState, SyncRunStatus, TokenHealth,
} from "@/api/types";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger";

/** Own-property lookup: `__proto__` must not resolve to an inherited member. */
const total = <K extends string>(map: Record<K, Tone>, key: K | string): Tone =>
  Object.prototype.hasOwnProperty.call(map, key) ? (map as Record<string, Tone>)[key]! : "neutral";

/**
 * Connection tones, mirroring `CONNECTION_STATE_PRESENTATION` in @guardora/core.
 * Exactly one entry is `success`.
 */
const CONNECTION_TONE: Record<ConnectionState, Tone> = {
  CONNECTED_HEALTHY: "success",
  WAITING_FIRST_SYNC: "warning",
  DEGRADED: "warning",
  SYNC_FAILED: "danger",
  REAUTH_REQUIRED: "danger",
  DISCONNECTED: "danger",
};

const AUTO_SYNC_TONE: Record<AutoSyncState, Tone> = {
  ENABLED_HEALTHY: "success",
  ENABLED_DEGRADED: "warning",
  ENABLED_REAUTH_REQUIRED: "danger",
  DISABLED: "neutral",
  NOT_CONFIGURED: "neutral",
};

/** A never-synced account is WAITING, not failing — it must not read as an error. */
const FIRST_SYNC_TONE: Record<FirstSyncState, Tone> = {
  waiting_first_sync: "neutral",
  syncing: "brand",
  synced: "success",
  failed: "danger",
};

const TOKEN_HEALTH_TONE: Record<TokenHealth, Tone> = {
  unknown: "neutral",
  ok: "success",
  expiring_soon: "warning",
  expired: "danger",
  invalid: "danger",
  revoked: "danger",
};

const CAPABILITY_TONE: Record<CapabilityState, Tone> = {
  available: "success",
  unavailable: "neutral",
  not_implemented: "neutral",
  not_configured: "neutral",
  missing_permission: "warning",
  requires_web: "brand",
  blocked_by_safety: "warning",
};

const SYNC_RUN_TONE: Record<SyncRunStatus, Tone> = {
  running: "brand",
  completed: "success",
  partial_success: "warning",
  failed: "danger",
  skipped_locked: "neutral",
  disconnected: "danger",
  permission_missing: "danger",
  rate_limited: "warning",
  api_unavailable: "warning",
  interrupted: "warning",
};

export const connectionTone = (v: ConnectionState | string): Tone => total(CONNECTION_TONE, v);
export const autoSyncTone = (v: AutoSyncState | string): Tone => total(AUTO_SYNC_TONE, v);
export const firstSyncTone = (v: FirstSyncState | string): Tone => total(FIRST_SYNC_TONE, v);
export const tokenHealthTone = (v: TokenHealth | string): Tone => total(TOKEN_HEALTH_TONE, v);
export const capabilityTone = (v: CapabilityState | string): Tone => total(CAPABILITY_TONE, v);
export const syncRunTone = (v: SyncRunStatus | string): Tone => total(SYNC_RUN_TONE, v);

/** Monitoring is a plain on/off fact — never green just because it is on. */
export const monitoringTone = (enabled: boolean): Tone => (enabled ? "brand" : "neutral");

/**
 * Whether the account should be highlighted as needing the user's attention.
 *
 * Driven ONLY by the canonical connection state. Monitoring being off is a choice,
 * not a problem, and must never raise an alarm.
 */
export function needsAttention(account: Pick<ConnectedAccountItem, "connectionState">): boolean {
  return account.connectionState !== "CONNECTED_HEALTHY";
}

/** Whether to offer the reconnect hand-off. */
export function shouldOfferReconnect(
  account: Pick<ConnectedAccountItem, "connectionState" | "capabilities">,
): boolean {
  const problem = account.connectionState === "REAUTH_REQUIRED" || account.connectionState === "DISCONNECTED";
  return problem && account.capabilities.canReconnect !== "missing_permission";
}

/** Whether the Sync-now control is actionable right now. */
export function canTriggerSync(account: Pick<ConnectedAccountItem, "capabilities">): boolean {
  return account.capabilities.canSync === "available";
}

/** Whether the monitoring switch may be moved in the requested direction. */
export function canToggleMonitoring(
  account: Pick<ConnectedAccountItem, "capabilities" | "monitoringEnabled" | "monitoringCanBeEnabled">,
): boolean {
  if (account.capabilities.canMonitor !== "available") return false;
  // Turning monitoring OFF is always allowed; turning it ON is capacity-gated.
  return account.monitoringEnabled || account.monitoringCanBeEnabled;
}

/** A capability worth showing at all — `not_configured` is internal noise. */
export function shouldShowCapability(state: CapabilityState | string): boolean {
  return state !== "not_configured";
}

/**
 * The four truths, deliberately kept apart.
 *
 * A screen renders four labelled facts. `overallHealthy` exists ONLY so a summary
 * can count problems; it is not a status to display, and it is derived from the
 * connection alone — never from monitoring or auto-sync.
 */
export interface AccountTruths {
  connection: ConnectionState;
  monitoring: boolean;
  autoSync: AutoSyncState;
  capabilities: AccountCapabilities;
  overallHealthy: boolean;
}

export function accountTruths(account: ConnectedAccountItem): AccountTruths {
  return {
    connection: account.connectionState,
    monitoring: account.monitoringEnabled,
    autoSync: account.autoSyncState,
    capabilities: account.capabilities,
    // Deliberately connection-only: monitoring and auto-sync cannot make a broken
    // connection read as healthy, and cannot make a healthy one read as broken.
    overallHealthy: account.connectionState === "CONNECTED_HEALTHY",
  };
}

/** Platform display fallback — the SERVER's label is authoritative. */
export function displayPlatform(account: Pick<ConnectedAccountItem, "platform" | "platformLabel">): string {
  return account.platformLabel || fallbackPlatformLabel(account.platform);
}

/**
 * Last-resort label if the server ever omits one. There is no two-way conditional:
 * an unrecognized platform gets a generic label, never "Facebook".
 */
const FALLBACK_LABELS: Record<string, string> = {
  facebook_page: "Facebook Page",
  instagram_business: "Instagram Business",
  youtube: "YouTube",
  linkedin_company: "LinkedIn Company Page",
  tiktok: "TikTok",
  google_business: "Google Business Profile",
};
export function fallbackPlatformLabel(platform: AccountPlatform | string): string {
  return Object.prototype.hasOwnProperty.call(FALLBACK_LABELS, platform)
    ? FALLBACK_LABELS[platform]!
    : "Connected account";
}
