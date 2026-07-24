/**
 * FAMILY-BILLING — public pricing-card alignment. Proves the landing Family cards (the approved
 * commercial catalogue in components/landing-v2/family-plans.ts) match the website exactly and map
 * correctly to internal billing plans, and that their customer-facing names agree with the backend
 * catalogue (FAMILY_BILLING_PLANS) so the two can never drift.
 * Run: pnpm family-plans-ui:test
 */
import { FAMILY_PUBLIC_CARDS, familyYearlyPrice, FAMILY_CARD_MONTHLY_PRICES } from "../src/components/landing-v2/family-plans";
import { FAMILY_BILLING_PLANS, isFamilySelfServePlan } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const names = FAMILY_PUBLIC_CARDS.map((c) => c.name);
const planIds = FAMILY_PUBLIC_CARDS.map((c) => c.planId);
const monthly = FAMILY_PUBLIC_CARDS.map((c) => c.monthly);

console.log("\nA. public names + card order (must match the website)");
check("names are exactly Family / Family Plus / Family Pro / Custom", JSON.stringify(names) === JSON.stringify(["Family", "Family Plus", "Family Pro", "Custom"]));

console.log("\nB. monthly + yearly prices (approved)");
check("monthly prices: 7.99 / 14.99 / 24.99 / Custom", JSON.stringify(monthly) === JSON.stringify([7.99, 14.99, 24.99, null]));
check("FAMILY_CARD_MONTHLY_PRICES mirrors the cards", JSON.stringify([...FAMILY_CARD_MONTHLY_PRICES]) === JSON.stringify(monthly));
check("yearly = 10× monthly (~2 months free): 79.90 / 149.90 / 249.90",
  familyYearlyPrice(7.99) === 79.9 && familyYearlyPrice(14.99) === 149.9 && familyYearlyPrice(24.99) === 249.9);

console.log("\nC. card → internal plan mapping");
check("planIds: family_basic / family_plus / family_premium / null(Custom)", JSON.stringify(planIds) === JSON.stringify(["family_basic", "family_plus", "family_premium", null]));
check("★ NO paid card maps to family_free (free is never sold)", !planIds.includes("family_free"));
const custom = FAMILY_PUBLIC_CARDS.find((c) => c.name === "Custom");
check("★ Custom is contact-only (planId null, not self-serve)", custom?.planId === null && custom?.selfServe === false);
check("every paid card maps to a real self-serve plan", FAMILY_PUBLIC_CARDS.filter((c) => c.selfServe).every((c) => isFamilySelfServePlan(c.planId)));

console.log("\nD. public name ↔ backend catalogue consistency (no drift)");
for (const card of FAMILY_PUBLIC_CARDS) {
  if (!card.planId) continue; // Custom has no internal plan
  check(`${card.name} → ${card.planId} catalogue name matches`, FAMILY_BILLING_PLANS[card.planId].name === card.name);
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — FAMILY public pricing-card alignment: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
