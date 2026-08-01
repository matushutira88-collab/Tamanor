/**
 * BACKFILL VERIFY — regression for the dry-run-green-on-errors defect (F-cutover). `verifyBackfillRun` must FAIL
 * when `errors > 0` in BOTH dry-run and apply; a clean no-mutation dry-run passes.
 */
import { verifyBackfillRun, type BackfillResult, type ProviderCredentialInventory } from "../src/index";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const inv = (over: Partial<ProviderCredentialInventory> = {}): ProviderCredentialInventory => ({
  totalMetaAccounts: 21, legacyPopulated: 16, withActiveVault: 0, legacyAndVault: 0, legacyOnly: 16,
  vaultOnly: 0, neither: 5, legacyMatchesVault: 0, corruptVault: 0, vaultOnlyUnusable: 0, capped: false, ...over,
});
const run = (over: Partial<BackfillResult> = {}): BackfillResult => ({
  scanned: 16, skippedNoToken: 0, alreadyVaulted: 0, backfilled: 0, verified: 0, legacyCleared: 0,
  errors: 0, dryRun: true, nextCursor: null, ...over,
});

// ---- the incident: dry-run with 16 decryption errors must FAIL (was green) ---------------------------------
check("dry-run + 16 errors → FAIL", verifyBackfillRun(run({ dryRun: true, errors: 16 }), inv()).ok === false);
check("dry-run + 1 error → FAIL", verifyBackfillRun(run({ dryRun: true, errors: 1 }), inv()).ok === false);
check("dry-run + 0 errors + no mutation → PASS", verifyBackfillRun(run({ dryRun: true, errors: 0, backfilled: 0, legacyCleared: 0 }), inv()).ok === true);
check("dry-run with a mutation counter → FAIL", verifyBackfillRun(run({ dryRun: true, errors: 0, backfilled: 3 }), inv()).ok === false);
check("dry-run with legacyCleared > 0 → FAIL", verifyBackfillRun(run({ dryRun: true, errors: 0, legacyCleared: 1 }), inv()).ok === false);

// ---- apply-side invariants ---------------------------------------------------------------------------------
check("apply + errors → FAIL", verifyBackfillRun(run({ dryRun: false, errors: 2, verified: 5, legacyCleared: 5 }), inv()).ok === false);
check("apply clean → PASS", verifyBackfillRun(run({ dryRun: false, errors: 0, verified: 16, legacyCleared: 16 }), inv({ legacyOnly: 0, vaultOnly: 16, legacyPopulated: 0, withActiveVault: 16 })).ok === true);
check("apply + legacyCleared > verified → FAIL", verifyBackfillRun(run({ dryRun: false, errors: 0, verified: 3, legacyCleared: 5 }), inv()).ok === false);
check("apply + vaultOnlyUnusable > 0 → FAIL", verifyBackfillRun(run({ dryRun: false, errors: 0, verified: 5, legacyCleared: 5 }), inv({ vaultOnlyUnusable: 1 })).ok === false);

// the failure reason for errors is present + secret-free
const r = verifyBackfillRun(run({ dryRun: true, errors: 16 }), inv());
check("error failure is reported as a safe count reason", r.failures.some((f) => /error/.test(f)) && !r.failures.some((f) => /aesgcm|token|ciphertext/.test(f)));

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — backfill verify regression: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
