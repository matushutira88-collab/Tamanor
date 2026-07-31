/**
 * LEGACY → VAULT credential backfill CLI. DRY-RUN by default: prints a counts-only receipt and mutates nothing.
 *
 * Usage:
 *   tsx scripts/backfill-provider-credentials.cli.ts            # dry run (default) — safe, read-only
 *   tsx scripts/backfill-provider-credentials.cli.ts --apply    # apply — stores vault creds + clears verified legacy columns
 *
 * SAFETY:
 *   - Refuses to run against a non-local DB (reuses the local-DB guard) — never run against production this phase.
 *   - `--apply` additionally requires TAMANOR_BACKFILL_CONFIRM=1 (double opt-in).
 *   - Requires a vault key (PROVIDER_VAULT_KEK or TOKEN_ENCRYPTION_KEY) — fails closed otherwise.
 *   - Never prints a token, ciphertext, or PII — only counts.
 */
import { assertLocalDb } from "./assert-local-db";
import { backfillProviderCredentials, systemDb } from "../src/index";

async function main() {
  assertLocalDb(); // hard stop on a remote DB

  const apply = process.argv.includes("--apply");
  if (apply && process.env.TAMANOR_BACKFILL_CONFIRM !== "1") {
    console.error("\n✗ --apply requires TAMANOR_BACKFILL_CONFIRM=1 (double opt-in). Refusing to mutate.\n");
    process.exit(1);
  }
  if (!process.env.PROVIDER_VAULT_KEK && !process.env.TOKEN_ENCRYPTION_KEY) {
    console.error("\n✗ no vault key configured (PROVIDER_VAULT_KEK or TOKEN_ENCRYPTION_KEY). Fail-closed.\n");
    process.exit(1);
  }

  console.log(`→ provider-credential backfill (${apply ? "APPLY" : "DRY-RUN"})`);
  const r = await backfillProviderCredentials({ apply });
  console.log("  scanned:        ", r.scanned);
  console.log("  skippedNoToken: ", r.skippedNoToken);
  console.log("  alreadyVaulted: ", r.alreadyVaulted);
  console.log("  backfilled:     ", r.backfilled);
  console.log("  verified:       ", r.verified);
  console.log("  legacyCleared:  ", r.legacyCleared, apply ? "" : "(dry-run: 0)");
  console.log("  errors:         ", r.errors);
  console.log(`\n${r.dryRun ? "DRY-RUN complete — nothing mutated. Re-run with --apply (and TAMANOR_BACKFILL_CONFIRM=1) to backfill." : "APPLY complete."}`);
}

main()
  .catch((e) => { console.error("✗ backfill crashed:", (e as Error).message); process.exit(1); })
  .finally(async () => { await systemDb.$disconnect(); });
