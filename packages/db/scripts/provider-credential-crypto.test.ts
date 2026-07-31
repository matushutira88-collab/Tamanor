/**
 * PROVIDER CREDENTIAL VAULT — envelope-crypto unit tests (pure, no DB). Proves: roundtrip; AAD binding rejects
 * cross-tenant/provider/connection/purpose reuse; tampered ciphertext/tag/IV/wrapped-key all fail; wrong KEK and
 * wrong key-version fail; per-record DEK uniqueness (distinct IV/ciphertext for identical plaintext); fingerprint
 * is stable + non-reversible; and fail-closed key resolution (production requires a real key, never a default).
 */
import {
  encryptCredential, decryptCredential, credentialFingerprint, testKeyProvider, LocalKekKeyProvider,
  resolveVaultKeyProvider, vaultKeyStatus, PCV_FORMAT_VERSION, type CredentialAad, type EncryptedCredential,
} from "../src/provider-credential-crypto";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>): Promise<boolean> { try { await fn(); return false; } catch { return true; } }

const AAD: CredentialAad = { tenantId: "t_A", provider: "meta", connectionId: "acct_1", purpose: "long_lived_token" };
const b64key = (s: string) => createHash("sha256").update(s).digest("base64"); // deterministic 32-byte base64

async function main() {
  const key = testKeyProvider();
  const SECRET = "EAAB-super-secret-page-token-42";

  // ---- roundtrip -------------------------------------------------------------------------------------------
  const rec = await encryptCredential(SECRET, AAD, key);
  check("roundtrip: decrypt returns the original plaintext", (await decryptCredential(rec, AAD, key)) === SECRET);
  check("record carries NO plaintext", !JSON.stringify(rec).includes(SECRET));
  check("record format/version fields set", rec.formatVersion === PCV_FORMAT_VERSION && rec.keyProvider === "kek-test" && rec.keyVersion === "v1");
  check("record fields are base64 (iv/tag/ciphertext/wrappedKey present)", !!rec.iv && !!rec.authTag && !!rec.ciphertext && !!rec.wrappedDataKey);

  // ---- per-record DEK: identical plaintext → different IV/ciphertext ----------------------------------------
  const rec2 = await encryptCredential(SECRET, AAD, key);
  check("per-record DEK: same plaintext yields a DIFFERENT iv", rec.iv !== rec2.iv);
  check("per-record DEK: same plaintext yields DIFFERENT ciphertext", rec.ciphertext !== rec2.ciphertext);
  check("per-record DEK: same plaintext yields a different wrapped key", rec.wrappedDataKey !== rec2.wrappedDataKey);
  check("fingerprint is stable across records of the same plaintext", rec.fingerprint === rec2.fingerprint);
  check("fingerprint is non-reversible (does not contain the secret)", !rec.fingerprint.includes(SECRET) && rec.fingerprint === credentialFingerprint(SECRET));

  // ---- AAD binding: any changed field must fail decrypt ----------------------------------------------------
  check("AAD: wrong tenant fails", await throws(() => decryptCredential(rec, { ...AAD, tenantId: "t_B" }, key)));
  check("AAD: wrong provider fails", await throws(() => decryptCredential(rec, { ...AAD, provider: "google" }, key)));
  check("AAD: wrong connection fails", await throws(() => decryptCredential(rec, { ...AAD, connectionId: "acct_2" }, key)));
  check("AAD: wrong purpose fails", await throws(() => decryptCredential(rec, { ...AAD, purpose: "access_token" }, key)));

  // ---- tamper: ciphertext / tag / iv / wrapped-key ---------------------------------------------------------
  const flip = (b64: string) => { const b = Buffer.from(b64, "base64"); b[0] ^= 0xff; return b.toString("base64"); };
  check("tamper: flipped ciphertext fails", await throws(() => decryptCredential({ ...rec, ciphertext: flip(rec.ciphertext) }, AAD, key)));
  check("tamper: flipped auth tag fails", await throws(() => decryptCredential({ ...rec, authTag: flip(rec.authTag) }, AAD, key)));
  check("tamper: flipped iv fails", await throws(() => decryptCredential({ ...rec, iv: flip(rec.iv) }, AAD, key)));
  const w = JSON.parse(rec.wrappedDataKey); const [iv, tag, ct] = w.wrapped.split(":");
  check("tamper: flipped wrapped-key fails", await throws(() => decryptCredential({ ...rec, wrappedDataKey: JSON.stringify({ ...w, wrapped: [flip(iv), tag, ct].join(":") }) }, AAD, key)));

  // ---- wrong KEK / wrong key version -----------------------------------------------------------------------
  const otherKey = testKeyProvider("different-label");
  check("wrong KEK: a different master key cannot decrypt", await throws(() => decryptCredential(rec, AAD, otherKey)));
  const v2 = new LocalKekKeyProvider("kek-test", "v2", createHash("sha256").update("test-kek:pcv-test").digest());
  check("wrong key version: same KEK bytes but version mismatch fails unwrap", await throws(() => decryptCredential(rec, AAD, v2)));

  // ---- unsupported format ----------------------------------------------------------------------------------
  check("unsupported format version rejected", await throws(() => decryptCredential({ ...rec, formatVersion: "pcvX" } as EncryptedCredential, AAD, key)));

  // ---- fail-closed key resolution --------------------------------------------------------------------------
  check("prod + no key → throws (never a default key)", (() => { try { resolveVaultKeyProvider({ NODE_ENV: "production" }); return false; } catch (e) { return /production_key_missing/.test((e as Error).message); } })());
  check("prod + VERCEL_ENV=production + no key → throws", (() => { try { resolveVaultKeyProvider({ VERCEL_ENV: "production" }); return false; } catch { return true; } })());
  check("non-prod + no key → throws (vault must be configured, never silent no-op)", (() => { try { resolveVaultKeyProvider({ NODE_ENV: "test" }); return false; } catch (e) { return /pcv_key_missing/.test((e as Error).message); } })());
  check("prod + valid TOKEN_ENCRYPTION_KEY (32B b64) → resolves", (() => { try { const k = resolveVaultKeyProvider({ NODE_ENV: "production", TOKEN_ENCRYPTION_KEY: b64key("master") }); return k.id === "kek-local"; } catch { return false; } })());
  check("PROVIDER_VAULT_KEK takes precedence + resolves", (() => { try { return !!resolveVaultKeyProvider({ NODE_ENV: "production", PROVIDER_VAULT_KEK: b64key("dedicated") }); } catch { return false; } })());
  check("wrong-length key rejected (fail-closed)", (() => { try { resolveVaultKeyProvider({ NODE_ENV: "production", PROVIDER_VAULT_KEK: Buffer.from("short").toString("base64") }); return false; } catch { return true; } })());
  const st = vaultKeyStatus({ NODE_ENV: "production" });
  check("status: prod + no key → not productionSafe, no key material exposed", st.keyConfigured === false && st.productionSafe === false && !("kek" in st));
  check("status: prod + key → productionSafe", vaultKeyStatus({ NODE_ENV: "production", PROVIDER_VAULT_KEK: b64key("m") }).productionSafe === true);

  // ---- a real end-to-end wrap under an env-resolved key -----------------------------------------------------
  const envKey = resolveVaultKeyProvider({ NODE_ENV: "test", PROVIDER_VAULT_KEK: b64key("e2e") });
  const r3 = await encryptCredential("token-xyz", AAD, envKey);
  check("env-resolved key: roundtrip works", (await decryptCredential(r3, AAD, envKey)) === "token-xyz");
}

main()
  .catch((e) => { console.error("✗ crashed:", (e as Error).message); fail++; })
  .finally(() => { console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — provider-credential crypto: ${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1); });
