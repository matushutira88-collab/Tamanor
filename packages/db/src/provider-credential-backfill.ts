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
}

const META_PLATFORMS = ["facebook_page", "instagram_business"] as const;

/**
 * Backfill legacy Meta token columns into the vault. `apply=false` (default) mutates nothing. `apply=true` stores
 * missing vault credentials and, ONLY after verifying the vault decrypts + fingerprint-matches, nulls the legacy
 * columns. Bounded by `limit`.
 */
export async function backfillProviderCredentials(opts: { apply?: boolean; limit?: number } = {}): Promise<BackfillResult> {
  const apply = opts.apply === true;
  const take = Math.max(1, Math.min(opts.limit ?? 500, 5000));
  const r: BackfillResult = { scanned: 0, skippedNoToken: 0, alreadyVaulted: 0, backfilled: 0, verified: 0, legacyCleared: 0, errors: 0, dryRun: !apply };

  const accounts = await systemDb.connectedAccount.findMany({
    where: { platform: { in: META_PLATFORMS as unknown as never[] }, OR: [{ accessToken: { not: null } }, { longLivedToken: { not: null } }] },
    select: { id: true, tenantId: true, accessToken: true, longLivedToken: true },
    take,
  });

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
        await systemDb.connectedAccount.update({ where: { id: acct.id }, data: { accessToken: null, longLivedToken: null } });
        r.legacyCleared++;
      }
    } catch {
      r.errors++; // any unexpected error → leave legacy intact
    }
  }
  return r;
}
