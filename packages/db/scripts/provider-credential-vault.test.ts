/**
 * PROVIDER CREDENTIAL VAULT — DB + resolver + link-trigger integration tests (local Postgres, systemDb/owner).
 * Proves: store/resolve roundtrip; ONE active credential per connection (rotate-in-place); revoke; non-secret
 * status; AAD/tenant isolation across accounts; FAIL-CLOSED on a corrupt vault row (VaultDecryptError, never
 * plaintext); the canonical resolver's vault-first + staged legacy fallback + fail-closed-no-fallback-on-corruption;
 * and the BusinessPlatformConnection↔ConnectedAccount link (same-tenant, provider=meta, uniqueness) enforced by
 * the DB trigger + partial unique index.
 */
import { createHash } from "node:crypto";
// Hermetic vault key — set BEFORE any vault call so store + resolve use the same env-resolved KEK.
process.env.PROVIDER_VAULT_KEK = createHash("sha256").update("vault-db-test-kek").digest("base64");

import {
  systemDb, encryptToken,
  storeProviderCredential, resolveProviderCredential, resolveProviderCredentialOutcome, revokeProviderCredential, getProviderCredentialStatus,
  VaultDecryptError, VaultCredentialUnusableError, ProviderCredentialPurpose,
  resolveMetaAccessToken, resolveMetaAccessTokenSafe, writeMetaCredentialToVault, hasVaultCredential,
} from "../src/index";
import { BusinessProvider } from "@prisma/client";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("✗ refusing to run against a non-local DB"); process.exit(1); }

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throwsKind(fn: () => Promise<unknown>, kind: new (...a: never[]) => Error): Promise<boolean> { try { await fn(); return false; } catch (e) { return e instanceof kind; } }
async function throwsAny(fn: () => Promise<unknown>): Promise<boolean> { try { await fn(); return false; } catch { return true; } }
const rnd = () => Math.random().toString(36).slice(2, 10);

async function seed() {
  const slug = `vault-${rnd()}`;
  const t = await systemDb.tenant.create({ data: { slug, name: slug, plan: "growth", workspaceKind: "business" } });
  const brand = await systemDb.brand.create({ data: { tenantId: t.id, name: "b" } });
  const acct = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: brand.id, platform: "facebook_page", externalId: `pg-${rnd()}` } });
  return { tenantId: t.id, brandId: brand.id, accountId: acct.id };
}

async function main() {
  const A = await seed();
  const B = await seed();

  const conn = (accountId: string) => ({ connectedAccountId: accountId });
  const q = (tenantId: string, accountId: string, purpose = ProviderCredentialPurpose.long_lived_token) =>
    ({ tenantId, provider: BusinessProvider.meta, purpose, connection: conn(accountId) });

  // ---- store + resolve roundtrip ---------------------------------------------------------------------------
  const s1 = await storeProviderCredential({ ...q(A.tenantId, A.accountId), secret: "PAGE-TOKEN-1", tokenType: "bearer", scopes: ["pages_manage_engagement"] });
  check("store: returns id + fingerprint, not rotated", !!s1.id && !!s1.fingerprint && s1.rotated === false);
  check("resolve: returns the stored plaintext", (await resolveProviderCredential(q(A.tenantId, A.accountId))) === "PAGE-TOKEN-1");
  const rows1 = await systemDb.providerCredential.count({ where: { tenantId: A.tenantId, connectedAccountId: A.accountId, revokedAt: null } });
  check("store: exactly ONE active row", rows1 === 1);
  const dbRow = await systemDb.providerCredential.findFirstOrThrow({ where: { id: s1.id } });
  check("db row stores NO plaintext (ciphertext != secret)", dbRow.ciphertext !== "PAGE-TOKEN-1" && !dbRow.ciphertext.includes("PAGE-TOKEN"));

  // ---- rotate in place (one active row) --------------------------------------------------------------------
  const s2 = await storeProviderCredential({ ...q(A.tenantId, A.accountId), secret: "PAGE-TOKEN-2" });
  check("rotate: same active row id (in place)", s2.id === s1.id && s2.rotated === true);
  check("rotate: resolve returns the NEW secret", (await resolveProviderCredential(q(A.tenantId, A.accountId))) === "PAGE-TOKEN-2");
  check("rotate: still exactly ONE active row", (await systemDb.providerCredential.count({ where: { tenantId: A.tenantId, connectedAccountId: A.accountId, revokedAt: null } })) === 1);
  check("rotate: rotatedAt is set", (await systemDb.providerCredential.findFirstOrThrow({ where: { id: s2.id } })).rotatedAt !== null);

  // ---- status (non-secret) ---------------------------------------------------------------------------------
  const st = await getProviderCredentialStatus(q(A.tenantId, A.accountId));
  check("status: exists + non-secret fields, no ciphertext", st.exists && st.keyVersion === "v1" && !!st.fingerprint && !("ciphertext" in (st as object)));

  // ---- tenant / connection isolation (AAD + row scoping) ---------------------------------------------------
  check("isolation: resolve for a DIFFERENT account returns null (no row)", (await resolveProviderCredential(q(A.tenantId, B.accountId))) === null);
  check("isolation: resolve under the WRONG tenant returns null", (await resolveProviderCredential(q(B.tenantId, A.accountId))) === null);

  // ---- FAIL-CLOSED: a corrupt active row throws VaultDecryptError (never plaintext) -------------------------
  await systemDb.providerCredential.update({ where: { id: s1.id }, data: { ciphertext: Buffer.from("garbage").toString("base64") } });
  check("fail-closed: corrupt ciphertext → VaultDecryptError (never plaintext)", await throwsKind(() => resolveProviderCredential(q(A.tenantId, A.accountId)), VaultDecryptError));
  // restore a valid credential for subsequent tests
  await storeProviderCredential({ ...q(A.tenantId, A.accountId), secret: "PAGE-TOKEN-3" });

  // ---- canonical resolver: vault-first ---------------------------------------------------------------------
  const acctA = { id: A.accountId, tenantId: A.tenantId, longLivedToken: null, accessToken: null };
  const rVault = await resolveMetaAccessToken(acctA);
  check("resolver: vault-first returns the vault token (source=vault)", rVault?.token === "PAGE-TOKEN-3" && rVault?.source === "vault");
  check("hasVaultCredential: true for account A", (await hasVaultCredential(acctA)) === true);

  // ---- canonical resolver: staged legacy fallback (no vault row) --------------------------------------------
  const acctLegacy = { id: B.accountId, tenantId: B.tenantId, longLivedToken: encryptToken("LEGACY-COL-TOKEN"), accessToken: null };
  const rLegacy = await resolveMetaAccessToken(acctLegacy);
  check("resolver: no vault row → legacy column fallback (source=legacy)", rLegacy?.token === "LEGACY-COL-TOKEN" && rLegacy?.source === "legacy");
  check("hasVaultCredential: false for the legacy-only account", (await hasVaultCredential({ id: B.accountId, tenantId: B.tenantId })) === false);
  check("resolver: no vault + no legacy → null", (await resolveMetaAccessToken({ id: B.accountId, tenantId: B.tenantId, longLivedToken: null, accessToken: null })) === null);

  // ---- canonical resolver: FAIL-CLOSED — a corrupt vault row NEVER falls back to legacy ---------------------
  await systemDb.providerCredential.updateMany({ where: { tenantId: A.tenantId, connectedAccountId: A.accountId, revokedAt: null }, data: { authTag: Buffer.from("xxxxxxxxxxxxxxxx").toString("base64") } });
  const acctCorruptWithLegacy = { id: A.accountId, tenantId: A.tenantId, longLivedToken: encryptToken("SHOULD-NOT-BE-USED"), accessToken: null };
  check("resolver: corrupt vault row propagates VaultDecryptError, does NOT read legacy", await throwsKind(() => resolveMetaAccessToken(acctCorruptWithLegacy), VaultDecryptError));

  // ---- writer: vault-only, no legacy columns ---------------------------------------------------------------
  await revokeProviderCredential(q(A.tenantId, A.accountId));
  const w = await writeMetaCredentialToVault({ account: { id: A.accountId, tenantId: A.tenantId }, token: "WRITER-TOKEN", scopes: ["leads_retrieval"] });
  check("writer: stores to the vault (returns id + fingerprint)", !!w.id && !!w.fingerprint);
  check("writer: resolve returns the written token", (await resolveMetaAccessToken({ id: A.accountId, tenantId: A.tenantId, longLivedToken: null, accessToken: null }))?.token === "WRITER-TOKEN");
  const acctRow = await systemDb.connectedAccount.findFirstOrThrow({ where: { id: A.accountId } });
  check("writer: legacy token columns remain NULL (vault-only write)", acctRow.accessToken === null && acctRow.longLivedToken === null && acctRow.refreshToken === null);

  // ---- revoke ----------------------------------------------------------------------------------------------
  const revoked = await revokeProviderCredential(q(A.tenantId, A.accountId));
  check("revoke: returns true", revoked === true);
  check("revoke: resolve now returns null (no active row)", (await resolveProviderCredential(q(A.tenantId, A.accountId))) === null);
  check("revoke: idempotent second revoke returns false", (await revokeProviderCredential(q(A.tenantId, A.accountId))) === false);

  // ---- link trigger: same-tenant + provider=meta + uniqueness ----------------------------------------------
  const okLink = await systemDb.businessPlatformConnection.create({ data: { tenantId: A.tenantId, provider: BusinessProvider.meta, connectedAccountId: A.accountId } });
  check("link: same-tenant meta connection→account allowed", okLink.connectedAccountId === A.accountId);
  check("link: cross-tenant account rejected by trigger", await throwsAny(() => systemDb.businessPlatformConnection.create({ data: { tenantId: B.tenantId, provider: BusinessProvider.meta, connectedAccountId: A.accountId } })));
  check("link: non-meta provider with an account link rejected", await throwsAny(() => systemDb.businessPlatformConnection.create({ data: { tenantId: A.tenantId, provider: BusinessProvider.google, connectedAccountId: A.accountId } })));
  check("link: a second connection linking the SAME account rejected (unique)", await throwsAny(() => systemDb.businessPlatformConnection.create({ data: { tenantId: A.tenantId, provider: BusinessProvider.tiktok, connectedAccountId: A.accountId } })));

  // ---- resolver outcome states + REVOKED fail-closed (no legacy fallback past a bad vault row) --------------
  const C = await seed();
  const qC = { tenantId: C.tenantId, provider: BusinessProvider.meta, purpose: ProviderCredentialPurpose.long_lived_token, connection: { connectedAccountId: C.accountId } };
  check("outcome: absent when no row ever", (await resolveProviderCredentialOutcome(qC)).state === "absent");
  await storeProviderCredential({ ...qC, secret: "C-TOKEN" });
  const oPresent = await resolveProviderCredentialOutcome(qC);
  check("outcome: present + plaintext when active", oPresent.state === "present" && oPresent.state === "present" && oPresent.plaintext === "C-TOKEN");
  // An existing account that also has a LEGACY column value, then its vault credential is REVOKED.
  const cAcctLegacy = { id: C.accountId, tenantId: C.tenantId, longLivedToken: encryptToken("C-LEGACY"), accessToken: null };
  check("resolver: active vault present → source vault (legacy ignored)", (await resolveMetaAccessToken(cAcctLegacy))?.source === "vault");
  await revokeProviderCredential(qC);
  check("outcome: revoked when the only row is revoked", (await resolveProviderCredentialOutcome(qC)).state === "revoked");
  // FAIL-CLOSED: a revoked vault row must NOT fall back to the legacy column.
  let threwRevoked = false;
  try { await resolveMetaAccessToken(cAcctLegacy); } catch (e) { threwRevoked = e instanceof VaultCredentialUnusableError && e.reason === "revoked"; }
  check("resolver: REVOKED vault row → fail-closed (VaultCredentialUnusableError, no legacy fallback)", threwRevoked);
  check("resolveMetaAccessTokenSafe: revoked → null (never plaintext, never throws)", (await resolveMetaAccessTokenSafe(cAcctLegacy)) === null);

  // ---- existing account with ONLY a legacy credential (no vault row) resolves via fallback ------------------
  const D = await seed();
  const dLegacy = { id: D.accountId, tenantId: D.tenantId, longLivedToken: encryptToken("D-LEGACY-ONLY"), accessToken: null };
  check("legacy-only account: outcome absent (no vault row)", (await resolveProviderCredentialOutcome({ tenantId: D.tenantId, provider: BusinessProvider.meta, purpose: ProviderCredentialPurpose.long_lived_token, connection: { connectedAccountId: D.accountId } })).state === "absent");
  check("legacy-only account: resolver falls back to legacy column (source legacy)", (await resolveMetaAccessToken(dLegacy))?.source === "legacy");
  check("legacy-only account: safe resolver returns the legacy token", (await resolveMetaAccessTokenSafe(dLegacy)) === "D-LEGACY-ONLY");
  await systemDb.tenant.deleteMany({ where: { id: { in: [C.tenantId, D.tenantId] } } });

  // ---- cleanup (cascade deletes vault rows via FK) ---------------------------------------------------------
  const beforeDel = await systemDb.providerCredential.count({ where: { tenantId: A.tenantId } });
  await systemDb.tenant.deleteMany({ where: { id: { in: [A.tenantId, B.tenantId] } } });
  const afterDel = await systemDb.providerCredential.count({ where: { tenantId: A.tenantId } });
  check("cascade: tenant delete removes its vault rows (FK ON DELETE CASCADE)", beforeDel > 0 && afterDel === 0);
}

main()
  .catch((e) => { console.error("✗ crashed:", (e as Error).stack ?? (e as Error).message); fail++; })
  .finally(async () => { await systemDb.$disconnect(); console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — provider-credential vault + resolver: ${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1); });
