/**
 * SOURCE INVARIANT — no raw credential may be written to a ConnectedAccount legacy token column in production.
 *
 * Scans production code (packages/<pkg>/src, apps/web/src) and FAILS if any Prisma create/update/upsert payload
 * assigns a NON-null value to `accessToken` / `longLivedToken` / `refreshToken`. The only writes allowed to those
 * columns are `field: null` (disconnect/backfill nulling) and reads/selects (`field: true`). Test fixtures,
 * scripts, and schema/migrations are out of scope (not production code). Also proves the OAuth callback, reconnect
 * and refresh/health paths are vault-only and that the vault modules never log a token/ciphertext.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const HERE = dirname(fileURLToPath(import.meta.url)); // packages/db/scripts
const ROOT = join(HERE, "..", "..", "..");
const PROD_DIRS = ["packages/db/src", "packages/sync/src", "packages/connectors/src", "packages/core/src", "packages/config/src", "apps/web/src"];
const TOKEN_KEYS = ["accessToken", "longLivedToken", "refreshToken"];
// Markers that indicate the surrounding code is writing the ConnectedAccount model (narrow — NOT any create/update).
const CA_WRITE = /connectedAccount\.(create|update|upsert|updateMany|createMany)\b|metaConnectedAccountFields/;

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== "node_modules") walk(p, out); continue; }
    if (!/\.ts$/.test(name)) continue;
    if (/\.test\.ts$/.test(name)) continue; // production code only
    out.push(p);
  }
}

/** RHS classification: is this assignment a PROHIBITED raw-value write (vs null / select / type / read)? */
function isProhibitedWrite(rhs: string): boolean {
  const v = rhs.trim().replace(/,\s*$/, "").replace(/;\s*$/, "");
  if (/^null\b/.test(v)) return false;                 // nulling — allowed
  if (/^(true|false)\b/.test(v)) return false;         // Prisma select — allowed
  if (/^(string|boolean|Date|number)\b/.test(v) || v.includes("|")) return false; // type annotation
  if (v === "") return false;
  // A same-column READ (copying an existing token value: a where-guard / projection / in-memory copy) is not a
  // new secret write — e.g. `longLivedToken: c.longLivedToken`, `accessToken: acct?.accessToken`.
  if (/^\w[\w.?[\]]*\.(accessToken|longLivedToken|refreshToken)\b/.test(v)) return false;
  return true; // a real value is being assigned to a token column
}

// ---- 1) the single write-builder is clean ------------------------------------------------------------------
const metaAccount = readFileSync(join(ROOT, "packages/db/src/meta-account.ts"), "utf8");
const builderBody = metaAccount.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, ""); // strip comments
check("metaConnectedAccountFields writes NO accessToken column",
  !/\baccessToken\s*:/.test(builderBody));
check("metaConnectedAccountFields writes NO longLivedToken column",
  !/\blongLivedToken\s*:/.test(builderBody));
check("metaConnectedAccountFields writes NO refreshToken column",
  !/\brefreshToken\s*:/.test(builderBody));

// ---- 2) full production scan: no non-null token-column write near a ConnectedAccount write ------------------
const files: string[] = [];
for (const d of PROD_DIRS) { try { walk(join(ROOT, d), files); } catch { /* dir may not exist */ } }

const violations: string[] = [];
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*)/.test(line)) continue; // comment line
    for (const key of TOKEN_KEYS) {
      const m = new RegExp(`\\b${key}\\s*:\\s*(.+)$`).exec(line);
      if (!m) continue;
      if (!isProhibitedWrite(m[1])) continue;
      // Context window: is this within a ConnectedAccount write payload?
      const ctx = lines.slice(Math.max(0, i - 25), i + 2).join("\n");
      if (CA_WRITE.test(ctx)) {
        violations.push(`${file.replace(ROOT + "/", "")}:${i + 1}: ${line.trim()}`);
      }
    }
  }
}
check("no raw token-column write in any ConnectedAccount payload (production)", violations.length === 0, violations.join("  |  "));

// ---- 3) the scanner actually catches a re-introduced violation (self-test) ---------------------------------
(() => {
  const bad = [
    "await db.connectedAccount.upsert({",
    "  where: { id },",
    "  create: { tenantId, accessToken: input.encryptedToken, longLivedToken: token },",
    "});",
  ];
  let caught = 0;
  for (let i = 0; i < bad.length; i++) {
    for (const key of TOKEN_KEYS) {
      const m = new RegExp(`\\b${key}\\s*:\\s*(.+)$`).exec(bad[i]);
      if (m && isProhibitedWrite(m[1]) && CA_WRITE.test(bad.slice(Math.max(0, i - 25), i + 2).join("\n"))) caught++;
    }
  }
  check("scanner catches a re-introduced `accessToken: token` write (self-test)", caught >= 2, `caught=${caught}`);
})();

// ---- 4) vault-only positive proofs -------------------------------------------------------------------------
const linkSrc = readFileSync(join(ROOT, "packages/sync/src/meta-connector.ts"), "utf8");
check("connect/reconnect (linkMetaAssets) persists via the vault", /writeMetaCredentialToVault\(/.test(linkSrc));
check("connect/reconnect verifies the credential resolves before returning", /resolveMetaAccessToken\(/.test(linkSrc));
const callbackSrc = readFileSync(join(ROOT, "apps/web/src/app/api/connectors/meta/callback/route.ts"), "utf8");
check("OAuth callback does NOT write a ConnectedAccount token column", !/connectedAccount[\s\S]{0,400}(accessToken|longLivedToken)\s*:\s*[^n]/.test(callbackSrc));

// ---- 5) no token/ciphertext logged from the vault modules --------------------------------------------------
for (const f of ["provider-credential-crypto.ts", "provider-credential-vault.ts", "provider-credential-resolver.ts", "provider-credential-backfill.ts"]) {
  const src = readFileSync(join(ROOT, "packages/db/src", f), "utf8");
  check(`${f}: no console.* logging`, !/console\.(log|info|warn|error)\s*\(/.test(src));
  check(`${f}: does not stringify a plaintext/ciphertext into a log/throw`, !/(console|throw new Error)[\s\S]{0,60}(plaintext|ciphertext|wrappedDataKey)/.test(src));
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — vault token-write source invariant: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
