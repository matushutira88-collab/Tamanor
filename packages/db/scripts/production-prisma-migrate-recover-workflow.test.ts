/**
 * Static check of .github/workflows/production-prisma-migrate-recover.yml — proves the FAILED-migration recovery
 * workflow is safe: workflow_dispatch + main only, Environment "Production", DATABASE_URL from the secret with a
 * fail-closed empty-check, four arming inputs, a read-only preflight before the resolve, `prisma migrate resolve
 * --rolled-back` ONLY (no deploy / dev / reset / db-push / applied-marking / ad-hoc SQL), a post-resolve verify,
 * no hardcoded URL, and the secret is never echoed.
 * Run: pnpm production-prisma-migrate-recover-workflow:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const HERE = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(HERE, "..", "..", "..", ".github", "workflows", "production-prisma-migrate-recover.yml"), "utf8");
// Strip `#` comment lines so checks apply to actual directives, not the descriptive header comment (which
// intentionally names the prohibited commands).
const yml = raw.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

function main() {
  console.log("\nproduction-prisma-migrate-recover workflow — static invariants");
  check("★ workflow_dispatch ONLY (no push / pull_request)", /workflow_dispatch:/.test(yml) && !/^\s*(push|pull_request):/m.test(yml));
  check("★ refuses any non-main ref", /refs\/heads\/main/.test(yml));
  check("★ Environment is exactly Production (maps the Environment secret)", /^\s*environment:\s*Production\s*$/m.test(yml) && !/^\s*environment:\s*production\s*$/m.test(yml));
  check("★ DATABASE_URL from secrets.PRODUCTION_DATABASE_URL", /DATABASE_URL:\s*\$\{\{\s*secrets\.PRODUCTION_DATABASE_URL\s*\}\}/.test(yml));
  check("★ fail-closed empty-check on DATABASE_URL before any DB work", /if \[ -z "\$\{DATABASE_URL\}" \]/.test(yml) && /exit 1/.test(yml));
  check("★ secret NEVER echoed / no hardcoded connection string", !/echo.*\$\{\{\s*secrets\./.test(yml) && !/postgres(ql)?:\/\//i.test(yml) && !/password\s*[:=]/i.test(yml));
  check("★ four arming inputs (environment, failed_migration, resolution, confirmation)", /environment:/.test(yml) && /failed_migration:/.test(yml) && /resolution:/.test(yml) && /confirmation:/.test(yml));
  check("★ passes inputs to the CLI env (RECOVER_TARGET, RECOVER_RESOLUTION, MIGRATE_CONFIRMATION)", /RECOVER_TARGET:\s*\$\{\{\s*inputs\.failed_migration\s*\}\}/.test(yml) && /RECOVER_RESOLUTION:\s*\$\{\{\s*inputs\.resolution\s*\}\}/.test(yml) && /MIGRATE_CONFIRMATION:\s*\$\{\{\s*inputs\.confirmation\s*\}\}/.test(yml));
  check("★ read-only PREFLIGHT runs before the resolve", /production-prisma-migrate-recover-preflight\.cli\.ts/.test(yml) && yml.indexOf("recover-preflight.cli.ts") < yml.indexOf("migrate resolve"));
  check("★ performs ONLY `prisma migrate resolve --rolled-back`", /prisma migrate resolve --rolled-back/.test(yml));
  check("★ NEVER deploy / dev / reset / db push / applied-marking / ad-hoc SQL", !/migrate deploy/.test(yml) && !/migrate dev/.test(yml) && !/migrate reset/.test(yml) && !/db push/.test(yml) && !/--applied/.test(yml));
  check("★ post-resolve VERIFY runs after the resolve", /production-prisma-migrate-recover-verify\.cli\.ts/.test(yml) && yml.indexOf("recover-verify.cli.ts") > yml.indexOf("migrate resolve"));
  check("★ concurrency guard shared with production-prisma-migrate (mutual exclusion)", /concurrency:/.test(yml) && /group:\s*production-prisma-migrate\s*$/m.test(yml) && /cancel-in-progress:\s*false/.test(yml));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — production-prisma-migrate-recover workflow static check: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
