/**
 * PROVIDER-CREDENTIAL BACKFILL WORKFLOW + CLI SAFETY — static checks over the manual workflow YAML and the CLI
 * source. Proves: workflow_dispatch-only (no push/PR/schedule); the `Production` Environment gate; main-only +
 * expected-commit pinning; distinct mode-specific phrases; a DEDICATED PROVIDER_VAULT_KEK (no TOKEN_ENCRYPTION_KEY
 * fallback in prod); DB URL sourced only from PRODUCTION_DATABASE_URL and never printed; bounded batch/max-batches
 * with default max-batches 1; a cursor input; a concurrency gate; pinned action SHAs; NO migration/db-push/reset/
 * ad-hoc SQL; no unbounded loop in the CLI; and that the Dependabot policy is unchanged.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const stripYamlComments = (s: string) => s.split("\n").map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n");
const stripTsComments = (s: string) => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const wfRaw = readFileSync(join(ROOT, ".github/workflows/production-provider-credential-backfill.yml"), "utf8");
const wf = wfRaw;                          // full text (for input/secret/structure checks)
const wfCode = stripYamlComments(wfRaw);   // comment-stripped (for prohibited-command checks)
const cliRaw = readFileSync(join(ROOT, "packages/db/scripts/backfill-provider-credentials.cli.ts"), "utf8");
const cli = stripTsComments(cliRaw);
const preflight = stripTsComments(readFileSync(join(ROOT, "packages/db/scripts/production-provider-credential-backfill-preflight.cli.ts"), "utf8"));
const dependabot = readFileSync(join(ROOT, ".github/dependabot.yml"), "utf8");

// ---- trigger surface ---------------------------------------------------------------------------------------
check("workflow_dispatch only", /on:\s*[\s\S]*workflow_dispatch:/.test(wf));
check("no push trigger", !/^\s*push:/m.test(wf));
check("no pull_request trigger", !/^\s*pull_request:/m.test(wf));
check("no schedule trigger", !/^\s*schedule:/m.test(wf));

// ---- environment / gates -----------------------------------------------------------------------------------
check("bound to the Production Environment", /^\s*environment:\s*Production\s*$/m.test(wf));
check("concurrency group dedicated to this backfill", /concurrency:\s*[\s\S]*group:\s*production-provider-credential-backfill/.test(wf));
check("cancel-in-progress: false", /cancel-in-progress:\s*false/.test(wf));
check("least-privilege permissions: contents: read", /permissions:\s*[\s\S]*contents:\s*read/.test(wf));
check("timeout bounded", /timeout-minutes:\s*\d+/.test(wf));
check("main-only guard", /refs\/heads\/main/.test(wf));
check("expected_commit pinned to GITHUB_SHA", /inputs\.expected_commit[\s\S]*GITHUB_SHA/.test(wf));

// ---- arming phrases ----------------------------------------------------------------------------------------
check("dry-run phrase documented", /INVENTORY_PROVIDER_CREDENTIALS/.test(wf));
check("apply phrase documented", /MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT/.test(wf));
check("mode input with dry-run default", /mode:[\s\S]*default:\s*dry-run/.test(wf));
check("environment input only accepts production", /environment:[\s\S]*options:\s*\n\s*-\s*production/.test(wf));

// ---- bounds ------------------------------------------------------------------------------------------------
check("batch_size input is a bounded choice", /batch_size:[\s\S]*type:\s*choice/.test(wf));
check("max_batches input is a bounded choice with default 1", /max_batches:[\s\S]*default:\s*"1"/.test(wf));
check("cursor input present", /cursor:/.test(wf));

// ---- secrets: fail-closed, never printed -------------------------------------------------------------------
check("DATABASE_URL mapped only from PRODUCTION_DATABASE_URL", /DATABASE_URL:\s*\$\{\{\s*secrets\.PRODUCTION_DATABASE_URL\s*\}\}/.test(wf));
check("dedicated PROVIDER_VAULT_KEK secret", /PROVIDER_VAULT_KEK:\s*\$\{\{\s*secrets\.PROVIDER_VAULT_KEK\s*\}\}/.test(wf));
check("PROVIDER_VAULT_KEY_VERSION secret", /PROVIDER_VAULT_KEY_VERSION:\s*\$\{\{\s*secrets\.PROVIDER_VAULT_KEY_VERSION\s*\}\}/.test(wf));
check("host fingerprint secret", /PRODUCTION_DATABASE_HOST_FINGERPRINT:\s*\$\{\{\s*secrets\./.test(wf));
check("confirmation passed via env (not a shell arg)", /BACKFILL_CONFIRMATION:\s*\$\{\{\s*inputs\.confirmation\s*\}\}/.test(wf));
check("workflow never echoes DATABASE_URL / KEK", !/echo[^\n]*(DATABASE_URL|PROVIDER_VAULT_KEK)/.test(wf));
check("preflight requires a DEDICATED 32-byte KEK (no TOKEN_ENCRYPTION_KEY fallback)", /kekIs32Bytes\(env\.PROVIDER_VAULT_KEK\)/.test(preflight) && !/TOKEN_ENCRYPTION_KEY/.test(preflight));

// ---- prohibited operations (checked against COMMENT-STRIPPED YAML) -----------------------------------------
check("no prisma migrate deploy/dev", !/prisma\s+migrate\s+(deploy|dev)/.test(wfCode));
check("no db push", !/db\s+push/.test(wfCode));
check("no migrate reset", !/migrate\s+reset/.test(wfCode));
check("no ad-hoc psql/SQL", !/\bpsql\b/.test(wfCode));
check("does not toggle legacy fallback", !/PROVIDER_VAULT_LEGACY_FALLBACK/.test(wfCode));
check("only prisma generate (no migrate) among prisma commands", /prisma generate/.test(wfCode) && !/prisma\s+migrate/.test(wfCode));

// ---- pinned actions + node/pnpm ----------------------------------------------------------------------------
const usesLines = wf.split("\n").map((l) => l.trim()).filter((l) => /^-?\s*uses:\s*\S+@/.test(l));
check("all `uses:` pinned to a 40-hex SHA", usesLines.every((u) => /@[0-9a-f]{40}\b/.test(u)), usesLines.join(" | "));
check("Node 22", /node-version:\s*22/.test(wf));
check("pnpm 9.15.9", /version:\s*9\.15\.9/.test(wf));
check("frozen lockfile install", /pnpm install --frozen-lockfile/.test(wf));

// ---- CLI: bounded loop, no infinite loop -------------------------------------------------------------------
check("CLI has NO 100000 loop", !/100000/.test(cli));
check("CLI loop is bounded by maxBatches", /for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*armed\.maxBatches/.test(cli));
check("CLI documents explicit exit codes + implements them", /Exit codes/.test(cliRaw) && /return 1;/.test(cli) && /return 2;/.test(cli) && /process\.exit\(3\)/.test(cli));

// ---- Dependabot policy unchanged ---------------------------------------------------------------------------
check("dependabot: version-updates still disabled (open-pull-requests-limit 0)", (dependabot.match(/open-pull-requests-limit:\s*0/g) || []).length >= 2);
check("dependabot: monthly interval preserved", /interval:\s*"monthly"/.test(dependabot));

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — provider-credential workflow + CLI safety: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
