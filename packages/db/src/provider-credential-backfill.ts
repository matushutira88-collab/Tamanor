/**
 * LEGACY → VAULT backfill (server-only, systemDb/owner). Migrates existing ConnectedAccount plaintext-column
 * tokens into the encrypted vault. SAFETY-FIRST:
 *   - DRY-RUN by default (apply=false): reports counts only, mutates NOTHING.
 *   - Idempotent: an account already vaulted is verified, not re-stored blindly.
 *   - Before clearing a legacy column it PROVES the vault credential decrypts AND its fingerprint matches the
 *     legacy plaintext. On ANY error (undecryptable legacy, fingerprint mismatch, store failure) the legacy
 *     column is LEFT INTACT and the row is counted as an error — never a lossy clear.
 *   - Counts-only receipts: never logs/returns a token, ciphertext, or PII.
 *
 * This phase does NOT drop the legacy columns and MUST NOT be run against production.
 */
import { BusinessProvider } from "@prisma/client";
import { systemDb } from "./index";
import { decryptToken } from "./token-crypto";
import { storeProviderCredential, resolveProviderCredential, ProviderCredentialPurpose } from "./provider-credential-vault";
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

/** Stable 63-bit advisory-lock key from an account id (per-account concurrency guard). */
function lockKeyFor(accountId: string): bigint {
  let h = 0n;
  for (const ch of accountId) h = (h * 131n + BigInt(ch.charCodeAt(0))) % 9223372036854775783n;
  return h;
}

/**
 * Backfill legacy Meta token columns into the vault. `apply=false` (default) mutates nothing. `apply=true` stores
 * missing vault credentials and, ONLY after re-verifying (inside a per-account transaction under an advisory lock)
 * that the vault decrypts + fingerprint-matches the legacy plaintext, nulls the legacy columns. Bounded batch +
 * resume cursor (order by id). Idempotent; preserves legacy plaintext on ANY failure.
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
  // A full batch means there may be more — hand back a resume cursor. A short batch drained the table.
  r.nextCursor = accounts.length === take ? (accounts[accounts.length - 1]?.id ?? null) : null;

  for (const acct of accounts) {
    r.scanned++;
    const q = { tenantId: acct.tenantId, provider: BusinessProvider.meta, purpose: ProviderCredentialPurpose.long_lived_token, connection: { connectedAccountId: acct.id } as const };
    try {
      const legacyPlain = decryptToken(acct.longLivedToken ?? acct.accessToken);
      if (!legacyPlain) { r.skippedNoToken++; continue; }
      const fp = credentialFingerprint(legacyPlain);

      // Is there already a vault credential? Verify it matches; do NOT blindly overwrite.
      let vaultPlain: string | null = null;
      try { vaultPlain = await resolveProviderCredential(q); } catch { r.errors++; continue; } // corrupt vault → error, never clear
      if (vaultPlain !== null) {
        if (credentialFingerprint(vaultPlain) !== fp) { r.errors++; continue; } // mismatch → never clear
        r.alreadyVaulted++;
      } else {
        if (!apply) { continue; } // dry-run: would backfill, but mutate nothing
        await storeProviderCredential({ ...q, secret: legacyPlain });
        r.backfilled++;
      }

      // Verify decryptability + fingerprint from the vault before ever touching the legacy column.
      const check = await resolveProviderCredential(q);
      if (check === null || credentialFingerprint(check) !== fp) { r.errors++; continue; }
      r.verified++;

      if (apply) {
        // Per-account ATOMIC boundary under an advisory lock: re-read the legacy value inside the tx, re-verify the
        // vault still fingerprint-matches, and only then null the legacy columns. Prevents a racing writer/backfill
        // from clobbering a freshly-rotated token, and preserves legacy on any mid-flight change.
        const cleared = await systemDb.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1)", lockKeyFor(acct.id));
          const fresh = await tx.connectedAccount.findUnique({ where: { id: acct.id }, select: { accessToken: true, longLivedToken: true } });
          const freshPlain = decryptToken(fresh?.longLivedToken ?? fresh?.accessToken);
          if (!freshPlain) return false; // already cleared by a concurrent run — nothing to do
          if (credentialFingerprint(freshPlain) !== fp) return false; // legacy changed under us — do NOT clear
          const vaultNow = await resolveProviderCredential(q);
          if (vaultNow === null || credentialFingerprint(vaultNow) !== fp) return false; // vault no longer matches — preserve
          await tx.connectedAccount.update({ where: { id: acct.id }, data: { accessToken: null, longLivedToken: null } });
          return true;
        });
        if (cleared) r.legacyCleared++;
      }
    } catch {
      r.errors++; // any unexpected error → leave legacy intact
    }
  }
  return r;
}
