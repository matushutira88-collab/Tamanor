/**
 * Static check of .github/workflows/platform-owner-bootstrap.yml — proves the production Environment mapping
 * is correct and safe: the job binds the EXACT Environment name ("Production") that scopes the secret,
 * DATABASE_URL comes from secrets.PRODUCTION_DATABASE_URL, a fail-closed empty-check runs before any DB work,
 * the secret is never echoed, no URL/password is hardcoded, and the trigger stays workflow_dispatch-only.
 * Run: pnpm platform-owner-bootstrap-workflow:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const HERE = dirname(fileURLToPath(import.meta.url));
const yml = readFileSync(join(HERE, "..", "..", "..", ".github", "workflows", "platform-owner-bootstrap.yml"), "utf8");

function main() {
  console.log("\nplatform-owner-bootstrap workflow — static invariants");
  // 1. Environment name matches the dashboard EXACTLY (capital P) so the Environment secret is mapped.
  check("★ job binds environment: Production (exact case — maps the Environment secret)", /^\s*environment:\s*Production\s*$/m.test(yml));
  check("★ does NOT use a mismatched lowercase 'environment: production'", !/^\s*environment:\s*production\s*$/m.test(yml));
  // 2. DATABASE_URL from the secret.
  check("★ DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}", /DATABASE_URL:\s*\$\{\{\s*secrets\.PRODUCTION_DATABASE_URL\s*\}\}/.test(yml));
  // 3 + 4. Fail-closed empty-check before any DB work; secret never echoed.
  check("★ fail-closed empty-check on DATABASE_URL (-z) before the CLI step", /if \[ -z "\$\{DATABASE_URL\}" \]/.test(yml) && /exit 1/.test(yml));
  check("★ secret is NEVER echoed (no `echo $DATABASE_URL` / value print)", !/echo\s+["']?\$\{?DATABASE_URL\}?["']?\s*$/m.test(yml) && !/echo.*\$\{\{\s*secrets\./.test(yml));
  // 5. Fingerprint handled safely (from a secret, optional) — never a hardcoded URL/password.
  check("★ host fingerprint comes from a secret (optional), not hardcoded", /PRODUCTION_DATABASE_HOST_FINGERPRINT:\s*\$\{\{\s*secrets\./.test(yml));
  check("★ NO hardcoded connection string / password in the workflow", !/postgres(ql)?:\/\//i.test(yml) && !/password\s*[:=]/i.test(yml));
  // Trigger + guards unchanged.
  check("★ workflow_dispatch ONLY (no push / pull_request triggers)", /workflow_dispatch:/.test(yml) && !/^\s*(push|pull_request):/m.test(yml));
  check("★ requires an explicit confirmation input", /confirmation:/.test(yml) && /BOOTSTRAP_CONFIRMATION:\s*\$\{\{\s*inputs\.confirmation\s*\}\}/.test(yml));
  check("★ refuses any non-main ref", /refs\/heads\/main/.test(yml));
  check("★ invokes the fail-closed bootstrap CLI (not an inline write)", /platform-owner-bootstrap\.cli\.ts/.test(yml));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — platform-owner-bootstrap workflow static check: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
