/**
 * Static check of .github/workflows/production-prisma-migrate.yml — proves the GENERIC production migration
 * workflow is safe: workflow_dispatch + main only, Environment "Production", DATABASE_URL from the secret with
 * a fail-closed empty-check, three arming inputs, a read-only preflight before deploy, `prisma migrate deploy`
 * ONLY (no migrate dev/reset/db push), a post-deploy verify, no hardcoded URL, and the secret is never echoed.
 * Run: pnpm production-prisma-migrate-workflow:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const HERE = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(HERE, "..", "..", "..", ".github", "workflows", "production-prisma-migrate.yml"), "utf8");
// Strip `#` comment lines so checks apply to actual directives, not the descriptive header comment (which
// intentionally names the prohibited commands + mentions the deploy step).
const yml = raw.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

function main() {
  console.log("\nproduction-prisma-migrate workflow — static invariants");
  check("★ workflow_dispatch ONLY (no push / pull_request)", /workflow_dispatch:/.test(yml) && !/^\s*(push|pull_request):/m.test(yml));
  check("★ refuses any non-main ref", /refs\/heads\/main/.test(yml));
  check("★ Environment is exactly Production (maps the Environment secret)", /^\s*environment:\s*Production\s*$/m.test(yml) && !/^\s*environment:\s*production\s*$/m.test(yml));
  check("★ DATABASE_URL from secrets.PRODUCTION_DATABASE_URL", /DATABASE_URL:\s*\$\{\{\s*secrets\.PRODUCTION_DATABASE_URL\s*\}\}/.test(yml));
  check("★ fail-closed empty-check on DATABASE_URL before any DB work", /if \[ -z "\$\{DATABASE_URL\}" \]/.test(yml) && /exit 1/.test(yml));
  check("★ secret NEVER echoed / no hardcoded connection string", !/echo.*\$\{\{\s*secrets\./.test(yml) && !/postgres(ql)?:\/\//i.test(yml) && !/password\s*[:=]/i.test(yml));
  check("★ three arming inputs (environment, expected_last_migration, confirmation)", /environment:/.test(yml) && /expected_last_migration:/.test(yml) && /confirmation:/.test(yml));
  check("★ passes inputs to the CLI env (EXPECTED_LAST_MIGRATION, MIGRATE_CONFIRMATION)", /EXPECTED_LAST_MIGRATION:\s*\$\{\{\s*inputs\.expected_last_migration\s*\}\}/.test(yml) && /MIGRATE_CONFIRMATION:\s*\$\{\{\s*inputs\.confirmation\s*\}\}/.test(yml));
  check("★ read-only PREFLIGHT runs before deploy", /production-prisma-migrate-preflight\.cli\.ts/.test(yml) && yml.indexOf("preflight.cli.ts") < yml.indexOf("prisma migrate deploy"));
  check("★ applies ONLY `prisma migrate deploy`", /prisma migrate deploy/.test(yml));
  check("★ NEVER migrate dev / reset / db push / ad-hoc SQL", !/migrate dev/.test(yml) && !/migrate reset/.test(yml) && !/db push/.test(yml));
  check("★ post-deploy VERIFY runs after deploy", /production-prisma-migrate-verify\.cli\.ts/.test(yml) && yml.indexOf("verify.cli.ts") > yml.indexOf("prisma migrate deploy"));
  check("★ concurrency guard (no two production migrations at once)", /concurrency:/.test(yml) && /cancel-in-progress:\s*false/.test(yml));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — production-prisma-migrate workflow static check: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
