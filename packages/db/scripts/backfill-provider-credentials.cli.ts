/**
 * LEGACY → VAULT credential backfill CLI. DRY-RUN by default: prints a counts-only receipt and mutates nothing.
 * PRODUCTION-CAPABLE but fail-closed via the pure `armBackfill` guard. Production apply is allowed ONLY through
 * the armed manual workflow (production-provider-credential-backfill) — this CLI is the thin, bounded runner.
 *
 * Usage:
 *   tsx scripts/backfill-provider-credentials.cli.ts                                   # dry run (default)
 *   tsx ... --apply --confirm MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT                    # local apply
 *   tsx ... --apply --environment production --confirm MIGRATE_... --batch-size 25 --max-batches 1 --cursor <id>
 *
 * Bounded scope: each invocation processes at most `--max-batches` (default 1, hard max 25) batches of
 * `--batch-size` (default 100, hard max 1000). NO unbounded internal loop. Resume with the printed next cursor.
 *
 * Exit codes (documented + tested):
 *   0  success (dry-run, or apply with zero errors and post-verify OK)
 *   1  arming refused (bad phrase / env / fingerprint / cursor / missing vault key)
 *   2  apply completed but had errors, OR post-run verification failed, OR dry-run mutation detected
 *   3  unexpected crash
 *
 * Never prints: DATABASE_URL, token, ciphertext, wrapped key, IV/tag, KEK, or PII — only counts + a
 * non-reversible host fingerprint + an opaque next cursor.
 */
import {
  backfillProviderCredentials, providerCredentialInventory, verifyBackfillRun, assertNoMutation,
  systemDb, type BackfillResult,
} from "../src/index";
import { armBackfill, BACKFILL_APPLY_PHRASE } from "./provider-credential-backfill-arming";
import { writeStepSummary } from "./family-activation-counts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  // Inputs come from CLI args (local) OR env (the manual workflow passes them via env — never secret shell args).
  const apply = process.argv.includes("--apply") || process.env.BACKFILL_MODE === "apply";
  const batchSize = Number(arg("--batch-size") ?? process.env.BACKFILL_BATCH_SIZE ?? "") || undefined;
  const maxBatches = Number(arg("--max-batches") ?? process.env.BACKFILL_MAX_BATCHES ?? "") || undefined;
  const cursorInput = arg("--cursor") ?? process.env.BACKFILL_CURSOR ?? undefined;
  const confirmation = arg("--confirm") ?? process.env.BACKFILL_CONFIRMATION;

  const armed = armBackfill({
    apply,
    environment: arg("--environment") ?? process.env.BACKFILL_ENVIRONMENT,
    confirmation,
    batchSize,
    maxBatches,
    cursor: cursorInput,
    databaseUrl: process.env.DATABASE_URL,
    expectedFingerprint: process.env.PRODUCTION_DATABASE_HOST_FINGERPRINT || null,
    // Local convenience allows the TOKEN_ENCRYPTION_KEY fallback; the PRODUCTION workflow's preflight requires a
    // dedicated 32-byte PROVIDER_VAULT_KEK and never reaches here without it.
    vaultKeyConfigured: Boolean(process.env.PROVIDER_VAULT_KEK || process.env.TOKEN_ENCRYPTION_KEY),
  });

  if (!armed.ok) {
    console.error(`\n✗ Refusing to proceed (mode: ${armed.mode}, host fingerprint: ${armed.fingerprint ?? "n/a"}):\n` + armed.errors.map((e) => `  - ${e}`).join("\n"));
    console.error(`\n  A production apply needs: --apply --environment production --confirm ${BACKFILL_APPLY_PHRASE}\n`);
    return 1;
  }

  const isApply = armed.mode !== "dry-run";
  const before = await providerCredentialInventory();

  console.log(`→ provider-credential backfill (${armed.mode}, batch ${armed.batchSize}, max-batches ${armed.maxBatches}, host fingerprint ${armed.fingerprint ?? "n/a"})`);
  const totals = { scanned: 0, skippedNoToken: 0, alreadyVaulted: 0, backfilled: 0, verified: 0, legacyCleared: 0, errors: 0 };
  let cursor: string | null = armed.cursor;
  let batches = 0;
  let last: BackfillResult | null = null;
  // BOUNDED: at most `maxBatches` iterations. No 100000 loop.
  for (let i = 0; i < armed.maxBatches; i++) {
    const res = await backfillProviderCredentials({ apply: isApply, batchSize: armed.batchSize, cursor });
    last = res;
    batches++;
    totals.scanned += res.scanned; totals.skippedNoToken += res.skippedNoToken; totals.alreadyVaulted += res.alreadyVaulted;
    totals.backfilled += res.backfilled; totals.verified += res.verified; totals.legacyCleared += res.legacyCleared; totals.errors += res.errors;
    cursor = res.nextCursor;
    if (cursor === null) break; // drained
  }

  const after = await providerCredentialInventory();
  const runSummary: BackfillResult = { ...totals, dryRun: !isApply, nextCursor: cursor };
  const verify = verifyBackfillRun(runSummary, after);
  const noMutation = isApply ? { ok: true, failures: [] } : assertNoMutation(before, after);

  // Counts + mode + batches + fingerprint + next cursor. NO secrets.
  console.log("  scanned:        ", totals.scanned);
  console.log("  skippedNoToken: ", totals.skippedNoToken);
  console.log("  alreadyVaulted: ", totals.alreadyVaulted);
  console.log("  backfilled:     ", totals.backfilled);
  console.log("  verified:       ", totals.verified);
  console.log("  legacyCleared:  ", totals.legacyCleared, isApply ? "" : "(dry-run: 0)");
  console.log("  errors:         ", totals.errors);
  console.log("  batchesRun:     ", batches);
  console.log("  nextCursor:     ", cursor ?? "DONE");
  console.log("  inventory(after): totalMeta=", after.totalMetaAccounts, "legacyOnly=", after.legacyOnly, "vaultOnly=", after.vaultOnly, "both=", after.legacyAndVault, "corruptVault=", after.corruptVault);

  // Safe GitHub Step Summary (counts / mode / next cursor only — NO secrets).
  writeStepSummary("Provider credential backfill — run", {
    mode: armed.mode, batchSize: armed.batchSize, maxBatches: armed.maxBatches, batchesRun: batches,
    scanned: totals.scanned, backfilled: totals.backfilled, verified: totals.verified,
    legacyCleared: totals.legacyCleared, errors: totals.errors, nextCursor: cursor ?? "DONE",
    hostFingerprint: armed.fingerprint ?? "n/a",
  });

  if (!verify.ok || !noMutation.ok) {
    console.error("\n✗ post-run verification failed:\n" + [...verify.failures, ...noMutation.failures].map((f) => `  - ${f}`).join("\n"));
    return 2;
  }
  if (isApply && totals.errors > 0) {
    console.error(`\n✗ apply completed with ${totals.errors} error(s) — legacy preserved on those; investigate.`);
    return 2;
  }
  console.log(`\n${isApply ? "APPLY complete." : "DRY-RUN complete — nothing mutated."} ${cursor ? `Resume with --cursor ${cursor}.` : "DONE."}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error("✗ backfill crashed:", (e as Error).name); process.exit(3); })
  .finally(() => { void systemDb.$disconnect(); });
