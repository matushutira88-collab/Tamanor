/**
 * V1.69 (Release B / B1) — PURE tests for the first-sync state machine (no DB). Proves the four states
 * derive correctly from the fields the sync engine maintains, and that retryability is correct.
 * Run: pnpm first-sync-state:test
 */
import { deriveFirstSyncState, firstSyncRetryable, type FirstSyncState } from "@guardora/core";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};
const d = (s: string) => new Date(s);

function run() {
  check("no attempt yet, monitored → waiting_first_sync",
    deriveFirstSyncState({ lastSuccessfulSyncAt: null, syncAttempts: 0, hasActiveLease: false }) === "waiting_first_sync");
  check("lease held, no success yet → syncing",
    deriveFirstSyncState({ lastSuccessfulSyncAt: null, syncAttempts: 0, hasActiveLease: true }) === "syncing");
  check("attempt failed, no success → failed",
    deriveFirstSyncState({ lastSuccessfulSyncAt: null, syncAttempts: 2, hasActiveLease: false }) === "failed");
  check("has a successful sync → synced (even with a lease held for a later run)",
    deriveFirstSyncState({ lastSuccessfulSyncAt: d("2026-07-20"), syncAttempts: 0, hasActiveLease: true }) === "synced");
  check("synced wins over a stale failed attempt count",
    deriveFirstSyncState({ lastSuccessfulSyncAt: d("2026-07-20"), syncAttempts: 3, hasActiveLease: false }) === "synced");
  check("syncing wins over a prior failed count (a retry is now running)",
    deriveFirstSyncState({ lastSuccessfulSyncAt: null, syncAttempts: 2, hasActiveLease: true }) === "syncing");

  const states: FirstSyncState[] = ["waiting_first_sync", "syncing", "synced", "failed"];
  check("retryable only for waiting_first_sync and failed",
    states.filter(firstSyncRetryable).sort().join(",") === "failed,waiting_first_sync",
    states.filter(firstSyncRetryable).join(","));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — first-sync state machine (V1.69 B1): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
