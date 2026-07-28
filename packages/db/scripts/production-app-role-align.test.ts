/**
 * Unit tests for the app-role-align safety helpers (pure; no DB). Proves the URL parsers (role + percent-decoded
 * password) and the fail-closed target evaluation: both URLs mandatory, app URL must be tamanor_app, owner must
 * be a DIFFERENT role, both on the SAME host (and matching an expected fingerprint), and a parseable password.
 * All URLs below are FAKE fixtures — no real credentials. Run: pnpm production-app-role-align:test
 */
import { createHash } from "node:crypto";
import { parseDbRole, parseDbPassword, validateAlignInputs, evaluateAlignTargets, ALIGN_CONFIRMATION_PHRASE, TARGET_ROLE } from "./production-app-role-align";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

// Fake, non-secret test fixtures.
const HOST = "db.fixture.example.com";
const OWNER = `postgresql://postgres:ownerpw@${HOST}:5432/app`;
const APP = `postgresql://tamanor_app:apppw@${HOST}:5432/app`;
const APP_OTHER_HOST = `postgresql://tamanor_app:apppw@other.fixture.example.com:5432/app`;
const APP_NO_PW = `postgresql://tamanor_app@${HOST}:5432/app`;
const APP_ENCODED = `postgresql://tamanor_app:p%40ss%3Aword@${HOST}:5432/app`; // → "p@ss:word"
const APP_SAME_ROLE = `postgresql://postgres:x@${HOST}:5432/app`;
const FP = createHash("sha256").update(HOST).digest("hex").slice(0, 16);
const OK_INPUTS = { environment: "production", targetRole: TARGET_ROLE, confirmation: ALIGN_CONFIRMATION_PHRASE };

function main() {
  console.log("\n1. URL parsers (never leak the password elsewhere)");
  check("★ parseDbRole extracts the username", parseDbRole(APP) === "tamanor_app");
  check("★ parseDbRole owner", parseDbRole(OWNER) === "postgres");
  check("★ parseDbRole null on missing user", parseDbRole(`postgresql://${HOST}:5432/app`) === null);
  check("★ parseDbRole null on garbage", parseDbRole("not-a-url") === null);
  check("★ parseDbPassword extracts the password", parseDbPassword(APP) === "apppw");
  check("★ parseDbPassword percent-decodes", parseDbPassword(APP_ENCODED) === "p@ss:word");
  check("★ parseDbPassword null when absent", parseDbPassword(APP_NO_PW) === null);

  console.log("\n2. input validation");
  check("★ valid inputs ok", validateAlignInputs(OK_INPUTS).ok);
  check("★ wrong environment rejected", !validateAlignInputs({ ...OK_INPUTS, environment: "staging" }).ok);
  check("★ wrong target_role rejected (only tamanor_app)", !validateAlignInputs({ ...OK_INPUTS, targetRole: "postgres" }).ok);
  check("★ wrong confirmation rejected", !validateAlignInputs({ ...OK_INPUTS, confirmation: "nope" }).ok);

  console.log("\n3. target evaluation (fail-closed)");
  check("★ owner + tamanor_app on same host → OK", evaluateAlignTargets({ ownerUrl: OWNER, appUrl: APP }).ok);
  check("★ owner + tamanor_app + matching fingerprint → OK", evaluateAlignTargets({ ownerUrl: OWNER, appUrl: APP, expectedFingerprint: FP }).ok);
  check("★ missing APP_DATABASE_URL → REFUSE", !evaluateAlignTargets({ ownerUrl: OWNER, appUrl: undefined }).ok);
  check("★ missing DATABASE_URL → REFUSE", !evaluateAlignTargets({ ownerUrl: undefined, appUrl: APP }).ok);
  check("★ app role is NOT tamanor_app → REFUSE", !evaluateAlignTargets({ ownerUrl: OWNER, appUrl: APP_SAME_ROLE }).ok);
  check("★ owner and app SAME role → REFUSE", !evaluateAlignTargets({ ownerUrl: APP, appUrl: APP }).ok);
  check("★ different hosts → REFUSE", !evaluateAlignTargets({ ownerUrl: OWNER, appUrl: APP_OTHER_HOST }).ok);
  check("★ fingerprint mismatch → REFUSE", !evaluateAlignTargets({ ownerUrl: OWNER, appUrl: APP, expectedFingerprint: "deadbeefdeadbeef" }).ok);
  check("★ app URL without a password → REFUSE", !evaluateAlignTargets({ ownerUrl: OWNER, appUrl: APP_NO_PW }).ok);

  console.log("\n4. non-sensitive facts only");
  const r = evaluateAlignTargets({ ownerUrl: OWNER, appUrl: APP });
  check("★ reports role names + fingerprint, no URL/password", r.ownerRole === "postgres" && r.appRole === "tamanor_app" && r.fingerprint === FP);

  console.log("\n5. constants");
  check("★ ALIGN_CONFIRMATION_PHRASE === 'ALIGN_PRODUCTION_APP_ROLE'", ALIGN_CONFIRMATION_PHRASE === "ALIGN_PRODUCTION_APP_ROLE");
  check("★ TARGET_ROLE === 'tamanor_app'", TARGET_ROLE === "tamanor_app");
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — production-app-role-align helpers: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
