/**
 * LEGACY → VAULT backfill (server-only, systemDb/owner). Migrates existing ConnectedAccount plaintext-column
 * tokens into the encrypted vault. SAFETY-FIRST:
 *   - DRY-RUN by default (apply=false): reports counts only, mutates NOTHING (no lock, no transaction).
 *   - APPLY performs, PER ACCOUNT, ONE transaction under the SHARED (tenant, account) advisory lock
 *     (`withProviderCredentialAccountLock`) — the same lock connect/reconnect/rotation take — so no writer can
 *     replace the credential between this run's verification and its legacy-column clear. Every vault read/write
 *     in that transaction uses the SAME transaction client (never a second connection).
 *   - It clears a legacy column ONLY after re-reading it inside the lock, (re)storing the vault credential if
 *     absent, and proving the vault decrypts AND fingerprint-matches the legacy plaintext. On ANY mismatch/error
 *     it rolls back, preserves the legacy fields, never overwrites a valid vault record, and counts a safe error.
 *   - Counts-only receipts: never logs/returns a token, ciphertext, wrapped key, IV/tag, or PII.
 *
 * Production apply is allowed ONLY through the armed manual workflow (production-provider-credential-backfill).
 * This service never drops legacy columns and never toggles the legacy-fallback policy.
 */
import { BusinessProvider } from "@prisma/client";
import { systemDb } from "./index";
import { decryptToken } from "./token-crypto";
import { storeProviderCredential, resolveProviderCredential, VaultDecryptError, ProviderCredentialPurpose } from "./provider-credential-vault";
import { withProviderCredentialAccountLock } from "./provider-credential-lock";
import { credentialFingerprint } from "./provider-credential-crypto";

export interface BackfillResult {
  scanned: number;
  skippedNoToken: number;
  alreadyVaulted: number;
  backfilled: number;
  verified: number;
  legacyCleared: number;
  errors: number;
  /** true when NOTHING was mutated (dry-run). */
  dryRun: boolean;
  /** Resume checkpoint: the last account id scanned this batch, or null when the batch drained the table. */
  nextCursor: string | null;
}

const META_PLATFORMS = ["facebook_page", "instagram_business"] as const;
const DEFAULT_BATCH = 100;
const MAX_BATCH = 1000;
const INVENTORY_HARD_CAP = 100_000;

function queryFor(tenantId: string, connectedAccountId: string) {
  return { tenantId, provider: BusinessProvider.meta, purpose: ProviderCredentialPurpose.long_lived_token, connection: { connectedAccountId } as const };
}

/**
 * Process ONE bounded batch (ordered by id, resumable via `cursor`). `apply=false` (default) mutates nothing.
 * `apply=true` runs the single-transaction locked cutover per account. Idempotent; preserves legacy on any error.
 */
export async function backfillProviderCredentials(opts: { apply?: boolean; batchSize?: number; cursor?: string | null } = {}): Promise<BackfillResult> {
  const apply = opts.apply === true;
  const take = Math.max(1, Math.min(opts.batchSize ?? DEFAULT_BATCH, MAX_BATCH));
  const r: BackfillResult = { scanned: 0, skippedNoToken: 0, alreadyVaulted: 0, backfilled: 0, verified: 0, legacyCleared: 0, errors: 0, dryRun: !apply, nextCursor: null };

  const accounts = await systemDb.connectedAccount.findMany({
    where: {
      platform: { in: META_PLATFORMS as unknown as never[] },
      OR: [{ accessToken: { not: null } }, { longLivedToken: { not: null } }],
      ...(opts.cursor ? { id: { gt: opts.cursor } } : {}),
    },
    select: { id: true, tenantId: true, accessToken: true, longLivedToken: true },
    orderBy: { id: "asc" },
    take,
  });
  r.nextCursor = accounts.length === take ? (accounts[accounts.length - 1]?.id ?? null) : null;

  for (const acct of accounts) {
    r.scanned++;
    if (!apply) { classifyDryRun(acct, r); continue; }
    try {
      await applyOne(acct.id, acct.tenantId, r);
    } catch {
      r.errors++; // lock/tx/relationship failure → legacy preserved (transaction rolled back)
    }
  }
  return r;
}

/** DRY-RUN classification for one account — read-only, mutates nothing. */
function classifyDryRun(acct: { id: string; tenantId: string; accessToken: string | null; longLivedToken: string | null }, r: BackfillResult): void {
  let legacyPlain: string | undefined;
  try { legacyPlain = decryptToken(acct.longLivedToken ?? acct.accessToken); } catch { r.errors++; return; }
  if (!legacyPlain) { r.skippedNoToken++; return; }
  // Would-be work is counted, but nothing is written.
  r.backfilled += 0; // explicit: dry-run never backfills
}

/**
 * The APPLY cutover for one account: a single transaction under the shared (tenant, account) advisory lock.
 * Re-reads legacy inside the lock, (re)stores the vault credential via the SAME tx if absent, verifies decrypt +
 * fingerprint via the SAME tx, and only then nulls the legacy columns. Any mismatch/error rolls the whole
 * transaction back (legacy preserved, valid vault never overwritten) and is surfaced to the caller as an error.
 */
async function applyOne(connectedAccountId: string, tenantId: string, r: BackfillResult): Promise<void> {
  const q = queryFor(tenantId, connectedAccountId);
  const outcome = await withProviderCredentialAccountLock({
    tenantId,
    connectedAccountId,
    operation: async (tx): Promise<"skippedNoToken" | "alreadyVaulted+cleared" | "backfilled+cleared" | "noop" | "error"> => {
      // 1) re-read legacy inside the lock
      const fresh = await tx.connectedAccount.findUnique({ where: { id: connectedAccountId }, select: { accessToken: true, longLivedToken: true } });
      let legacyPlain: string | undefined;
      try { legacyPlain = decryptToken(fresh?.longLivedToken ?? fresh?.accessToken); } catch { return "error"; }
      if (!legacyPlain) return "skippedNoToken"; // nothing to migrate (already cleared / never had one)
      const fp = credentialFingerprint(legacyPlain);

      // 2) re-read current vault via the SAME transaction
      let vaultPlain: string | null;
      try { vaultPlain = await resolveProviderCredential(q, { db: tx }); }
      catch (e) { if (e instanceof VaultDecryptError) return "error"; throw e; } // corrupt vault → preserve legacy
      let backfilledNow = false;
      if (vaultPlain === null) {
        // 3) absent → store the credential INSIDE this transaction
        await storeProviderCredential({ ...q, secret: legacyPlain }, { db: tx });
        backfilledNow = true;
      } else if (credentialFingerprint(vaultPlain) !== fp) {
        return "error"; // a DIFFERENT valid vault credential exists — never overwrite it, never clear legacy
      }

      // 4) verify decrypt + fingerprint via the SAME transaction, BEFORE clearing anything
      const check = await resolveProviderCredential(q, { db: tx });
      if (check === null || credentialFingerprint(check) !== fp) return "error";

      // 5) clear legacy columns — atomic with the store/verify above
      await tx.connectedAccount.update({ where: { id: connectedAccountId }, data: { accessToken: null, longLivedToken: null } });
      return backfilledNow ? "backfilled+cleared" : "alreadyVaulted+cleared";
    },
  });

  switch (outcome) {
    case "skippedNoToken": r.skippedNoToken++; break;
    case "alreadyVaulted+cleared": r.alreadyVaulted++; r.verified++; r.legacyCleared++; break;
    case "backfilled+cleared": r.backfilled++; r.verified++; r.legacyCleared++; break;
    case "error": r.errors++; break;
    case "noop": break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Read-only inventory + post-run verification (counts only — never a token/fingerprint-identity/PII).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ProviderCredentialInventory {
  totalMetaAccounts: number;
  legacyPopulated: number;
  withActiveVault: number;
  legacyAndVault: number;
  legacyOnly: number;
  vaultOnly: number;
  neither: number;
  /** legacy present + active vault present + fingerprints equal. */
  legacyMatchesVault: number;
  /** active vault present but decrypt fails (unusable). */
  corruptVault: number;
  /** legacy null AND active vault corrupt/absent-but-expected → an unusable "vault-only" account (must be 0 post-apply). */
  vaultOnlyUnusable: number;
  /** true if the scan hit the hard cap (counts are a lower bound). */
  capped: boolean;
}

/**
 * Read-only counts-only inventory over Meta ConnectedAccounts. Never returns tokens, fingerprints tied to a
 * user-facing identity, tenant names, emails, page names, or any PII — only aggregate integers.
 */
export async function providerCredentialInventory(): Promise<ProviderCredentialInventory> {
  const inv: ProviderCredentialInventory = {
    totalMetaAccounts: 0, legacyPopulated: 0, withActiveVault: 0, legacyAndVault: 0, legacyOnly: 0,
    vaultOnly: 0, neither: 0, legacyMatchesVault: 0, corruptVault: 0, vaultOnlyUnusable: 0, capped: false,
  };
  let cursor: string | null = null;
  const PAGE = 500;
  while (inv.totalMetaAccounts < INVENTORY_HARD_CAP) {
    const rows: Array<{ id: string; tenantId: string; accessToken: string | null; longLivedToken: string | null }> =
      await systemDb.connectedAccount.findMany({
        where: { platform: { in: META_PLATFORMS as unknown as never[] }, ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true, tenantId: true, accessToken: true, longLivedToken: true },
        orderBy: { id: "asc" },
        take: PAGE,
      });
    if (rows.length === 0) break;
    for (const acct of rows) {
      inv.totalMetaAccounts++;
      const q = queryFor(acct.tenantId, acct.id);
      const hasLegacy = Boolean(acct.accessToken || acct.longLivedToken);
      let legacyPlain: string | undefined;
      if (hasLegacy) { inv.legacyPopulated++; try { legacyPlain = decryptToken(acct.longLivedToken ?? acct.accessToken); } catch { /* unreadable legacy */ } }
      let vaultPlain: string | null = null;
      let vaultCorrupt = false;
      try { vaultPlain = await resolveProviderCredential(q); } catch (e) { if (e instanceof VaultDecryptError) vaultCorrupt = true; }
      const hasVault = vaultPlain !== null;
      if (vaultCorrupt) inv.corruptVault++;
      if (hasVault) inv.withActiveVault++;
      if (hasLegacy && hasVault) {
        inv.legacyAndVault++;
        if (legacyPlain && credentialFingerprint(legacyPlain) === credentialFingerprint(vaultPlain!)) inv.legacyMatchesVault++;
      } else if (hasLegacy && !hasVault) {
        inv.legacyOnly++;
      } else if (!hasLegacy && hasVault) {
        inv.vaultOnly++;
      } else {
        inv.neither++;
        if (vaultCorrupt) inv.vaultOnlyUnusable++; // legacy null AND vault corrupt → unusable "cleared" account
      }
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < PAGE) break;
  }
  inv.capped = inv.totalMetaAccounts >= INVENTORY_HARD_CAP;
  return inv;
}

export interface BackfillVerifyResult { ok: boolean; failures: string[] }

/**
 * Post-run invariant verification (counts only). For an APPLY it fails when: the run reported errors; more
 * columns were cleared than were verified; or a "vault-only" (cleared) account has an unusable vault. For a
 * DRY-RUN it fails if any mutation counter is non-zero (proving nothing was written).
 */
export function verifyBackfillRun(result: BackfillResult, inventory: ProviderCredentialInventory): BackfillVerifyResult {
  const failures: string[] = [];
  if (result.dryRun) {
    if (result.backfilled !== 0 || result.legacyCleared !== 0) failures.push("dry-run performed a mutation");
  } else {
    if (result.errors > 0) failures.push(`apply reported ${result.errors} error(s)`);
    if (result.legacyCleared > result.verified) failures.push("legacyCleared exceeds verified");
    if (inventory.vaultOnlyUnusable > 0) failures.push(`${inventory.vaultOnlyUnusable} cleared account(s) have an unusable vault`);
  }
  return { ok: failures.length === 0, failures };
}

/** Prove a dry-run mutated nothing by comparing safe before/after inventories. */
export function assertNoMutation(before: ProviderCredentialInventory, after: ProviderCredentialInventory): BackfillVerifyResult {
  const failures: string[] = [];
  const keys: (keyof ProviderCredentialInventory)[] = ["legacyPopulated", "legacyOnly", "vaultOnly", "legacyAndVault", "withActiveVault", "neither"];
  for (const k of keys) if (before[k] !== after[k]) failures.push(`inventory.${String(k)} changed (${before[k]} → ${after[k]})`);
  return { ok: failures.length === 0, failures };
}
