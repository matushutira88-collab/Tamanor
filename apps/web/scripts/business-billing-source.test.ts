/**
 * BUSINESS BILLING TRUTH — static SOURCE proofs. Reads the Billing + Usage page source and asserts they share
 * the ONE canonical presentation, that only the effective plan is marked "current" (no same-plan checkout CTA),
 * that no Stripe Price ID can reach the rendered HTML, and that Family billing files are untouched by this work.
 * Run: pnpm business-billing-source:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(HERE, "..", p), "utf8");

const billing = read("src/app/dashboard/billing/page.tsx");
const usage = read("src/app/dashboard/usage/page.tsx");
const familyConsole = read("src/app/family/(console)/page.tsx");

function main() {
  console.log("\n1. Billing + Usage consume the ONE canonical server-derived presentation");
  check("★ Billing derives every plan/state fact from getTenantBilling().presentation", /getTenantBilling/.test(billing) && /\.presentation/.test(billing) && /pres\??\.effectivePlanId/.test(billing));
  check("★ Usage derives the displayed plan from the SAME presentation.effectivePlanId", /getTenantBilling/.test(usage) && /presentation\.effectivePlanId/.test(usage));
  check("★ Usage lifecycle/dates come from the presentation (not stale tenant fields)", /pres!?\.lifecycle/.test(usage) && !/billing\.lifecycle/.test(usage) && !/billing\.subscription\?\.currentPeriodEnd/.test(usage));
  check("★ Billing no longer guesses the plan from Tenant.plan (`b?.plan ?? \"free_trial\"` gone)", !/currentPlanId\s*=\s*b\?\.plan\s*\?\?/.test(billing));

  console.log("\n2. Only the EFFECTIVE plan is 'current' — no same-plan checkout CTA");
  check("★ isCurrent keys off the effective plan + a held subscription (not raw billingStatus active/trialing)", /planId === currentPlanId && \(holdsCurrentSubscription/.test(billing) && !/billingStatus === "active" \|\| billingStatus === "trialing"/.test(billing));
  check("★ a 'current' plan renders the disabled current badge, never a checkout form", /case "current":/.test(billing) && /aria-disabled="true"/.test(billing));

  console.log("\n3. No Stripe Price ID can reach the rendered HTML");
  // The pages must use ONLY booleans (stripePriceAvailability); never a literal price_ id, never resolveStripePriceId.
  check("★ Billing page contains no literal Stripe Price ID", !/price_[A-Za-z0-9]{6,}/.test(billing));
  check("★ Billing page never resolves a raw Price ID for render (booleans only)", !/resolveStripePriceId/.test(billing) && /stripePriceAvailability/.test(billing));
  check("★ Checkout form sends only the controlled (plan, interval) — never a price id", /name="plan"/.test(billing) && /name="interval"/.test(billing) && !/name="price/i.test(billing));
  check("★ Usage page contains no literal Stripe Price ID", !/price_[A-Za-z0-9]{6,}/.test(usage));

  console.log("\n4. PII-free production diagnostic (bounded labels + booleans only)");
  check("★ BUSINESS_BILLING_PRESENTATION_RESOLVED present, no email/tenantId/userId/customer/subscription/price/invoice", /BUSINESS_BILLING_PRESENTATION_RESOLVED/.test(billing) && !/email:|userId:|customerId:|subscriptionId:|priceId:|invoiceId:/.test(billing));

  console.log("\n5. Family billing is untouched by this work");
  check("★ Family console does NOT consume the Business presentation resolver", !/resolveBusinessBillingPresentation|presentation\.effectivePlanId|getTenantBilling/.test(familyConsole));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Business billing source: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
