/**
 * LEGACY → VAULT credential backfill CLI. DRY-RUN by default: prints a counts-only receipt and mutates nothing.
 * PRODUCTION-CAPABLE but fail-closed via the pure `armBackfill` guard — safe for a later approved production run.
 *
 * Usage:
 *   tsx scripts/backfill-provider-credentials.cli.ts                       # dry run (default) — read-only
 *   tsx scripts/backfill-provider-credentials.cli.ts --apply --confirm ... # local apply (exact phrase required)
 *   ... --apply --environment production --confirm MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT --batch-size 100
 *
 * Arming (pure, unit-tested in provider-credential-backfill-arming.test.ts):
 *   - dry-run needs only a configured vault key;
 *   - any apply needs the exact confirmation phrase;
 *   - a production (non-local) target additionally needs `--environment production` and, when
 *     PRODUCTION_DATABASE_HOST_FINGERPRINT is set, a host-fingerprint match.
 * Never prints a DATABASE_URL, token, ciphertext or key — only counts + a non-reversible host fingerprint.
 */
import { backfillProviderCredentials, systemDb } from "../src/index";
import { armBackfill, BACKFILL_CONFIRMATION_PHRASE } from "./provider-credential-backfill-arming";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const batchSize = Number(arg("--batch-size") ?? "") || undefined;
  // The confirmation phrase may come from --confirm <phrase> or the env (CI-friendly).
  const confirmation = arg("--confirm") ?? process.env.TAMANOR_BACKFILL_CONFIRM;

  const armed = armBackfill({
    apply,
    environment: arg("--environment") ?? process.env.BACKFILL_ENVIRONMENT,
    confirmation,
    batchSize,
    databaseUrl: process.env.DATABASE_URL,
    expectedFingerprint: process.env.PRODUCTION_DATABASE_HOST_FINGERPRINT || null,
    vaultKeyConfigured: Boolean(process.env.PROVIDER_VAULT_KEK || process.env.TOKEN_ENCRYPTION_KEY),
  });

  if (!armed.ok) {
    console.error(`\n✗ Refusing to proceed (mode: ${armed.mode}, host fingerprint: ${armed.fingerprint ?? "n/a"}):\n` + armed.errors.map((e) => `  - ${e}`).join("\n"));
    console.error(`\n  Hint: a production apply needs --apply --environment production --confirm ${BACKFILL_CONFIRMATION_PHRASE}\n`);
    process.exit(1);
  }

  console.log(`→ provider-credential backfill (${armed.mode}, batch ${armed.batchSize}, host fingerprint ${armed.fingerprint ?? "n/a"})`);
  let cursor: string | null = null, round = 0;
  const totals = { scanned: 0, skippedNoToken: 0, alreadyVaulted: 0, backfilled: 0, verified: 0, legacyCleared: 0, errors: 0 };
  do {
    const res = await backfillProviderCredentials({ apply: armed.mode !== "dry-run", batchSize: armed.batchSize, cursor });
    totals.scanned += res.scanned; totals.skippedNoToken += res.skippedNoToken; totals.alreadyVaulted += res.alreadyVaulted;
    totals.backfilled += res.backfilled; totals.verified += res.verified; totals.legacyCleared += res.legacyCleared; totals.errors += res.errors;
    cursor = res.nextCursor;
    round++;
  } while (cursor && round < 100000);

  console.log("  scanned:        ", totals.scanned);
  console.log("  skippedNoToken: ", totals.skippedNoToken);
  console.log("  alreadyVaulted: ", totals.alreadyVaulted);
  console.log("  backfilled:     ", totals.backfilled);
  console.log("  verified:       ", totals.verified);
  console.log("  legacyCleared:  ", totals.legacyCleared, armed.mode === "dry-run" ? "(dry-run: 0)" : "");
  console.log("  errors:         ", totals.errors);
  console.log(`\n${armed.mode === "dry-run" ? "DRY-RUN complete — nothing mutated." : "APPLY complete."}`);
}

main()
  .catch((e) => { console.error("✗ backfill crashed:", (e as Error).name); process.exit(1); })
  .finally(async () => { await systemDb.$disconnect(); });
