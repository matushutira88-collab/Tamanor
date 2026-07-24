/**
 * FAMILY-BILLING S1 — Family catalogue + entitlement engine unit tests.
 *
 * Pure (no DB / network / browser). Proves:
 *   1. The Family plan catalogue is well-formed and carries NO pricing (approved decision 4).
 *   2. Family Free is a FULLY USABLE long-term plan (approved decision 1).
 *   3. `resolveFamilyEntitlements` applies access-state precedence exactly like Business
 *      (deletion > suspended > restricted > grace > full > unknown).
 *   4. ★ THE PERMANENT INVARIANT (approved decision 2): the critical child-safety guarantee is on in
 *      EVERY plan × EVERY access state × deleting — exhaustively — never reduced by billing.
 *
 * Run: pnpm family-entitlements:test
 */
import {
  FAMILY_BILLING_PLANS,
  FAMILY_PLAN_IDS,
  isFamilyPlanId,
  type FamilyPlanId,
} from "../src/family-billing";
import {
  resolveFamilyEntitlements,
  familyPlanEntitlements,
  familyResourceLimit,
  FAMILY_LIMITED_RESOURCES,
  CRITICAL_SAFETY_ALWAYS,
  type FamilyEntitlements,
  type CriticalSafetyGuarantee,
} from "../src/family-entitlements";
import {
  FamilyEntitlementError,
  isFamilyEntitlementError,
  isFamilyEntitlementCode,
  FAMILY_ENTITLEMENT_CODES,
} from "../src/family-entitlement-error";
import type { AccessState } from "../src/billing";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

const ALL_CRITICAL_ON = (c: CriticalSafetyGuarantee): boolean =>
  c.detection === true && c.classification === true && c.evidence === true &&
  c.incident === true && c.escalation === true && c.notification === true;

const ACCESS_STATES: (AccessState | string | null | undefined)[] = [
  "full_access", "grace_period", "restricted", "suspended",
  "no_subscription", "", null, undefined, "garbage_state",
];
const PLAN_INPUTS: (string | null | undefined)[] = [
  ...FAMILY_PLAN_IDS, "starter", "agency", "free_trial", "", null, undefined, "nonsense",
];

// ===========================================================================
// A. Catalogue
// ===========================================================================
console.log("\nA. Family plan catalogue");
check("exactly 3 plans", FAMILY_PLAN_IDS.length === 3 && Object.keys(FAMILY_BILLING_PLANS).length === 3);
check("plan ids: free, plus, premium", JSON.stringify([...FAMILY_PLAN_IDS]) === JSON.stringify(["family_free", "family_plus", "family_premium"]));
for (const id of FAMILY_PLAN_IDS) {
  const e = FAMILY_BILLING_PLANS[id];
  check(`[${id}] entry.id matches key`, e.id === id);
  check(`[${id}] has name + tagline`, e.name.length > 0 && e.tagline.length > 0);
  check(`[${id}] has feature bullets`, Array.isArray(e.features) && e.features.length >= 3);
  // Approved decision 4 — NO pricing anywhere in the catalogue.
  check(`[${id}] carries NO price fields`, !("priceMonthly" in e) && !("priceYearly" in e) && !("currency" in e) && !("env" in e) && !("price" in e));
}
check("Free is not self-serve; Plus/Premium are", FAMILY_BILLING_PLANS.family_free.selfServeCheckout === false && FAMILY_BILLING_PLANS.family_plus.selfServeCheckout === true && FAMILY_BILLING_PLANS.family_premium.selfServeCheckout === true);
check("isFamilyPlanId accepts known ids", FAMILY_PLAN_IDS.every(isFamilyPlanId));
check("isFamilyPlanId rejects Business ids + junk", !isFamilyPlanId("starter") && !isFamilyPlanId("agency") && !isFamilyPlanId("free_trial") && !isFamilyPlanId("") && !isFamilyPlanId(null) && !isFamilyPlanId(42));

// ===========================================================================
// B. Base entitlements — Free usable; Plus extends; Premium unlimited
// ===========================================================================
console.log("\nB. Base entitlements");
const free = familyPlanEntitlements("family_free");
const plus = familyPlanEntitlements("family_plus");
const prem = familyPlanEntitlements("family_premium");

check("Free is a usable long-term plan (>=2 profiles, >=2 guardians, can manage)",
  (free.maxProtectedProfiles ?? 0) >= 2 && (free.maxGuardians ?? 0) >= 2 && free.canManageFamily === true);
check("Free keeps billing + deletion access", free.billingAccess && free.deletionAccess);
check("Plus extends capacity beyond Free",
  (plus.maxProtectedProfiles ?? 0) > (free.maxProtectedProfiles ?? 0) &&
  (plus.maxGuardians ?? 0) > (free.maxGuardians ?? 0) &&
  (plus.historyRetentionDays ?? 0) > (free.historyRetentionDays ?? 0));
check("Plus adds convenience (push alerts, AI, reporting, export)",
  plus.nonCriticalAlerts === "email_push" && plus.aiAnalysis === "standard" && plus.reporting && plus.export);
check("Premium is unlimited capacity (null caps)",
  prem.maxProtectedProfiles === null && prem.maxGuardians === null && prem.maxFamilyMembers === null && prem.maxPendingInvitations === null && prem.historyRetentionDays === null);
check("Premium adds full AI + priority support", prem.aiAnalysis === "full" && prem.prioritySupport === true);
check("unknown plan → fail-safe minimal (no management, no capacity)",
  (() => { const m = familyPlanEntitlements("nonsense"); return m.canManageFamily === false && m.maxProtectedProfiles === 0 && m.maxGuardians === 0; })());

// ===========================================================================
// C. Access-state precedence
// ===========================================================================
console.log("\nC. Access-state precedence");
const full = resolveFamilyEntitlements("family_plus", "full_access");
const grace = resolveFamilyEntitlements("family_plus", "grace_period");
const restricted = resolveFamilyEntitlements("family_plus", "restricted");
const suspended = resolveFamilyEntitlements("family_plus", "suspended");
const deleting = resolveFamilyEntitlements("family_plus", "full_access", { deletingTenant: true });

check("full_access → plan honored", full.maxProtectedProfiles === 5 && full.canManageFamily === true && full.reporting === true);
check("grace_period → plan honored (not degraded on first failed payment)",
  grace.maxProtectedProfiles === 5 && grace.canManageFamily === true && grace.reporting === true && grace.aiAnalysis === "standard");
check("restricted → management frozen, convenience off",
  restricted.maxProtectedProfiles === 0 && restricted.maxGuardians === 0 && restricted.canManageFamily === false &&
  restricted.reporting === false && restricted.export === false && restricted.integrations === false && restricted.aiAnalysis === "none");
check("restricted → billing + deletion still accessible", restricted.billingAccess === true && restricted.deletionAccess === true);
check("suspended → management frozen (same lock as restricted)",
  suspended.canManageFamily === false && suspended.maxProtectedProfiles === 0 && suspended.billingAccess === true && suspended.deletionAccess === true);
check("deletingTenant → management frozen regardless of access state",
  deleting.canManageFamily === false && deleting.maxProtectedProfiles === 0);
check("Premium null caps become 0 when locked (no NEW creation), stay null when full",
  resolveFamilyEntitlements("family_premium", "restricted").maxProtectedProfiles === 0 &&
  resolveFamilyEntitlements("family_premium", "full_access").maxProtectedProfiles === null);
check("unknown access state → fail-safe locked (management frozen)",
  resolveFamilyEntitlements("family_plus", "garbage_state").canManageFamily === false);

// ===========================================================================
// D. ★ PERMANENT INVARIANT — critical safety independent of billing (EXHAUSTIVE)
// ===========================================================================
console.log("\nD. ★ Critical-safety invariant (exhaustive over plan × access × deleting)");
check("CRITICAL_SAFETY_ALWAYS has all six stages ON", ALL_CRITICAL_ON(CRITICAL_SAFETY_ALWAYS));
check("CRITICAL_SAFETY_ALWAYS is frozen", Object.isFrozen(CRITICAL_SAFETY_ALWAYS));

let combos = 0, criticalAlwaysOn = 0, sameRef = 0;
for (const plan of PLAN_INPUTS) {
  for (const access of ACCESS_STATES) {
    for (const deletingTenant of [false, true]) {
      const ent: FamilyEntitlements = resolveFamilyEntitlements(plan, access, { deletingTenant });
      combos++;
      if (ALL_CRITICAL_ON(ent.criticalSafety)) criticalAlwaysOn++;
      if (ent.criticalSafety === CRITICAL_SAFETY_ALWAYS) sameRef++;
      // billing + deletion access must never be stripped, in any state.
      if (!(ent.billingAccess && ent.deletionAccess)) {
        check(`billing/deletion access preserved for (${String(plan)},${String(access)},del=${deletingTenant})`, false);
      }
    }
  }
}
check(`critical safety ON in ALL ${combos} combinations`, criticalAlwaysOn === combos, `${criticalAlwaysOn}/${combos}`);
check(`critical safety is the shared always-on object in ALL combinations`, sameRef === combos, `${sameRef}/${combos}`);

// Explicit worst-case: suspended + Free + deleting still runs the full critical pipeline.
const worst = resolveFamilyEntitlements("family_free", "suspended", { deletingTenant: true });
check("worst case (Free · suspended · deleting) → critical pipeline fully ON",
  worst.criticalSafety.detection && worst.criticalSafety.classification && worst.criticalSafety.evidence &&
  worst.criticalSafety.incident && worst.criticalSafety.escalation && worst.criticalSafety.notification);

// ===========================================================================
// E. Determinism
// ===========================================================================
console.log("\nE. Determinism");
const a = JSON.stringify(resolveFamilyEntitlements("family_plus", "grace_period"));
const b = JSON.stringify(resolveFamilyEntitlements("family_plus", "grace_period"));
check("same inputs → identical output", a === b);

// ===========================================================================
// F. S2 — capacity accessors + typed error contract
// ===========================================================================
console.log("\nF. S2 capacity accessors + error contract");
check("4 limited resources", FAMILY_LIMITED_RESOURCES.length === 4 &&
  JSON.stringify([...FAMILY_LIMITED_RESOURCES]) === JSON.stringify(["protected_profile", "guardian", "family_member", "invitation"]));
check("familyResourceLimit maps Free caps", (() => {
  const f = familyPlanEntitlements("family_free");
  return familyResourceLimit(f, "protected_profile") === 2 && familyResourceLimit(f, "guardian") === 2 &&
    familyResourceLimit(f, "family_member") === 3 && familyResourceLimit(f, "invitation") === 2;
})());
check("familyResourceLimit maps Premium unlimited (null)", (() => {
  const p = familyPlanEntitlements("family_premium");
  return FAMILY_LIMITED_RESOURCES.every((r) => familyResourceLimit(p, r) === null);
})());
check("familyResourceLimit → 0 when locked (restricted)", (() => {
  const r = resolveFamilyEntitlements("family_plus", "restricted");
  return FAMILY_LIMITED_RESOURCES.every((x) => familyResourceLimit(r, x) === 0);
})());

check("FAMILY_ENTITLEMENT_CODES = the 4 categories", JSON.stringify([...FAMILY_ENTITLEMENT_CODES]) ===
  JSON.stringify(["family_plan_limit_reached", "family_access_restricted", "family_feature_unavailable", "family_billing_state_invalid"]));
check("isFamilyEntitlementCode accepts the 4, rejects junk",
  FAMILY_ENTITLEMENT_CODES.every(isFamilyEntitlementCode) && !isFamilyEntitlementCode("nope") && !isFamilyEntitlementCode(null));

const err = new FamilyEntitlementError("family_plan_limit_reached", "protected_profile", 2, 2);
check("FamilyEntitlementError carries stable code + capability + current + max",
  err.code === "family_plan_limit_reached" && err.capability === "protected_profile" && err.current === 2 && err.max === 2);
check("error message is the CODE, not localized copy (no English parsing needed)", err.message === "family_plan_limit_reached");
check("error name is stable for instanceof/guard", err.name === "FamilyEntitlementError" && isFamilyEntitlementError(err));
check("detail() exposes ONLY safe fields (code/capability/current/max) — no leakage",
  JSON.stringify(Object.keys(err.detail()).sort()) === JSON.stringify(["capability", "code", "current", "max"]));
check("detail() has no Stripe / secret / child-data fields", (() => {
  const d = JSON.stringify(err.detail());
  return !/stripe|price_|sub_|cus_|sk_|secret|token|email|guardianLabel|childName|dob/i.test(d);
})());
const restrictedErr = new FamilyEntitlementError("family_access_restricted", "guardian");
check("access-restricted error omits current/max cleanly", restrictedErr.current === undefined && restrictedErr.max === undefined);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — FAMILY-BILLING S1/S2 catalogue, entitlements & error contract: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
