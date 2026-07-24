/**
 * FAMILY-BILLING production readiness validator (READ-ONLY). Checks that every prerequisite for
 * activating Family billing is in place, and exits non-zero when incomplete. Three modes:
 *
 *   preflight        — expects FAMILY_BILLING_ENABLED OFF; reports DB + price status (informational).
 *   activation       — requires the S3A migration applied AND all six valid, unique, non-colliding
 *                      Family Stripe price ids present (flag may still be OFF — validate BEFORE flip).
 *   post-activation  — requires the flag ON AND all DB + price prerequisites valid.
 *
 * NEVER prints a full Stripe Price ID (presence + last 4 only) and NEVER prints a DATABASE_URL.
 * Usage: tsx family-billing-production-readiness.ts <preflight|activation|post-activation>
 */
import { familyBillingEnabled } from "@guardora/core";
import {
  evaluateReadiness, validateFamilyPriceConfig, READINESS_MODES, type ReadinessMode, type ReadinessFacts,
} from "./family-activation";
import { collectReadinessDbFacts } from "./family-activation-counts";

async function main() {
  const mode = (process.argv[2] ?? process.env.READINESS_MODE ?? "preflight").trim() as ReadinessMode;
  if (!READINESS_MODES.includes(mode)) {
    console.error(`Unknown mode "${mode}". Use one of: ${READINESS_MODES.join(" | ")}`);
    process.exit(2);
  }

  const dbFacts = await collectReadinessDbFacts();
  const price = validateFamilyPriceConfig(process.env);
  const facts: ReadinessFacts = { flagEnabled: familyBillingEnabled(), ...dbFacts, price };
  const res = evaluateReadiness(mode, facts);

  const report = {
    mode,
    familyBillingEnabled: facts.flagEnabled,
    database: dbFacts,
    price: { allPresent: price.allPresent, formatOk: price.formatOk, duplicates: price.duplicates, businessCollision: price.businessCollision, perKey: price.perKey },
    ok: res.ok,
    failures: res.failures,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!res.ok) {
    console.error(`✗ Readiness (${mode}) FAILED:\n` + res.failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  console.log(`✓ Readiness (${mode}) passed.`);
  process.exit(0);
}

main().catch((e) => { console.error("✗ Readiness check failed:", (e as Error).message); process.exit(1); });
