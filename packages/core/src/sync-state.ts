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
