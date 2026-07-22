/**
 * V1.75 (P0) — PURE unit tests for the ONE server-authoritative connection-state resolver
 * (@guardora/core connection-state). No DB, no network, injected clock. Proves the truthfulness
 * contract the P0 hotfix is about: an expired/revoked/needs-reconnect account is REAUTH_REQUIRED
 * (never green); a disconnected account is DISCONNECTED (never green); a transient degrade is
 * DEGRADED; a real failed sync is SYNC_FAILED; CONNECTED_HEALTHY (the ONLY green state) requires a
 * genuine prior success; manual sync is blocked on reauth/disconnect; the auto-sync state is
 * config-driven (a fresh cron timestamp never flips it on) and never both "disabled" and "running".
 *
 * Run: pnpm connection-state:test
 */
import {
  resolveConnectionState, resolveAutoSyncState, manualSyncBlocked, connectionIsHealthy,
  CONNECTION_STATE_PRESENTATION, AUTO_SYNC_STATE_PRESENTATION,
  type ConnectionStateInput, type ConnectionState, type AutoSyncState,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const NOW = new Date("2026-07-22T12:00:00.000Z");
const PAST = new Date("2026-07-20T12:00:00.000Z");
const FUTURE = new Date("2026-08-22T12:00:00.000Z");

/** A real, connected, healthy, synced account — the ONLY shape that may be green. */
const healthy = (over: Partial<ConnectionStateInput> = {}): ConnectionStateInput => ({
  status: "active", mode: "read_only", health: "healthy", connectionStatus: "connected", tokenHealth: "ok",
  tokenExpiresAt: FUTURE, lastError: null, lastSuccessfulSyncAt: PAST, lastSyncedAt: PAST, monitoringEnabled: true, ...over,
});
const rc = (over: Partial<ConnectionStateInput>) => resolveConnectionState(healthy(over), NOW);
const ra = (over: Partial<ConnectionStateInput>) => resolveAutoSyncState(healthy(over), NOW);

function run() {
  // ---- Connection state matrix ----
  check("healthy synced account → CONNECTED_HEALTHY (the only green)", rc({}) === "CONNECTED_HEALTHY");
  check("only CONNECTED_HEALTHY is presented as green (ok tone)",
    CONNECTION_STATE_PRESENTATION.CONNECTED_HEALTHY.tone === "ok" &&
    (["WAITING_FIRST_SYNC", "DEGRADED", "REAUTH_REQUIRED", "SYNC_FAILED", "DISCONNECTED"] as ConnectionState[]).every((s) => CONNECTION_STATE_PRESENTATION[s].tone !== "ok"));

  // Expired token — every signalling shape must land on REAUTH_REQUIRED.
  check("expired tokenHealth → REAUTH_REQUIRED", rc({ tokenHealth: "expired" }) === "REAUTH_REQUIRED");
  check("expired via tokenExpiresAt in the past → REAUTH_REQUIRED", rc({ tokenHealth: "ok", tokenExpiresAt: PAST }) === "REAUTH_REQUIRED");
  check("status=expired → REAUTH_REQUIRED", rc({ status: "expired" }) === "REAUTH_REQUIRED");
  check("connectionStatus=needs_reconnect → REAUTH_REQUIRED", rc({ connectionStatus: "needs_reconnect" }) === "REAUTH_REQUIRED");
  check("lastError=token_expired → REAUTH_REQUIRED", rc({ lastError: "token_expired" }) === "REAUTH_REQUIRED");

  // Revoked / invalid token → REAUTH_REQUIRED.
  check("revoked tokenHealth → REAUTH_REQUIRED", rc({ tokenHealth: "revoked" }) === "REAUTH_REQUIRED");
  check("invalid tokenHealth → REAUTH_REQUIRED", rc({ tokenHealth: "invalid" }) === "REAUTH_REQUIRED");
  check("connectionStatus=invalid_token → REAUTH_REQUIRED", rc({ connectionStatus: "invalid_token" }) === "REAUTH_REQUIRED");
  check("connectionStatus=missing_permission → REAUTH_REQUIRED", rc({ connectionStatus: "missing_permission" }) === "REAUTH_REQUIRED");

  // Reauth WINS over a degraded health (the sync engine sets health=degraded on a reconnect failure).
  check("reauth beats degraded health (token expired + health degraded → REAUTH_REQUIRED)", rc({ tokenHealth: "expired", health: "degraded" }) === "REAUTH_REQUIRED");

  // Disconnected — never green.
  check("status=disconnected → DISCONNECTED", rc({ status: "disconnected" }) === "DISCONNECTED");
  check("connectionStatus=disconnected → DISCONNECTED", rc({ connectionStatus: "disconnected" }) === "DISCONNECTED");
  check("disconnected is NOT healthy", !connectionIsHealthy(rc({ status: "disconnected" })));

  // Sync failure vs never-synced.
  check("health=error WITH a prior attempt → SYNC_FAILED", rc({ health: "error", lastSuccessfulSyncAt: null, lastSyncedAt: PAST }) === "SYNC_FAILED");
  check("health=error WITH a prior success → SYNC_FAILED", rc({ health: "error", lastSuccessfulSyncAt: PAST, lastSyncedAt: null }) === "SYNC_FAILED");
  check("health=error but NEVER synced/attempted → WAITING_FIRST_SYNC (not a failure yet)", rc({ health: "error", lastSuccessfulSyncAt: null, lastSyncedAt: null }) === "WAITING_FIRST_SYNC");

  // Transient degradation.
  check("health=degraded (transient) → DEGRADED", rc({ health: "degraded" }) === "DEGRADED");

  // Waiting first sync.
  check("connected, no successful sync yet → WAITING_FIRST_SYNC", rc({ health: "unknown", lastSuccessfulSyncAt: null, lastSyncedAt: null }) === "WAITING_FIRST_SYNC");

  // ---- Last ATTEMPT vs last SUCCESS are never conflated ----
  check("attempt set but NO success + healthy → WAITING_FIRST_SYNC (attempt ≠ success)", rc({ health: "healthy", lastSuccessfulSyncAt: null, lastSyncedAt: NOW }) === "WAITING_FIRST_SYNC");
  check("both success + attempt + healthy → CONNECTED_HEALTHY", rc({ health: "healthy", lastSuccessfulSyncAt: PAST, lastSyncedAt: NOW }) === "CONNECTED_HEALTHY");

  // ---- Manual sync blocking ----
  check("manual sync BLOCKED when REAUTH_REQUIRED", manualSyncBlocked(rc({ tokenHealth: "expired" })));
  check("manual sync BLOCKED when DISCONNECTED", manualSyncBlocked(rc({ status: "disconnected" })));
  check("manual sync ALLOWED when CONNECTED_HEALTHY", !manualSyncBlocked(rc({})));
  check("manual sync ALLOWED when DEGRADED (transient, retryable)", !manualSyncBlocked(rc({ health: "degraded" })));
  check("manual sync ALLOWED when SYNC_FAILED (a retry is legitimate)", !manualSyncBlocked(rc({ health: "error", lastSyncedAt: PAST })));

  // ---- Auto-sync state ----
  check("monitoring OFF (config) → DISABLED", ra({ monitoringEnabled: false }) === "DISABLED");
  check("enabled + healthy → ENABLED_HEALTHY (the only 'running' state)", ra({ monitoringEnabled: true }) === "ENABLED_HEALTHY");
  check("enabled + expired token → ENABLED_REAUTH_REQUIRED (never 'disabled')", ra({ monitoringEnabled: true, tokenHealth: "expired" }) === "ENABLED_REAUTH_REQUIRED");
  check("enabled + degraded → ENABLED_DEGRADED", ra({ monitoringEnabled: true, health: "degraded" }) === "ENABLED_DEGRADED");
  check("enabled + failed sync → ENABLED_DEGRADED", ra({ monitoringEnabled: true, health: "error", lastSyncedAt: PAST }) === "ENABLED_DEGRADED");
  check("test/mock account → NOT_CONFIGURED", ra({ status: "mock_connected", mode: "placeholder" }) === "NOT_CONFIGURED");
  check("disconnected → NOT_CONFIGURED", ra({ status: "disconnected" }) === "NOT_CONFIGURED");
  check("only ENABLED_HEALTHY is 'ok' tone (the only 'running' UI)",
    AUTO_SYNC_STATE_PRESENTATION.ENABLED_HEALTHY.tone === "ok" &&
    (["ENABLED_DEGRADED", "ENABLED_REAUTH_REQUIRED", "DISABLED", "NOT_CONFIGURED"] as AutoSyncState[]).every((s) => AUTO_SYNC_STATE_PRESENTATION[s].tone !== "ok"));

  // ---- The UI can NEVER simultaneously show "disabled" and "running": one state only ----
  const disabledState = ra({ monitoringEnabled: false });
  check("a disabled account resolves to EXACTLY one auto-sync state (DISABLED, not running)",
    disabledState === "DISABLED" && (disabledState as AutoSyncState) !== "ENABLED_HEALTHY");

  // ---- A fresh cron ATTEMPT timestamp must NOT flip the config-enabled flag ----
  const disabledStale = resolveAutoSyncState(healthy({ monitoringEnabled: false, lastSyncedAt: null }), NOW);
  const disabledFresh = resolveAutoSyncState(healthy({ monitoringEnabled: false, lastSyncedAt: NOW }), NOW);
  check("a fresh cron attempt timestamp does NOT change DISABLED → stays DISABLED", disabledStale === "DISABLED" && disabledFresh === "DISABLED");
  const enabledStale = resolveAutoSyncState(healthy({ monitoringEnabled: true, lastSyncedAt: null, lastSuccessfulSyncAt: null }), NOW);
  const enabledFresh = resolveAutoSyncState(healthy({ monitoringEnabled: true, lastSyncedAt: NOW, lastSuccessfulSyncAt: null }), NOW);
  check("auto-sync enabled-state depends on config, not on the attempt timestamp", enabledStale === enabledFresh);

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — connection-state resolver (V1.75): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
