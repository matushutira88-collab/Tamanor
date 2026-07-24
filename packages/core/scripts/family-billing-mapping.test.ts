/**
 * FAMILY-BILLING S3 — PURE mapping tests (no DB, no Stripe). Proves:
 *   • env-var Family price resolution (family_free has none; missing/blank fails closed);
 *   • reverse price→plan lookup, and strict separation from the Business mapping (neither leaks into
 *     the other);
 *   • the central FAMILY_BILLING_ENABLED reader;
 *   • the subscription-lifecycle → effective (plan, access) mapping, incl. the Family floor
 *     (canceled / expired / unpaid → family_free/full_access, never restricted).
 * Run: pnpm family-billing-mapping:test
 */
import {
  resolveFamilyStripePriceId, familyPlanForStripePriceId, isFamilySelfServePlan,
  familyBillingEnabled, resolveFamilyBillingState,
  resolveStripePriceId, planForStripePriceId,
} from "../src/index";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

// A self-contained env with BOTH Family and Business prices configured, to prove strict separation.
const ENV: Record<string, string | undefined> = {
  STRIPE_FAMILY_PLUS_MONTHLY_PRICE_ID: "price_fam_plus_m",
  STRIPE_FAMILY_PLUS_YEARLY_PRICE_ID: "price_fam_plus_y",
  STRIPE_FAMILY_PREMIUM_MONTHLY_PRICE_ID: "price_fam_prem_m",
  STRIPE_FAMILY_PREMIUM_YEARLY_PRICE_ID: "price_fam_prem_y",
  STRIPE_PRICE_STARTER_MONTHLY: "price_biz_starter_m",
  STRIPE_PRICE_GROWTH_YEARLY: "price_biz_growth_y",
};
const NOW = new Date("2026-07-01T00:00:00Z");
const future = (d: number) => new Date(NOW.getTime() + d * 864e5);
const past = (d: number) => new Date(NOW.getTime() - d * 864e5);

function main() {
  // A. price resolution
  console.log("\nA. Family price resolution (env-var names only)");
  check("family_plus monthly resolves configured id", resolveFamilyStripePriceId("family_plus", "monthly", ENV) === "price_fam_plus_m");
  check("family_plus yearly resolves configured id", resolveFamilyStripePriceId("family_plus", "yearly", ENV) === "price_fam_plus_y");
  check("family_premium monthly resolves configured id", resolveFamilyStripePriceId("family_premium", "monthly", ENV) === "price_fam_prem_m");
  check("family_premium yearly resolves configured id", resolveFamilyStripePriceId("family_premium", "yearly", ENV) === "price_fam_prem_y");
  check("★ family_free has NO price (null)", resolveFamilyStripePriceId("family_free", "monthly", ENV) === null);
  check("unset env → null (fail closed)", resolveFamilyStripePriceId("family_plus", "monthly", {}) === null);
  check("blank env → null (fail closed)", resolveFamilyStripePriceId("family_plus", "monthly", { STRIPE_FAMILY_PLUS_MONTHLY_PRICE_ID: "  " }) === null);

  // B. reverse lookup + separation
  console.log("\nB. reverse lookup + Business/Family separation");
  check("reverse family_plus monthly", JSON.stringify(familyPlanForStripePriceId("price_fam_plus_m", ENV)) === JSON.stringify({ plan: "family_plus", interval: "monthly" }));
  check("reverse family_premium yearly", JSON.stringify(familyPlanForStripePriceId("price_fam_prem_y", ENV)) === JSON.stringify({ plan: "family_premium", interval: "yearly" }));
  check("reverse unknown price → null", familyPlanForStripePriceId("price_unknown", ENV) === null);
  check("★ a BUSINESS price never maps to a Family plan", familyPlanForStripePriceId("price_biz_starter_m", ENV) === null);
  check("★ a FAMILY price never maps to a Business plan", planForStripePriceId("price_fam_plus_m", ENV) === null);
  check("Business mapping still works (control)", JSON.stringify(planForStripePriceId("price_biz_starter_m", ENV)) === JSON.stringify({ plan: "starter", interval: "monthly" }));
  check("isFamilySelfServePlan: plus/premium true, free false", isFamilySelfServePlan("family_plus") && isFamilySelfServePlan("family_premium") && !isFamilySelfServePlan("family_free"));

  // C. flag reader
  console.log("\nC. FAMILY_BILLING_ENABLED reader");
  check('"1" → on', familyBillingEnabled({ FAMILY_BILLING_ENABLED: "1" }));
  check('"true" → on', familyBillingEnabled({ FAMILY_BILLING_ENABLED: "true" }));
  check("unset → off", !familyBillingEnabled({}));
  check('"0"/"false"/"x" → off', !familyBillingEnabled({ FAMILY_BILLING_ENABLED: "0" }) && !familyBillingEnabled({ FAMILY_BILLING_ENABLED: "false" }) && !familyBillingEnabled({ FAMILY_BILLING_ENABLED: "x" }));

  // D. lifecycle → effective (plan, access)
  console.log("\nD. subscription lifecycle → effective (plan, access)");
  const r = (o: Parameters<typeof resolveFamilyBillingState>[0]) => resolveFamilyBillingState({ now: NOW, ...o });
  const eq = (x: { plan: string; accessState: string }, plan: string, access: string) => x.plan === plan && x.accessState === access;
  check("active paid → paid plan / full_access", eq(r({ paidPlan: "family_plus", status: "active" }), "family_plus", "full_access"));
  check("trialing (trial in future) → paid plan / full_access", eq(r({ paidPlan: "family_premium", status: "trialing", trialEndsAt: future(5) }), "family_premium", "full_access"));
  check("★ trialing (trial expired) → family_free / full_access", eq(r({ paidPlan: "family_plus", status: "trialing", trialEndsAt: past(1) }), "family_free", "full_access"));
  check("canceled but still within paid period → paid plan / full_access", eq(r({ paidPlan: "family_plus", status: "canceled", currentPeriodEnd: future(10) }), "family_plus", "full_access"));
  check("★ canceled past paid period → family_free / full_access", eq(r({ paidPlan: "family_plus", status: "canceled", currentPeriodEnd: past(1) }), "family_free", "full_access"));
  check("past_due within grace → paid plan / grace_period", eq(r({ paidPlan: "family_plus", status: "past_due", currentPeriodEnd: past(1) }), "family_plus", "grace_period"));
  check("★ past_due beyond grace → family_free / full_access", eq(r({ paidPlan: "family_plus", status: "past_due", currentPeriodEnd: past(30) }), "family_free", "full_access"));
  check("★ unpaid → family_free / full_access (never restricted)", eq(r({ paidPlan: "family_premium", status: "unpaid" }), "family_free", "full_access"));
  check("★ no_subscription → family_free / full_access", eq(r({ paidPlan: "family_free", status: "no_subscription" }), "family_free", "full_access"));
  check("★ unknown status → family_free / full_access (fail safe)", eq(r({ paidPlan: "family_plus", status: "weird_status" }), "family_free", "full_access"));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — FAMILY-BILLING S3 mapping: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
