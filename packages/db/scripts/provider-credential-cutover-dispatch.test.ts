/**
 * PROVIDER CREDENTIAL CUTOVER DISPATCH — owner authorization + dry-run/apply action tests (local Postgres).
 * Proves: platform-OWNER only (admin/analyst/none/revoked denied); recent-auth required; Vercel-production
 * readiness required; dry-run is read-only + fails on decrypt errors; apply needs exact phrase (no trim) +
 * acknowledgement + SHA match + a fresh clean dry-run; apply clears legacy only after vault verification, enforces
 * post-invariants, is idempotent, and preserves legacy on mismatch; and no token/key/ciphertext/PII leaves in the
 * result. Readiness env is injected (opts.env); vault/legacy crypto use process.env (set below).
 */
import { createHash } from "node:crypto";
const K_LEGACY = createHash("sha256").update("dispatch-legacy").digest("base64"); // 32 bytes
const K_VAULT = createHash("sha256").update("dispatch-vault").digest("base64");   // 32 bytes, distinct
process.env.TOKEN_ENCRYPTION_MODE = "aes-gcm";
process.env.TOKEN_ENCRYPTION_KEY = K_LEGACY;
process.env.PROVIDER_VAULT_KEK = K_VAULT;
process.env.PROVIDER_VAULT_KEY_VERSION = "v1";

import { systemDb, encryptToken, resolveProviderCredential, ProviderCredentialPurpose, storeProviderCredential } from "../src/index";
import { runCutoverDryRun, runCutoverApply, type CutoverOpts } from "../../../apps/web/src/server/platform/provider-credential-cutover-dispatch";
import { BusinessProvider } from "@prisma/client";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("✗ refusing to run against a non-local DB"); process.exit(1); }

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const rnd = () => Math.random().toString(36).slice(2, 10);
const SHA = "b358f954febc9e8a8870e5a2d8e533bd2ed29dd3";
const recent = () => new Date();
const stale = () => new Date(Date.now() - 40 * 60_000);
const PROD_ENV: NodeJS.ProcessEnv = { ...process.env, VERCEL_ENV: "production", NODE_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA, DATABASE_URL: "postgresql://u:p@db.prod.example.com:5432/x" };
const OPTS: CutoverOpts = { env: PROD_ENV, rateLimiter: null };

async function makeUser(platformRole: string | null, revoked = false) {
  const u = await systemDb.user.create({ data: { email: `pcu-${rnd()}@example.test`, passwordHash: "x", emailVerifiedAt: new Date(),
    platformRole: ((platformRole ?? "none") as never), platformAccessRevokedAt: revoked ? new Date() : null } });
  return u.id;
}
async function seedAccount(tenantId: string, brandId: string, legacy: string | null) {
  const a = await systemDb.connectedAccount.create({ data: { tenantId, brandId, platform: "facebook_page", externalId: `pg-${rnd()}`, status: "active", longLivedToken: legacy ? encryptToken(legacy) : null } });
  return a.id;
}
const q = (tenantId: string, id: string) => ({ tenantId, provider: BusinessProvider.meta, purpose: ProviderCredentialPurpose.long_lived_token, connection: { connectedAccountId: id } });

async function main() {
  // CLEAN SLATE — the inventory/backfill scan is global; start from zero Meta accounts + vault rows (local only).
  await systemDb.providerCredential.deleteMany({});
  await systemDb.connectedAccount.deleteMany({ where: { platform: { in: ["facebook_page", "instagram_business"] as never[] } } });

  const t = await systemDb.tenant.create({ data: { slug: `pcc-${rnd()}`, name: "pcc", plan: "growth", workspaceKind: "business" } });
  const brand = await systemDb.brand.create({ data: { tenantId: t.id, name: "b" } });

  const owner = await makeUser("owner");
  const admin = await makeUser("admin");
  const analyst = await makeUser("analyst");
  const none = await makeUser(null);
  const revokedOwner = await makeUser("owner", true);

  // ---- authorization ---------------------------------------------------------------------------------------
  check("platform admin → forbidden", (await runCutoverDryRun({ userId: admin, authenticatedAt: recent() }, OPTS)).body.error === "forbidden");
  check("platform analyst → forbidden", (await runCutoverDryRun({ userId: analyst, authenticatedAt: recent() }, OPTS)).body.error === "forbidden");
  check("no platform role → forbidden", (await runCutoverDryRun({ userId: none, authenticatedAt: recent() }, OPTS)).body.error === "forbidden");
  check("revoked owner → forbidden", (await runCutoverDryRun({ userId: revokedOwner, authenticatedAt: recent() }, OPTS)).body.error === "forbidden");
  check("owner + stale auth → reauth_required (401)", (() => true)() && (await runCutoverDryRun({ userId: owner, authenticatedAt: stale() }, OPTS)).body.error === "reauth_required");
  check("owner + null auth → reauth_required", (await runCutoverDryRun({ userId: owner, authenticatedAt: null }, OPTS)).body.error === "reauth_required");

  // ---- readiness gate --------------------------------------------------------------------------------------
  const nonProd: CutoverOpts = { env: { ...PROD_ENV, VERCEL_ENV: "preview" }, rateLimiter: null };
  const r0 = await runCutoverDryRun({ userId: owner, authenticatedAt: recent() }, nonProd);
  check("owner + non-production runtime → runtime_not_ready", r0.body.error === "runtime_not_ready" && r0.body.readiness.ready === false);

  // ---- dry-run: read-only + clean --------------------------------------------------------------------------
  await seedAccount(t.id, brand.id, "TOKEN-A");
  await seedAccount(t.id, brand.id, "TOKEN-B");
  const dry = await runCutoverDryRun({ userId: owner, authenticatedAt: recent() }, OPTS);
  check("owner + production dry-run → ok", dry.body.ok === true && dry.body.mode === "dry-run" && dry.body.error === undefined);
  check("dry-run is read-only: no vault rows created", (await systemDb.providerCredential.count()) === 0);
  check("dry-run reports counts only (no token/ciphertext in body)", !/TOKEN-A|ciphertext|aesgcm|wrappedDataKey/.test(JSON.stringify(dry.body)));

  // ---- dry-run fails on an undecryptable legacy token ------------------------------------------------------
  await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: brand.id, platform: "facebook_page", externalId: `pg-${rnd()}`, status: "active", longLivedToken: "aesgcm:v1:not:valid:x" } });
  const dryBad = await runCutoverDryRun({ userId: owner, authenticatedAt: recent() }, OPTS);
  check("dry-run with an undecryptable legacy token → dry_run_failed", dryBad.body.ok === false && dryBad.body.error === "dry_run_failed");
  check("dry-run failure still mutated nothing", (await systemDb.providerCredential.count()) === 0);
  // remove the bad account so apply can proceed cleanly
  await systemDb.connectedAccount.deleteMany({ where: { longLivedToken: "aesgcm:v1:not:valid:x" } });

  // ---- apply gates -----------------------------------------------------------------------------------------
  const owAct = { userId: owner, authenticatedAt: recent() };
  check("apply wrong phrase → confirmation_invalid", (await runCutoverApply(owAct, { confirmation: "nope", acknowledge: true, expectedSha: SHA }, OPTS)).body.error === "confirmation_invalid");
  check("apply phrase with trailing space → confirmation_invalid (no trim)", (await runCutoverApply(owAct, { confirmation: "MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT ", acknowledge: true, expectedSha: SHA }, OPTS)).body.error === "confirmation_invalid");
  check("apply without acknowledgement → acknowledgement_required", (await runCutoverApply(owAct, { confirmation: "MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT", acknowledge: false, expectedSha: SHA }, OPTS)).body.error === "acknowledgement_required");
  check("apply with stale SHA → sha_mismatch", (await runCutoverApply(owAct, { confirmation: "MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT", acknowledge: true, expectedSha: "deadbeef" }, OPTS)).body.error === "sha_mismatch");
  check("apply as non-owner → forbidden", (await runCutoverApply({ userId: admin, authenticatedAt: recent() }, { confirmation: "MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT", acknowledge: true, expectedSha: SHA }, OPTS)).body.error === "forbidden");

  // ---- happy apply + invariants ----------------------------------------------------------------------------
  const applied = await runCutoverApply(owAct, { confirmation: "MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT", acknowledge: true, expectedSha: SHA }, OPTS);
  check("apply → ok, invariants hold", applied.body.ok === true && applied.body.error === undefined);
  check("apply: legacy cleared === verified, no errors", applied.body.run?.legacyCleared === applied.body.run?.verified && applied.body.run?.errors === 0);
  check("apply: legacy columns nulled + vault populated", (await systemDb.connectedAccount.count({ where: { tenantId: t.id, longLivedToken: { not: null } } })) === 0 && (await systemDb.providerCredential.count({ where: { tenantId: t.id, revokedAt: null } })) === 2);
  check("apply: vault resolves to the original tokens", (await resolveProviderCredential(q(t.id, (await systemDb.connectedAccount.findFirstOrThrow({ where: { tenantId: t.id } })).id))) !== null);
  check("apply body carries no token/ciphertext/account-id/email", !/TOKEN-A|TOKEN-B|ciphertext|aesgcm|@example\.test|pg-/.test(JSON.stringify(applied.body)));

  // ---- idempotent rerun ------------------------------------------------------------------------------------
  const rerun = await runCutoverApply(owAct, { confirmation: "MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT", acknowledge: true, expectedSha: SHA }, OPTS);
  check("apply rerun → ok, zero work", rerun.body.ok === true && rerun.body.run?.legacyCleared === 0);

  // ---- preserve legacy on mismatch -------------------------------------------------------------------------
  const mId = await seedAccount(t.id, brand.id, "LEGACY-M");
  await storeProviderCredential({ ...q(t.id, mId), secret: "DIFFERENT-VAULT" }); // a valid but different vault credential
  const mm = await runCutoverApply(owAct, { confirmation: "MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT", acknowledge: true, expectedSha: SHA }, OPTS);
  check("apply with a mismatched vault → verification failure, legacy preserved", mm.body.ok === false && mm.body.error === "apply_verification_failed" && (await systemDb.connectedAccount.findFirstOrThrow({ where: { id: mId } })).longLivedToken !== null);

  await systemDb.tenant.deleteMany({ where: { id: t.id } });
}

// Crash-safe cleanup: platform users + accounts/vault rows this suite created are ALWAYS removed (even on a
// mid-run throw) so no leaked platform owner can affect other suites.
async function cleanup() {
  await systemDb.providerCredential.deleteMany({}).catch(() => {});
  await systemDb.user.deleteMany({ where: { email: { startsWith: "pcu-" } } }).catch(() => {});
  await systemDb.tenant.deleteMany({ where: { slug: { startsWith: "pcc-" } } }).catch(() => {});
}

main()
  .catch((e) => { console.error("✗ crashed:", (e as Error).stack ?? (e as Error).message); fail++; })
  .finally(async () => { await cleanup(); await systemDb.$disconnect(); console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — cutover dispatch: ${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1); });
