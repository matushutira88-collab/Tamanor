/**
 * Unit tests for the FAILED-migration recovery safety helpers (pure; no DB). Proves: only `rolled-back` is
 * accepted (never applied-marking), a migration is recovered only when genuinely failed + in the repo + not
 * already applied, and post-recovery it must be pending-not-failed-not-applied with no other failure remaining.
 * Run: pnpm production-prisma-migrate-recover:test
 */
import { validateRecoveryInputs, evaluateRecovery, evaluateRecoveryResult, MIGRATION_CONFIRMATION_PHRASE, RECOVERY_RESOLUTION } from "./production-prisma-migrate-recover";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const TARGET = "20260720090000_v1_58_5_rls_security_hardening";
const REPO = ["20260719000000_x", TARGET, "20260721000000_y"];
const OK_INPUTS = { environment: "production", targetMigration: TARGET, resolution: RECOVERY_RESOLUTION, confirmation: MIGRATION_CONFIRMATION_PHRASE };

function main() {
  console.log("\n1. input validation");
  check("★ valid inputs ok", validateRecoveryInputs(OK_INPUTS).ok);
  check("★ wrong environment rejected", !validateRecoveryInputs({ ...OK_INPUTS, environment: "staging" }).ok);
  check("★ wrong confirmation rejected", !validateRecoveryInputs({ ...OK_INPUTS, confirmation: "nope" }).ok);
  check("★ malformed failed_migration rejected", !validateRecoveryInputs({ ...OK_INPUTS, targetMigration: "not-a-migration" }).ok);
  check("★ resolution 'applied' REJECTED (only rolled-back permitted)", !validateRecoveryInputs({ ...OK_INPUTS, resolution: "applied" }).ok);
  check("★ resolution 'rolled-back' accepted", validateRecoveryInputs({ ...OK_INPUTS, resolution: "rolled-back" }).ok);

  console.log("\n2. recovery pre-check");
  const base = { repoMigrations: REPO, applied: ["20260719000000_x"] };
  check("★ target failed + in repo + not applied → OK", evaluateRecovery({ ...base, failed: [TARGET], targetMigration: TARGET }).ok);
  check("★ target NOT in failed state → REFUSE", !evaluateRecovery({ ...base, failed: [], targetMigration: TARGET }).ok);
  check("★ target already applied → REFUSE", !evaluateRecovery({ repoMigrations: REPO, applied: [TARGET], failed: [TARGET], targetMigration: TARGET }).ok);
  check("★ target not in repo → REFUSE", !evaluateRecovery({ ...base, failed: ["20261231000000_ghost"], targetMigration: "20261231000000_ghost" }).ok);

  console.log("\n3. post-recovery verification");
  check("★ not-failed + pending + not-applied → OK", evaluateRecoveryResult({ failed: [], applied: ["20260719000000_x"], pending: [TARGET, "20260721000000_y"], targetMigration: TARGET }).ok);
  check("★ still failed → REFUSE", !evaluateRecoveryResult({ failed: [TARGET], applied: [], pending: [TARGET], targetMigration: TARGET }).ok);
  check("★ unexpectedly applied → REFUSE", !evaluateRecoveryResult({ failed: [], applied: [TARGET], pending: [], targetMigration: TARGET }).ok);
  check("★ not pending after resolve → REFUSE", !evaluateRecoveryResult({ failed: [], applied: [], pending: [], targetMigration: TARGET }).ok);
  check("★ another failed migration remains → REFUSE", !evaluateRecoveryResult({ failed: ["20260721000000_y"], applied: [], pending: [TARGET], targetMigration: TARGET }).ok);

  console.log("\n4. constants");
  check("★ RECOVERY_RESOLUTION === 'rolled-back'", RECOVERY_RESOLUTION === "rolled-back");
  check("★ confirmation phrase == APPLY_ACCEPTED_PRODUCTION_MIGRATIONS", MIGRATION_CONFIRMATION_PHRASE === "APPLY_ACCEPTED_PRODUCTION_MIGRATIONS");
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — production-prisma-migrate-recover helpers: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
