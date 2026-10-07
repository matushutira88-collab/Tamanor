/**
 * V1.69 (Release B / B1) — the canonical FIRST-SYNC state for a connected account, derived (pure) from
 * fields the sync engine already maintains. No new column: on success runReadOnlySync sets
 * `lastSuccessfulSyncAt` and resets `syncAttempts` to 0; on failure it increments `syncAttempts` and
 * records `lastError`. An active sync lease (expiresAt in the future) means a sync is in flight.
 *
 *   synced             — at least one successful sync has completed.
 *   syncing            — a sync is currently running (an unexpired lease is held).
 *   failed             — no successful sync yet, but at least one attempt has failed.
 *   waiting_first_sync — connected + monitored, no attempt has run yet.
 */
export type FirstSyncState = "waiting_first_sync" | "syncing" | "synced" | "failed";

export function deriveFirstSyncState(input: {
  lastSuccessfulSyncAt: Date | null;
  syncAttempts: number;
  hasActiveLease: boolean;
}): FirstSyncState {
  if (input.lastSuccessfulSyncAt) return "synced";
  if (input.hasActiveLease) return "syncing";
  if (input.syncAttempts > 0) return "failed";
  return "waiting_first_sync";
}

/** Whether a manual first-sync/retry trigger makes sense for this state (nothing running/succeeded). */
export function firstSyncRetryable(state: FirstSyncState): boolean {
  return state === "waiting_first_sync" || state === "failed";
}

/**
 * SLICE 3A — the truthful MONITORING state of a connected account, for accounts that are connected but
 * not (yet) monitored.
 *
 * Google Business locations are imported with `monitoringEnabled = false` on purpose: an import proves
 * the location exists, not that Tamanor can actually read its reviews. Monitoring is switched on only
 * after a real sync succeeds and the plan has room. That produces a state the UI previously had no way
 * to express — "connected, but we are not watching it, and here is honestly why".
 *
 *   monitored              — monitoring is on; the existing first-sync states describe it further.
 *   syncing                — the proving sync is running right now.
 *   waiting_first_sync     — connected, nothing attempted yet.
 *   first_sync_failed      — an attempt ran and failed, so monitoring was not switched on.
 *   monitoring_unavailable — a sync DID succeed, yet monitoring is still off. In practice this means the
 *                            plan's monitored-account limit was reached: the connection is kept, the
 *                            location stays imported, and nothing is silently enabled.
 */
export type AccountMonitoringState =
  | "monitored" | "syncing" | "waiting_first_sync" | "first_sync_failed" | "monitoring_unavailable";

export function deriveMonitoringState(input: {
  monitoringEnabled: boolean;
  lastSuccessfulSyncAt: Date | null;
  syncAttempts: number;
  hasActiveLease: boolean;
}): AccountMonitoringState {
  if (input.monitoringEnabled) return "monitored";
  if (input.hasActiveLease) return "syncing";
  // A successful sync with monitoring still off is the plan-limited case — never dressed up as healthy.
  if (input.lastSuccessfulSyncAt) return "monitoring_unavailable";
  if (input.syncAttempts > 0) return "first_sync_failed";
  return "waiting_first_sync";
}
