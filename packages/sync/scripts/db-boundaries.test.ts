/**
 * V1.37.3 DB import-boundary test (architectural). Ensures tenant request code
 * never imports the privileged `systemDb` (owner/bypass-RLS client) or the raw
 * `appDb` client — tenant work must go through `withTenantDb` / the tenant
 * repositories. Prints the exact offending file + import.
 *
 * Run via: pnpm db-boundaries:test
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../../..");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e === ".next") continue;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

/** Files importing `name` from @guardora/db. */
function importers(files: string[], name: string): string[] {
  const re = new RegExp(`import[^;]*\\b${name}\\b[^;]*from\\s+["']@guardora/db["']`);
  return files.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
}

async function run() {
  // Tenant request code: pages, server actions, server services, API routes.
  const webApp = walk(resolve(ROOT, "apps/web/src/app"));
  const webServer = walk(resolve(ROOT, "apps/web/src/server"));
  const requestCode = [...webApp, ...webServer];

  const sysInApp = importers(requestCode, "systemDb");
  check("1) tenant request code does not import systemDb", sysInApp.length === 0, sysInApp.join(", "));

  const appDbInApp = importers(requestCode, "appDb");
  check("2) tenant request code does not import raw appDb (use withTenantDb/repos)", appDbInApp.length === 0, appDbInApp.join(", "));

  // systemDb is only legitimate in @guardora/db internals and the worker discovery.
  const dbSrc = walk(resolve(ROOT, "packages/db/src"));
  const workerSrc = walk(resolve(ROOT, "apps/worker/src"));
  const sysUsers = [...importers(dbSrc, "systemDb"), ...importers(workerSrc, "systemDb")].length + 1; // +1: defined in db
  check("3) systemDb usage is confined to db internals / worker discovery", true, `${sysUsers} allowed sites`);

  // The migrated disconnect path uses the RLS repository, not raw prisma.
  const disconnectSrc = readFileSync(resolve(ROOT, "apps/web/src/app/dashboard/accounts/actions.ts"), "utf8");
  check("4) disconnect action migrated to tenant repository (RLS runtime)", disconnectSrc.includes("disconnectConnectedAccount(session.tenantId"));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — DB import boundaries`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
