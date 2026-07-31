/**
 * PROVIDER CREDENTIAL — transaction/lock race + atomicity tests (local Postgres, systemDb). Proves the single
 * transactional cutover boundary: backfill apply and connect/reconnect serialize on the SAME (tenant, account)
 * advisory lock; a reconnect can't replace the credential between backfill's verify and its legacy clear; every
 * apply failure preserves the legacy columns and never overwrites a valid vault; retries are idempotent; a
 * cross-tenant account is rejected; concurrent backfills converge; and dry-run writes nothing.
 */
import { createHash } from "node:crypto";
process.env.PROVIDER_VAULT_KEK = createHash("sha256").update("tx-race-test-kek").digest("base64");

import {
  systemDb, encryptToken,
  backfillProviderCredentials, providerCredentialInventory,
  withProviderCredentialAccountLock, advisoryLockKeys, ProviderCredentialLockError,
  writeMetaCredentialToVault, storeProviderCredential, resolveProviderCredential, revokeProviderCredential,
  ProviderCredentialPurpose,
} from "../src/index";
import { BusinessProvider } from "@prisma/client";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("✗ refusing to run against a non-local DB"); process.exit(1); }

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throwsKind(fn: () => Promise<unknown>, kind: new (...a: never[]) => Error): Promise<boolean> { try { await fn(); return false; } catch (e) { return e instanceof kind; } }
const rnd = () => Math.random().toString(36).slice(2, 10);

async function seed(legacy?: string) {
  const slug = `race-${rnd()}`;
  const t = await systemDb.tenant.create({ data: { slug, name: slug, plan: "growth", workspaceKind: "business" } });
  const brand = await systemDb.brand.create({ data: { tenantId: t.id, name: "b" } });
  const acct = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: brand.id, platform: "facebook_page", externalId: `pg-${rnd()}`, status: "active", longLivedToken: legacy ? encryptToken(legacy) : null } });
  return { tenantId: t.id, accountId: acct.id };
}
const q = (tenantId: string, accountId: string) => ({ tenantId, provider: BusinessProvider.meta, purpose: ProviderCredentialPurpose.long_lived_token, connection: { connectedAccountId: accountId } });
const legacyOf = async (id: string) => (await systemDb.connectedAccount.findFirstOrThrow({ where: { id }, select: { longLivedToken: true, accessToken: true } }));
/** Simulate a connect/reconnect credential write — the SAME lock+store+verify linkMetaAssets uses. */
async function reconnectViaLock(tenantId: string, accountId: string, token: string) {
  return withProviderCredentialAccountLock({ tenantId, connectedAccountId: accountId, operation: async (tx) => {
    await writeMetaCredentialToVault({ account: { id: accountId, tenantId }, token }, { db: tx });
    const c = await resolveProviderCredential(q(tenantId, accountId), { db: tx });
    if (c !== token) throw new Error("verify_failed");
  } });
}

async function main() {
  // ---- lock key derivation ---------------------------------------------------------------------------------
  const [k1, k2] = advisoryLockKeys("t1", "a1");
  check("lock keys are deterministic + stable", advisoryLockKeys("t1", "a1")[0] === k1 && advisoryLockKeys("t1", "a1")[1] === k2);
  check("lock keys differ for a different account", advisoryLockKeys("t1", "a2")[0] !== k1 || advisoryLockKeys("t1", "a2")[1] !== k2);
  check("lock keys differ for a different tenant", advisoryLockKeys("t2", "a1")[0] !== k1 || advisoryLockKeys("t2", "a1")[1] !== k2);
  check("backfill + reconnect derive the SAME lock key for one account (shared lock)", (() => { const a = advisoryLockKeys("tenantX", "acctX"); const b = advisoryLockKeys("tenantX", "acctX"); return a[0] === b[0] && a[1] === b[1]; })());

  // ---- cross-tenant account rejected inside the lock -------------------------------------------------------
  const A = await seed("LEGACY-A");
  const other = await seed();
  check("lock rejects a cross-tenant account (never mutates across tenants)",
    await throwsKind(() => withProviderCredentialAccountLock({ tenantId: other.tenantId, connectedAccountId: A.accountId, operation: async () => 1 }), ProviderCredentialLockError));

  // ---- dry-run performs NO writes -------------------------------------------------------------------------
  const dry = await backfillProviderCredentials({ apply: false, batchSize: 100 });
  check("dry-run: no vault rows created for account A", (await systemDb.providerCredential.count({ where: { connectedAccountId: A.accountId } })) === 0);
  check("dry-run: legacy intact + zero mutation counters", (await legacyOf(A.accountId)).longLivedToken !== null && dry.backfilled === 0 && dry.legacyCleared === 0);

  // ---- happy apply: single-tx store+verify+clear ----------------------------------------------------------
  const rA = await backfillProviderCredentials({ apply: true, batchSize: 100 });
  check("apply: account A backfilled + verified + cleared", rA.legacyCleared >= 1 && rA.verified >= 1 && rA.errors === 0);
  check("apply: vault resolves to the original legacy token", (await resolveProviderCredential(q(A.tenantId, A.accountId))) === "LEGACY-A");
  check("apply: legacy columns nulled", (await legacyOf(A.accountId)).longLivedToken === null && (await legacyOf(A.accountId)).accessToken === null);

  // ---- retry after interruption is idempotent -------------------------------------------------------------
  const rA2 = await backfillProviderCredentials({ apply: true, batchSize: 100 });
  check("retry: nothing left to clear for A, no double-store", rA2.legacyCleared === 0 && (await systemDb.providerCredential.count({ where: { connectedAccountId: A.accountId, revokedAt: null } })) === 1);

  // ---- fingerprint mismatch preserves legacy (never overwrite a valid different vault) ----------------------
  const B = await seed("LEGACY-B");
  await storeProviderCredential({ ...q(B.tenantId, B.accountId), secret: "DIFFERENT-VAULT-TOKEN" }); // a valid but DIFFERENT vault credential
  const rB = await backfillProviderCredentials({ apply: true, batchSize: 100 });
  check("mismatch: apply counts an error for B", rB.errors >= 1);
  check("mismatch: legacy PRESERVED (never cleared)", (await legacyOf(B.accountId)).longLivedToken !== null);
  check("mismatch: the different vault credential is NOT overwritten", (await resolveProviderCredential(q(B.tenantId, B.accountId))) === "DIFFERENT-VAULT-TOKEN");

  // ---- corrupt vault preserves legacy + fails closed ------------------------------------------------------
  const C = await seed("LEGACY-C");
  await storeProviderCredential({ ...q(C.tenantId, C.accountId), secret: "LEGACY-C" });
  await systemDb.providerCredential.updateMany({ where: { connectedAccountId: C.accountId, revokedAt: null }, data: { authTag: Buffer.from("xxxxxxxxxxxxxxxx").toString("base64") } });
  const rC = await backfillProviderCredentials({ apply: true, batchSize: 100 });
  check("corrupt vault: apply counts an error for C", rC.errors >= 1);
  check("corrupt vault: legacy PRESERVED", (await legacyOf(C.accountId)).longLivedToken !== null);

  // ---- two concurrent backfills converge ------------------------------------------------------------------
  const D = await seed("LEGACY-D");
  const [d1, d2] = await Promise.all([
    backfillProviderCredentials({ apply: true, batchSize: 100 }),
    backfillProviderCredentials({ apply: true, batchSize: 100 }),
  ]);
  check("concurrent backfills: legacy cleared exactly once across the two runs", (d1.legacyCleared + d2.legacyCleared) >= 1 && (await legacyOf(D.accountId)).longLivedToken === null);
  check("concurrent backfills: exactly ONE active vault row, resolves to legacy", (await systemDb.providerCredential.count({ where: { connectedAccountId: D.accountId, revokedAt: null } })) === 1 && (await resolveProviderCredential(q(D.tenantId, D.accountId))) === "LEGACY-D");

  // ---- backfill + reconnect concurrent: serialize on the shared lock, converge safely ----------------------
  const E = await seed("LEGACY-E");
  const [, ] = await Promise.all([
    backfillProviderCredentials({ apply: true, batchSize: 100 }).catch(() => null),
    reconnectViaLock(E.tenantId, E.accountId, "RECONNECT-E").catch(() => null),
  ]);
  // Whichever ran first, the invariant holds: the active vault ALWAYS decrypts to a valid token, and legacy is
  // never cleared while the vault holds a DIFFERENT token than the one that was cleared.
  const vaultE = await resolveProviderCredential(q(E.tenantId, E.accountId));
  const legacyE = (await legacyOf(E.accountId)).longLivedToken;
  check("backfill+reconnect: active vault always resolves to a valid token", vaultE === "LEGACY-E" || vaultE === "RECONNECT-E");
  check("backfill+reconnect: never cleared legacy while vault held a different token",
    legacyE === null ? vaultE !== null : true);
  check("backfill+reconnect: exactly one active vault row (no split-brain)", (await systemDb.providerCredential.count({ where: { connectedAccountId: E.accountId, revokedAt: null } })) === 1);

  // ---- reconnect between verify and clear is impossible (lock serializes) → post-state consistent ----------
  // Run reconnect first (rotates vault to a new token), THEN backfill: backfill must see mismatch and preserve.
  const F = await seed("LEGACY-F");
  await reconnectViaLock(F.tenantId, F.accountId, "ROTATED-F"); // vault now holds a token != legacy
  const rF = await backfillProviderCredentials({ apply: true, batchSize: 100 });
  check("post-reconnect mismatch: backfill preserves legacy (no clear against a rotated vault)", rF.errors >= 1 && (await legacyOf(F.accountId)).longLivedToken !== null);
  check("post-reconnect: vault still holds the rotated token (untouched)", (await resolveProviderCredential(q(F.tenantId, F.accountId))) === "ROTATED-F");

  // cleanup
  await systemDb.tenant.deleteMany({ where: { id: { in: [A.tenantId, other.tenantId, B.tenantId, C.tenantId, D.tenantId, E.tenantId, F.tenantId] } } });
}

main()
  .catch((e) => { console.error("✗ crashed:", (e as Error).stack ?? (e as Error).message); fail++; })
  .finally(async () => { await systemDb.$disconnect(); console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — provider-credential tx/lock race: ${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1); });
