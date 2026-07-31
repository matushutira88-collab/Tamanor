/**
 * PROVIDER CREDENTIAL — Vercel-runtime readiness (pure) unit tests. Proves the fail-closed matrix + that no secret
 * value is ever returned, only booleans / enumerated reason codes / the public deployment SHA / a safe fingerprint.
 */
import { createHash } from "node:crypto";
import {
  evaluateProviderCredentialRuntimeCutoverReadiness, databaseHostFingerprintSafe,
  type RuntimeReadinessEnv,
} from "../src/index";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const K1 = createHash("sha256").update("legacy").digest("base64");   // 32 bytes
const K2 = createHash("sha256").update("vault").digest("base64");    // 32 bytes, distinct
const SHA = "b358f954febc9e8a8870e5a2d8e533bd2ed29dd3";
const GOOD: RuntimeReadinessEnv = {
  VERCEL_ENV: "production", NODE_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA,
  TOKEN_ENCRYPTION_MODE: "aes-gcm", TOKEN_ENCRYPTION_KEY: K1, PROVIDER_VAULT_KEK: K2, PROVIDER_VAULT_KEY_VERSION: "v1",
};
const has = (env: RuntimeReadinessEnv, reason: string) => evaluateProviderCredentialRuntimeCutoverReadiness(env).reasons.includes(reason as never);

check("valid production runtime → ready", evaluateProviderCredentialRuntimeCutoverReadiness(GOOD).ready === true);
check("ready result exposes only the public SHA (no key bytes)", (() => { const r = evaluateProviderCredentialRuntimeCutoverReadiness(GOOD); return r.deploymentSha === SHA && !JSON.stringify(r).includes(K1) && !JSON.stringify(r).includes(K2); })());

check("non-production (VERCEL_ENV) refused", has({ ...GOOD, VERCEL_ENV: "preview" }, "not_vercel_production"));
check("non-production (NODE_ENV) refused", has({ ...GOOD, NODE_ENV: "development" }, "not_node_production"));
check("missing deployment SHA refused", has({ ...GOOD, VERCEL_GIT_COMMIT_SHA: "" }, "deployment_sha_missing"));
check("invalid deployment SHA refused", has({ ...GOOD, VERCEL_GIT_COMMIT_SHA: "not-a-sha!!" }, "deployment_sha_invalid"));
check("wrong legacy mode refused", has({ ...GOOD, TOKEN_ENCRYPTION_MODE: "plaintext" }, "legacy_mode_not_aes_gcm"));
check("missing legacy key refused", has({ ...GOOD, TOKEN_ENCRYPTION_KEY: undefined }, "legacy_decryption_key_unavailable"));
check("malformed legacy key (short) refused", has({ ...GOOD, TOKEN_ENCRYPTION_KEY: Buffer.from("short").toString("base64") }, "legacy_decryption_key_unavailable"));
check("missing vault KEK refused", has({ ...GOOD, PROVIDER_VAULT_KEK: undefined }, "vault_kek_unavailable"));
check("malformed vault KEK refused", has({ ...GOOD, PROVIDER_VAULT_KEK: "xx" }, "vault_kek_unavailable"));
check("missing key version refused", has({ ...GOOD, PROVIDER_VAULT_KEY_VERSION: "" }, "vault_key_version_missing"));
check("identical legacy + vault keys refused", has({ ...GOOD, PROVIDER_VAULT_KEK: K1 }, "legacy_and_vault_keys_identical"));
check("identical-keys reason ONLY when both keys valid (not duplicated with unavailable)", (() => { const r = evaluateProviderCredentialRuntimeCutoverReadiness({ ...GOOD, TOKEN_ENCRYPTION_KEY: undefined, PROVIDER_VAULT_KEK: undefined }); return !r.reasons.includes("legacy_and_vault_keys_identical"); })());

// host fingerprint is non-reversible + never the URL
const fp = databaseHostFingerprintSafe("postgresql://user:secretpw@db.prod.example.com:5432/x");
check("host fingerprint is a short digest, never the host/password", !!fp && fp!.length <= 16 && !fp!.includes("example.com") && !fp!.includes("secretpw"));
check("empty url → null fingerprint", databaseHostFingerprintSafe(undefined) === null);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — runtime cutover readiness: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
