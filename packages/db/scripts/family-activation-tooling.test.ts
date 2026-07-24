/**
 * FAMILY-BILLING ACTIVATION TOOLING — PURE logic tests (no DB, no network, no GitHub). Covers the full
 * safety surface of the production-migration workflow + readiness validator: input validation, the
 * exact confirmation phrase, expected-migration + unexpected-pending gating, localhost refusal, host
 * fingerprint mismatch, legacy-count ceiling, pre/post preservation compare, readiness modes, Stripe
 * price format/duplicate/collision detection, and secret/price-id redaction.
 * Run: pnpm family-activation-tooling:test
 */
import {
  validateMigrationInputs, assertProductionTarget, databaseHostFingerprint,
  evaluatePendingMigrations, evaluateLegacyCeiling, comparePreservation,
  redactPriceId, validateFamilyPriceConfig, evaluateReadiness,
  EXPECTED_PRODUCTION_MIGRATION, MIGRATION_CONFIRMATION_PHRASE, FAMILY_PRICE_ENV_NAMES,
  DEFAULT_MAX_LEGACY_FAMILY_TENANTS, type TenantCounts, type ReadinessFacts, type FamilyPriceReadiness,
} from "./family-activation";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const PROD_URL = "postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

// Six valid, distinct, Stripe-shaped Family price ids.
const VALID_PRICES: Record<string, string> = {
  STRIPE_FAMILY_BASIC_MONTHLY_PRICE_ID: "price_basicM01", STRIPE_FAMILY_BASIC_YEARLY_PRICE_ID: "price_basicY01",
  STRIPE_FAMILY_PLUS_MONTHLY_PRICE_ID: "price_plusM01", STRIPE_FAMILY_PLUS_YEARLY_PRICE_ID: "price_plusY01",
  STRIPE_FAMILY_PREMIUM_MONTHLY_PRICE_ID: "price_premM01", STRIPE_FAMILY_PREMIUM_YEARLY_PRICE_ID: "price_premY01",
};
const countsBase: TenantCounts = {
  familyFreeTrial: 5, familyFree: 10, familyBasic: 0, familyPlus: 0, familyPremium: 0,
  businessByPlan: { free_trial: 3, agency: 2 },
  protectedProfiles: 20, guardianRelationships: 15, familyInvitations: 4, familyMemberships: 12, safetySignals: 30, subscriptions: 6, stripeCustomerMappings: 6,
};
const facts = (o: Partial<Omit<ReadinessFacts, "price">> & { price?: Partial<FamilyPriceReadiness> } = {}): ReadinessFacts => {
  const { price, ...rest } = o;
  return {
    flagEnabled: false, migrationApplied: true, familyTrialConsumedColumnExists: true, zeroFamilyFreeTrial: true,
    onlyExpectedFamilyPlans: true, noFamilyOnBusinessPlan: true,
    ...rest,
    price: { allPresent: true, formatOk: true, duplicates: false, businessCollision: false, perKey: {}, ...(price ?? {}) },
  };
};

function main() {
  // A. arming inputs
  console.log("\nA. workflow_dispatch input validation");
  check("valid inputs pass", validateMigrationInputs({ environment: "production", expectedMigration: EXPECTED_PRODUCTION_MIGRATION, confirmation: MIGRATION_CONFIRMATION_PHRASE }).ok);
  check("★ wrong confirmation phrase rejected", !validateMigrationInputs({ environment: "production", expectedMigration: EXPECTED_PRODUCTION_MIGRATION, confirmation: "apply" }).ok);
  check("★ confirmation with trailing space rejected (exact match)", !validateMigrationInputs({ environment: "production", expectedMigration: EXPECTED_PRODUCTION_MIGRATION, confirmation: MIGRATION_CONFIRMATION_PHRASE + " " }).ok);
  check("wrong expected_migration rejected", !validateMigrationInputs({ environment: "production", expectedMigration: "20200101000000_other", confirmation: MIGRATION_CONFIRMATION_PHRASE }).ok);
  check("non-production environment rejected", !validateMigrationInputs({ environment: "staging", expectedMigration: EXPECTED_PRODUCTION_MIGRATION, confirmation: MIGRATION_CONFIRMATION_PHRASE }).ok);

  // B. production target
  console.log("\nB. production database-target safety");
  check("production URL accepted", assertProductionTarget({ url: PROD_URL, environment: "production" }).ok);
  check("★ localhost rejected", !assertProductionTarget({ url: "postgresql://u:p@localhost:5433/tamanor", environment: "production" }).ok);
  check("★ 127.0.0.1 rejected", !assertProductionTarget({ url: "postgresql://u:p@127.0.0.1:5432/db", environment: "production" }).ok);
  check("★ single-label docker host rejected", !assertProductionTarget({ url: "postgresql://u:p@postgres:5432/db", environment: "production" }).ok);
  check("missing URL rejected", !assertProductionTarget({ url: undefined, environment: "production" }).ok);
  check("unparseable URL rejected", !assertProductionTarget({ url: "not a url", environment: "production" }).ok);
  const fp = databaseHostFingerprint(PROD_URL);
  check("fingerprint is a stable 16-hex", typeof fp === "string" && /^[0-9a-f]{16}$/.test(fp!) && fp === databaseHostFingerprint(PROD_URL));
  check("matching fingerprint accepted", assertProductionTarget({ url: PROD_URL, environment: "production", expectedFingerprint: fp }).ok);
  check("★ fingerprint mismatch rejected", !assertProductionTarget({ url: PROD_URL, environment: "production", expectedFingerprint: "deadbeefdeadbeef" }).ok);

  // C. pending migrations
  console.log("\nC. pending-migration gating");
  check("only the expected migration pending → ok", evaluatePendingMigrations([EXPECTED_PRODUCTION_MIGRATION]).ok);
  check("nothing pending → rejected (not pending)", !evaluatePendingMigrations([]).ok);
  check("★ unexpected extra pending migration → rejected", !evaluatePendingMigrations([EXPECTED_PRODUCTION_MIGRATION, "20990101000000_surprise"]).ok);
  check("a different single pending → rejected", !evaluatePendingMigrations(["20990101000000_surprise"]).ok);

  // D. legacy ceiling
  console.log("\nD. legacy-count ceiling");
  check("within ceiling → ok", evaluateLegacyCeiling(5, 100).ok);
  check("at ceiling → ok", evaluateLegacyCeiling(100, 100).ok);
  check("★ over ceiling → rejected", !evaluateLegacyCeiling(101, 100).ok);
  check("default ceiling constant is conservative (100)", DEFAULT_MAX_LEGACY_FAMILY_TENANTS === 100);
  check("negative/NaN count → rejected", !evaluateLegacyCeiling(-1).ok && !evaluateLegacyCeiling(NaN).ok);

  // E. pre/post preservation
  console.log("\nE. pre/post preservation compare");
  const good = { ...countsBase, familyFreeTrial: 0, familyFree: countsBase.familyFree + countsBase.familyFreeTrial };
  check("correct reconcile (free_trial→family_free, all else equal) → ok", comparePreservation(countsBase, good).ok);
  check("★ remaining free_trial → failure", !comparePreservation(countsBase, { ...good, familyFreeTrial: 1 }).ok);
  check("★ Business plan count changed → failure", !comparePreservation(countsBase, { ...good, businessByPlan: { free_trial: 2, agency: 2 } }).ok);
  check("★ protected-profile count changed → failure", !comparePreservation(countsBase, { ...good, protectedProfiles: 19 }).ok);
  check("★ paid Family (family_plus) count changed → failure", !comparePreservation(countsBase, { ...good, familyPlus: 1 }).ok);
  check("★ subscriptions/Stripe mappings changed → failure", !comparePreservation(countsBase, { ...good, subscriptions: 5 }).ok && !comparePreservation(countsBase, { ...good, stripeCustomerMappings: 5 }).ok);

  // F. price redaction
  console.log("\nF. Stripe price-id redaction");
  check("★ a price id is NEVER shown in full (presence + last 4)", redactPriceId("price_1ABCDEFsecret") === "present(…cret)");
  check("absent → 'absent'", redactPriceId(undefined) === "absent" && redactPriceId("") === "absent");

  // G. Family price config validation
  console.log("\nG. Family Stripe price configuration");
  const okCfg = validateFamilyPriceConfig(VALID_PRICES);
  check("all six valid + unique + no collision → ready", okCfg.allPresent && okCfg.formatOk && !okCfg.duplicates && !okCfg.businessCollision);
  check("★ perKey values are redacted (no raw ids)", Object.values(okCfg.perKey).every((v) => v === "absent" || /^present\(….{1,4}\)$/.test(v)) && !Object.values(okCfg.perKey).some((v) => v.includes("price_")));
  check("★ missing a variable → not all present", !validateFamilyPriceConfig({ ...VALID_PRICES, STRIPE_FAMILY_BASIC_MONTHLY_PRICE_ID: "" }).allPresent);
  check("★ invalid Stripe shape (underscores) → format not ok", !validateFamilyPriceConfig({ ...VALID_PRICES, STRIPE_FAMILY_PLUS_MONTHLY_PRICE_ID: "price_bad_id" }).formatOk);
  check("★ duplicate Family price id → duplicates flagged", validateFamilyPriceConfig({ ...VALID_PRICES, STRIPE_FAMILY_PLUS_MONTHLY_PRICE_ID: "price_basicM01" }).duplicates);
  check("★ collision with a Business price id → businessCollision flagged",
    validateFamilyPriceConfig({ ...VALID_PRICES, STRIPE_PRICE_STARTER_MONTHLY: "price_basicM01" }).businessCollision);
  check("no Business vars present → no false collision", !validateFamilyPriceConfig(VALID_PRICES).businessCollision);
  check("all six env NAMES are the expected contract", FAMILY_PRICE_ENV_NAMES.length === 6 && FAMILY_PRICE_ENV_NAMES.includes("STRIPE_FAMILY_BASIC_MONTHLY_PRICE_ID"));

  // H. readiness modes
  console.log("\nH. readiness modes");
  check("★ preflight requires flag OFF (on → fail)", !evaluateReadiness("preflight", facts({ flagEnabled: true })).ok);
  check("preflight with flag OFF → ok (db/price informational)", evaluateReadiness("preflight", facts({ flagEnabled: false, migrationApplied: false })).ok);
  check("activation with all prerequisites → ok", evaluateReadiness("activation", facts()).ok);
  check("★ activation with missing migration → fail", !evaluateReadiness("activation", facts({ migrationApplied: false })).ok);
  check("★ activation with missing price vars → fail", !evaluateReadiness("activation", facts({ price: { allPresent: false } })).ok);
  check("★ activation with invalid price format → fail", !evaluateReadiness("activation", facts({ price: { formatOk: false } })).ok);
  check("★ activation with duplicate/collision prices → fail", !evaluateReadiness("activation", facts({ price: { duplicates: true } })).ok && !evaluateReadiness("activation", facts({ price: { businessCollision: true } })).ok);
  check("★ activation with family on business plan → fail", !evaluateReadiness("activation", facts({ noFamilyOnBusinessPlan: false })).ok);
  check("★ post-activation requires flag ON (off → fail)", !evaluateReadiness("post-activation", facts({ flagEnabled: false })).ok);
  check("post-activation with flag ON + all ready → ok", evaluateReadiness("post-activation", facts({ flagEnabled: true })).ok);
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — FAMILY-BILLING activation tooling: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
