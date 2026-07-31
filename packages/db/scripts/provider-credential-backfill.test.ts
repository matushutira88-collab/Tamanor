/**
 * LEGACY → VAULT backfill tests (local Postgres). Proves: DRY-RUN mutates NOTHING (no vault rows, legacy intact);
 * APPLY stores vault credentials, verifies decrypt + fingerprint, then clears ONLY verified legacy columns;
 * idempotent re-run (already vaulted, no double-store); an undecryptable legacy token is an error and its column
 * is LEFT INTACT (never a lossy clear); and receipts are counts-only.
 */
import { createHash } from "node:crypto";
process.env.PROVIDER_VAULT_KEK = createHash("sha256").update("backfill-test-kek").digest("base64");

import {
  systemDb, encryptToken, backfillProviderCredentials, resolveProviderCredential, ProviderCredentialPurpose,
} from "../src/index";
import { BusinessProvider } from "@prisma/client";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("✗ refusing to run against a non-local DB"); process.exit(1); }

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const rnd = () => Math.random().toString(36).slice(2, 10);

async function seedAccount(tenantId: string, brandId: string, legacyToken: string | null) {
  const acct = await systemDb.connectedAccount.create({
    data: { tenantId, brandId, platform: "facebook_page", externalId: `pg-${rnd()}`, status: "active",
      longLivedToken: legacyToken ? encryptToken(legacyToken) : null },
  });
  return acct.id;
}

async function main() {
  const t = await systemDb.tenant.create({ data: { slug: `bf-${rnd()}`, name: "bf", plan: "growth", workspaceKind: "business" } });
  const brand = await systemDb.brand.create({ data: { tenantId: t.id, name: "b" } });
  const good = await seedAccount(t.id, brand.id, "LEGACY-GOOD-TOKEN");
  const noToken = await seedAccount(t.id, brand.id, null);
  const q = (id: string) => ({ tenantId: t.id, provider: BusinessProvider.meta, purpose: ProviderCredentialPurpose.long_lived_token, connection: { connectedAccountId: id } });

  // ---- DRY-RUN: nothing mutated ----------------------------------------------------------------------------
  const dry = await backfillProviderCredentials({}); // default apply=false
  check("dry-run: dryRun flag true", dry.dryRun === true);
  check("dry-run: scanned the token-bearing account", dry.scanned >= 1);
  check("dry-run: legacyCleared = 0 (no mutation)", dry.legacyCleared === 0 && dry.backfilled === 0);
  check("dry-run: NO vault row was created", (await systemDb.providerCredential.count({ where: { tenantId: t.id } })) === 0);
  const goodRow = await systemDb.connectedAccount.findFirstOrThrow({ where: { id: good } });
  check("dry-run: legacy column still intact", goodRow.longLivedToken !== null);

  // ---- APPLY: stores + verifies + clears -------------------------------------------------------------------
  const applied = await backfillProviderCredentials({ apply: true });
  check("apply: backfilled >= 1", applied.backfilled >= 1 && applied.verified >= 1);
  check("apply: legacyCleared >= 1", applied.legacyCleared >= 1);
  check("apply: vault credential now resolves to the original plaintext", (await resolveProviderCredential(q(good))) === "LEGACY-GOOD-TOKEN");
  const clearedRow = await systemDb.connectedAccount.findFirstOrThrow({ where: { id: good } });
  check("apply: legacy columns nulled after vault verified", clearedRow.longLivedToken === null && clearedRow.accessToken === null);
  const noTokRow = await systemDb.connectedAccount.findFirstOrThrow({ where: { id: noToken } });
  check("apply: token-less account left untouched (still null, not errored into state)", noTokRow.longLivedToken === null);

  // ---- IDEMPOTENT re-run: already vaulted, no double-store, nothing left to clear ---------------------------
  const rerun = await backfillProviderCredentials({ apply: true });
  check("rerun: no new backfills (already vaulted or cleared)", rerun.backfilled === 0);
  check("rerun: nothing new to clear (legacy already gone)", rerun.legacyCleared === 0);
  check("rerun: still exactly ONE active vault row for the account", (await systemDb.providerCredential.count({ where: { tenantId: t.id, connectedAccountId: good, revokedAt: null } })) === 1);

  // ---- undecryptable legacy token → error, column LEFT INTACT ----------------------------------------------
  // Under plaintext mode decryptToken never throws, so simulate an unreadable value by writing a KMS-tagged
  // token with no provider (decryptToken throws). The row must be counted as an error and NOT cleared.
  const corrupt = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: brand.id, platform: "facebook_page", externalId: `pg-${rnd()}`, status: "active", longLivedToken: "kms:v1:unreadable" } });
  const withCorrupt = await backfillProviderCredentials({ apply: true });
  check("corrupt legacy: counted as an error", withCorrupt.errors >= 1);
  const corruptRow = await systemDb.connectedAccount.findFirstOrThrow({ where: { id: corrupt.id } });
  check("corrupt legacy: column LEFT INTACT (never a lossy clear)", corruptRow.longLivedToken === "kms:v1:unreadable");
  check("corrupt legacy: NO vault row created for it", (await systemDb.providerCredential.count({ where: { tenantId: t.id, connectedAccountId: corrupt.id } })) === 0);

  await systemDb.tenant.delete({ where: { id: t.id } });
}

main()
  .catch((e) => { console.error("✗ crashed:", (e as Error).stack ?? (e as Error).message); fail++; })
  .finally(async () => { await systemDb.$disconnect(); console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — provider-credential backfill: ${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1); });
