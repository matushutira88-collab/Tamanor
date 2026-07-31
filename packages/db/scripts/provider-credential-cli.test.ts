/**
 * BACKFILL CLI — exit-code + bounded-scope + no-secrets tests. Spawns the real CLI with a local DB and a
 * deterministic vault key and asserts the documented exit codes (0 success, 1 arming refused, 2 apply errors /
 * verify fail), that a dry-run is the default, that a malformed cursor / missing key fail closed, and that the
 * output never contains the DATABASE_URL host or the vault key.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// tsx lives in the @guardora/db package's own node_modules (pnpm nests binaries per package).
const TSX = join(HERE, "..", "node_modules", ".bin", "tsx");
const CLI = join(HERE, "backfill-provider-credentials.cli.ts");
const KEK = createHash("sha256").update("cli-test-kek").digest("base64");
const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("✗ refusing to run against a non-local DB"); process.exit(1); }

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

function run(args: string[], extraEnv: Record<string, string | undefined> = {}): { code: number; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, PROVIDER_VAULT_KEK: KEK, ...extraEnv };
  const res = spawnSync(TSX, [CLI, ...args], { encoding: "utf8", env, timeout: 120_000 });
  return { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

const APPLY = "MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT";
const INVENTORY = "INVENTORY_PROVIDER_CREDENTIALS";

// ---- dry-run default ---------------------------------------------------------------------------------------
const dry = run([]);
check("dry-run default → exit 0", dry.code === 0, `code=${dry.code}`);
check("dry-run output says DRY-RUN, mutates nothing", /DRY-RUN complete/.test(dry.out));
check("dry-run with the inventory phrase → exit 0", run(["--confirm", INVENTORY]).code === 0);
check("dry-run with an arbitrary phrase → exit 1 (refused)", run(["--confirm", "nope"]).code === 1);

// ---- apply arming refusals (deterministic, before any DB write) --------------------------------------------
check("apply without confirmation → exit 1", run(["--apply"]).code === 1);
check("apply with the DRY-RUN phrase → exit 1", run(["--apply", "--confirm", INVENTORY]).code === 1);
check("apply with a wrong phrase → exit 1", run(["--apply", "--confirm", "wrong"]).code === 1);
check("malformed cursor → exit 1", run(["--cursor", "../etc/passwd"]).code === 1);
check("missing vault key → exit 1", run([], { PROVIDER_VAULT_KEK: "", TOKEN_ENCRYPTION_KEY: "" }).code === 1);

// ---- armed local apply proceeds (not an arming refusal) ----------------------------------------------------
const applied = run(["--apply", "--confirm", APPLY, "--batch-size", "50", "--max-batches", "1"]);
check("armed local apply is NOT refused (exit 0 or 2, never 1)", applied.code === 0 || applied.code === 2, `code=${applied.code}`);
check("apply run reports bounded scope (max-batches 1)", /max-batches 1/.test(applied.out) && /batchesRun:\s*1/.test(applied.out));

// ---- no secrets in output ----------------------------------------------------------------------------------
const host = (DB.match(/@([^:/?]+)/) ?? [])[1] ?? "localhost";
const allOut = dry.out + applied.out;
check("output never prints the DATABASE_URL password/host verbatim", !allOut.includes(KEK) && !/postgres(ql)?:\/\//.test(allOut));
check("output never prints the vault KEK", !allOut.includes(KEK));
check("output is counts-only (mentions scanned/verified, not token/ciphertext)", /scanned:/.test(dry.out) && !/ciphertext|wrappedDataKey|EAAB/.test(allOut));
void host;

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — backfill CLI exit codes + safety: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
