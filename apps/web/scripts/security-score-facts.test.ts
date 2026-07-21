/**
 * S1 fix — token-encryption FACT matrix (local/deployed × plaintext/encrypted/
 * unknown). Proves the loader classifies encryption from EXPLICIT signals only,
 * never NODE_ENV — so a local `next build`/`next start` (NODE_ENV=production) with
 * plaintext is `unavailable` (no penalty), while a real deployment with plaintext
 * is CRITICAL. Pure, no DB/network. Run: pnpm security-score-facts:test
 */
import { buildTokenEncryptionFact, resolveEncryptionEnvironment, type TokenStorageStatus } from "../src/server/security-score-facts";

let pass = 0,
  fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

const PLAINTEXT: TokenStorageStatus = { mode: "plaintext", keyConfigured: false, productionSafe: false };
const AES: TokenStorageStatus = { mode: "aes-gcm", keyConfigured: true, productionSafe: true };
const AES_NO_KEY: TokenStorageStatus = { mode: "aes-gcm", keyConfigured: false, productionSafe: false };
const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;

// --- environment classification (never NODE_ENV) ---
check("local next build (NODE_ENV=production, VERCEL_ENV unset) → local", resolveEncryptionEnvironment(env({ NODE_ENV: "production" })) === "local");
check("VERCEL_ENV=production → deployed", resolveEncryptionEnvironment(env({ VERCEL_ENV: "production" })) === "deployed");
check("VERCEL_ENV=preview → deployed", resolveEncryptionEnvironment(env({ VERCEL_ENV: "preview" })) === "deployed");
check("VERCEL_ENV=development → local", resolveEncryptionEnvironment(env({ VERCEL_ENV: "development" })) === "local");
check("TOKEN_STORAGE_REQUIRE_ENCRYPTION=true (self-hosted prod) → deployed", resolveEncryptionEnvironment(env({ TOKEN_STORAGE_REQUIRE_ENCRYPTION: "true" })) === "deployed");
check("unexpected VERCEL_ENV value → unknown", resolveEncryptionEnvironment(env({ VERCEL_ENV: "staging" })) === "unknown");

// --- THE core fix: local production build + plaintext → unavailable (no penalty) ---
{
  const f = buildTokenEncryptionFact(PLAINTEXT, env({ NODE_ENV: "production" }));
  check("local prod build + plaintext → unavailable (NOT penalized)", f.state === "unavailable" && f.environment === "local");
}

// --- deployed production + plaintext → insecure CRITICAL ---
{
  const f = buildTokenEncryptionFact(PLAINTEXT, env({ VERCEL_ENV: "production", NODE_ENV: "production" }));
  check("deployed prod + plaintext → insecure", f.state === "insecure" && f.environment === "deployed" && f.mode === "plaintext");
}

// --- deployed production + encrypted → secure GOOD ---
{
  const f = buildTokenEncryptionFact(AES, env({ VERCEL_ENV: "production" }));
  check("deployed prod + aes-gcm(+key) → secure", f.state === "secure" && f.keyConfigured === true);
}
{
  // aes-gcm WITHOUT a key is not productionSafe → insecure when deployed
  const f = buildTokenEncryptionFact(AES_NO_KEY, env({ VERCEL_ENV: "production" }));
  check("deployed prod + aes-gcm WITHOUT key → insecure", f.state === "insecure");
}

// --- unknown status (mode resolution failed) → unknown, never guessed ---
{
  const f = buildTokenEncryptionFact(null, env({ VERCEL_ENV: "production" }));
  check("null status (invalid mode) → unknown", f.state === "unknown" && f.mode === "unknown");
}
{
  // unexpected env + insecure status → unknown (never a guessed penalty)
  const f = buildTokenEncryptionFact(PLAINTEXT, env({ VERCEL_ENV: "staging" }));
  check("unexpected env + plaintext → unknown (no guess)", f.state === "unknown");
}

// --- no secret / key material in the fact ---
{
  const f = buildTokenEncryptionFact(AES, env({ VERCEL_ENV: "production", TOKEN_ENCRYPTION_KEY: "SUPERSECRETKEYVALUE==" }));
  const s = JSON.stringify(f);
  check("fact contains NO key material", !s.includes("SUPERSECRETKEYVALUE") && !("key" in f) && !("token" in f));
  check("fact evidence limited to mode/keyConfigured/environment/state", Object.keys(f).sort().join(",") === "environment,keyConfigured,mode,state");
}

// --- deterministic ---
{
  const a = JSON.stringify(buildTokenEncryptionFact(PLAINTEXT, env({ VERCEL_ENV: "production" })));
  const b = JSON.stringify(buildTokenEncryptionFact(PLAINTEXT, env({ VERCEL_ENV: "production" })));
  check("deterministic for identical inputs", a === b);
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — token-encryption fact matrix: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
