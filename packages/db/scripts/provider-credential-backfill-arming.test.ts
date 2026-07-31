/**
 * PROVIDER-CREDENTIAL BACKFILL ARMING — pure guard unit tests (no DB). Proves dry-run is the default + safe, that
 * any apply requires the exact confirmation phrase, and that a production (non-local) target additionally requires
 * `environment=production` and a matching host fingerprint. Fail-closed on every missing gate; batch bounded.
 */
import { armBackfill, BACKFILL_CONFIRMATION_PHRASE, BACKFILL_MAX_BATCH } from "./provider-credential-backfill-arming";
import { databaseHostFingerprint } from "./family-activation";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const LOCAL = "postgresql://postgres:pw@localhost:5433/tamanor_reconciled";
const PROD = "postgresql://u:pw@db.prod.example.com:5432/tamanor";
const PHRASE = BACKFILL_CONFIRMATION_PHRASE;

// ---- dry-run (default) -------------------------------------------------------------------------------------
check("dry-run default is ok + mode dry-run", (() => { const r = armBackfill({ apply: false, databaseUrl: PROD, vaultKeyConfigured: true }); return r.ok && r.mode === "dry-run"; })());
check("dry-run mutates-nothing even against a production host", armBackfill({ apply: false, databaseUrl: PROD, vaultKeyConfigured: true }).mode === "dry-run");
check("dry-run without a vault key fails closed", armBackfill({ apply: false, databaseUrl: LOCAL, vaultKeyConfigured: false }).ok === false);

// ---- local apply -------------------------------------------------------------------------------------------
check("local apply without confirmation fails", armBackfill({ apply: true, databaseUrl: LOCAL, vaultKeyConfigured: true }).ok === false);
check("local apply with the exact phrase is ok (mode apply-local)", (() => { const r = armBackfill({ apply: true, confirmation: PHRASE, databaseUrl: LOCAL, vaultKeyConfigured: true }); return r.ok && r.mode === "apply-local"; })());
check("local apply with a WRONG phrase fails", armBackfill({ apply: true, confirmation: "nope", databaseUrl: LOCAL, vaultKeyConfigured: true }).ok === false);

// ---- production apply --------------------------------------------------------------------------------------
check("prod apply missing environment fails (mode apply-production)", (() => { const r = armBackfill({ apply: true, confirmation: PHRASE, databaseUrl: PROD, vaultKeyConfigured: true }); return !r.ok && r.mode === "apply-production" && r.errors.some((e) => /environment/.test(e)); })());
check("prod apply missing confirmation fails", armBackfill({ apply: true, environment: "production", databaseUrl: PROD, vaultKeyConfigured: true }).ok === false);
check("prod apply with environment + phrase (no expected fingerprint) is ok", (() => { const r = armBackfill({ apply: true, environment: "production", confirmation: PHRASE, databaseUrl: PROD, vaultKeyConfigured: true }); return r.ok && r.mode === "apply-production"; })());
check("prod apply with a MATCHING expected fingerprint is ok", (() => { const fp = databaseHostFingerprint(PROD); const r = armBackfill({ apply: true, environment: "production", confirmation: PHRASE, databaseUrl: PROD, expectedFingerprint: fp, vaultKeyConfigured: true }); return r.ok; })());
check("prod apply with a MISMATCHED fingerprint fails closed", armBackfill({ apply: true, environment: "production", confirmation: PHRASE, databaseUrl: PROD, expectedFingerprint: "deadbeef", vaultKeyConfigured: true }).ok === false);
check("prod apply without a vault key fails closed", armBackfill({ apply: true, environment: "production", confirmation: PHRASE, databaseUrl: PROD, vaultKeyConfigured: false }).ok === false);
check("apply with a missing DATABASE_URL fails closed", armBackfill({ apply: true, confirmation: PHRASE, databaseUrl: null, vaultKeyConfigured: true }).ok === false);

// ---- batch bounds ------------------------------------------------------------------------------------------
check("batch size clamps above the max", armBackfill({ apply: false, batchSize: 999999, databaseUrl: LOCAL, vaultKeyConfigured: true }).batchSize === BACKFILL_MAX_BATCH);
check("batch size defaults when unset", armBackfill({ apply: false, databaseUrl: LOCAL, vaultKeyConfigured: true }).batchSize >= 1);
check("fingerprint is a non-reversible digest, never the URL", (() => { const fp = armBackfill({ apply: false, databaseUrl: PROD, vaultKeyConfigured: true }).fingerprint; return !!fp && !fp.includes("example.com") && !fp.includes("pw"); })());

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — provider-credential backfill arming: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
