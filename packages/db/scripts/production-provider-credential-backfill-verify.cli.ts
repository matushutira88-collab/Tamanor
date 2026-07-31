/**
 * CI-only READ-ONLY post-run verification for the manual production provider-credential backfill workflow.
 * Runs the counts-only inventory and asserts the safe invariants, then writes a redacted step summary. Never
 * returns/prints a token, ciphertext, fingerprint tied to an identity, tenant name, email, page name, or any PII.
 *
 * Fails (non-zero) if any cleared ("vault-only") account has an unusable vault, i.e. the migration would have
 * left an account without a usable credential. A corrupt vault anywhere is surfaced as a count for investigation.
 */
import { systemDb, providerCredentialInventory } from "../src/index";
import { writeStepSummary } from "./family-activation-counts";

async function main(): Promise<number> {
  const inv = await providerCredentialInventory();
  const failures: string[] = [];
  if (inv.vaultOnlyUnusable > 0) failures.push(`${inv.vaultOnlyUnusable} cleared account(s) have an unusable vault`);

  writeStepSummary("Provider credential backfill — post-run inventory", {
    totalMetaAccounts: inv.totalMetaAccounts,
    legacyPopulated: inv.legacyPopulated,
    withActiveVault: inv.withActiveVault,
    legacyAndVault: inv.legacyAndVault,
    legacyOnly: inv.legacyOnly,
    vaultOnly: inv.vaultOnly,
    neither: inv.neither,
    legacyMatchesVault: inv.legacyMatchesVault,
    corruptVault: inv.corruptVault,
    vaultOnlyUnusable: inv.vaultOnlyUnusable,
    capped: inv.capped,
    ok: failures.length === 0,
  });

  if (failures.length) {
    console.error("✗ Post-run verification failed:\n" + failures.map((f) => `  - ${f}`).join("\n"));
    return 1;
  }
  console.log(`✓ Post-run verification passed (total=${inv.totalMetaAccounts}, legacyOnly=${inv.legacyOnly}, vaultOnly=${inv.vaultOnly}, corrupt=${inv.corruptVault}).`);
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => { console.error("✗ Verify error:", (e as Error).name); process.exit(1); })
  .finally(() => { void systemDb.$disconnect(); });
