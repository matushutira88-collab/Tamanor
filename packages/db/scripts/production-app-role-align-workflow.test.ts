/**
 * Static check of .github/workflows/production-app-role-align.yml — proves the app-role-align workflow is safe:
 * workflow_dispatch + main only, Environment "Production", BOTH DATABASE_URL (from PRODUCTION_DATABASE_URL) and
 * APP_DATABASE_URL (from its own secret) with a fail-closed empty-check on EACH, three arming inputs with
 * target_role locked to tamanor_app, a read-only preflight before the align, ALTER-ROLE-via-CLI ONLY (no
 * migrations / db push / migrate resolve / reset / bootstrap), no hardcoded URL, and neither secret is echoed.
 * Run: pnpm production-app-role-align-workflow:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const HERE = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(HERE, "..", "..", "..", ".github", "workflows", "production-app-role-align.yml"), "utf8");
// Strip `#` comment lines so checks apply to actual directives, not the descriptive header comment (which
// intentionally names the prohibited commands + the word "password").
const yml = raw.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

function main() {
  console.log("\nproduction-app-role-align workflow — static invariants");
  check("★ workflow_dispatch ONLY (no push / pull_request)", /workflow_dispatch:/.test(yml) && !/^\s*(push|pull_request):/m.test(yml));
  check("★ refuses any non-main ref", /refs\/heads\/main/.test(yml));
  check("★ Environment is exactly Production", /^\s*environment:\s*Production\s*$/m.test(yml) && !/^\s*environment:\s*production\s*$/m.test(yml));
  check("★ DATABASE_URL from secrets.PRODUCTION_DATABASE_URL", /DATABASE_URL:\s*\$\{\{\s*secrets\.PRODUCTION_DATABASE_URL\s*\}\}/.test(yml));
  check("★ APP_DATABASE_URL from secrets.APP_DATABASE_URL", /APP_DATABASE_URL:\s*\$\{\{\s*secrets\.APP_DATABASE_URL\s*\}\}/.test(yml));
  check("★ fail-closed empty-check on BOTH secrets", /if \[ -z "\$\{DATABASE_URL\}" \]/.test(yml) && /if \[ -z "\$\{APP_DATABASE_URL\}" \]/.test(yml) && /exit 1/.test(yml));
  check("★ neither secret echoed / no hardcoded connection string / no password literal", !/echo.*\$\{\{\s*secrets\./.test(yml) && !/postgres(ql)?:\/\//i.test(yml) && !/password\s*[:=]/i.test(yml));
  check("★ three arming inputs (environment, target_role, confirmation)", /environment:/.test(yml) && /target_role:/.test(yml) && /confirmation:/.test(yml));
  check("★ target_role locked to tamanor_app (choice)", /target_role:/.test(yml) && /options:\s*\n\s*-\s*tamanor_app/.test(yml));
  check("★ passes inputs to the CLI env (ALIGN_TARGET_ROLE, ALIGN_CONFIRMATION)", /ALIGN_TARGET_ROLE:\s*\$\{\{\s*inputs\.target_role\s*\}\}/.test(yml) && /ALIGN_CONFIRMATION:\s*\$\{\{\s*inputs\.confirmation\s*\}\}/.test(yml));
  check("★ read-only PREFLIGHT runs before the align", /production-app-role-align-preflight\.cli\.ts/.test(yml) && yml.indexOf("align-preflight.cli.ts") < yml.indexOf("align.cli.ts"));
  check("★ align performed via the CLI (ALTER ROLE lives in TS, not shell)", /production-app-role-align\.cli\.ts/.test(yml));
  check("★ NEVER migrations / db push / migrate resolve / reset / bootstrap", !/migrate deploy/.test(yml) && !/migrate dev/.test(yml) && !/migrate reset/.test(yml) && !/migrate resolve/.test(yml) && !/db push/.test(yml) && !/bootstrap/i.test(yml));
  check("★ no password interpolated in shell (no ALTER ROLE in a run: block)", !/ALTER ROLE/i.test(yml));
  check("★ concurrency guard shared with production-prisma-migrate (mutual exclusion)", /concurrency:/.test(yml) && /group:\s*production-prisma-migrate\s*$/m.test(yml) && /cancel-in-progress:\s*false/.test(yml));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — production-app-role-align workflow static check: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
