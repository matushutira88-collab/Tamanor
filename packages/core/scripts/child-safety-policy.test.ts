/**
 * Child Safety Policy Engine V1 — PURE domain tests (no DB/network). Proves strict validation, DETERMINISTIC
 * evaluation, the full operator set, ALL/ANY groups, the documented conflict-resolution precedence, and
 * fail-closed behavior. Policy is data — there is no executable code path anywhere in the engine.
 * Run: pnpm child-safety-policy:test
 */
import {
  ChildSafetyPolicyPurpose, PolicyOperator, PolicyConditionGroupKind, PolicyEffectType,
  CHILD_SAFETY_POLICY_SCHEMA_VERSION, CHILD_SAFETY_POLICY_ENGINE_VERSION, POLICY_LIMITS,
  validateChildSafetyPolicyDefinition, evaluateChildSafetyPolicy, mergeEffects, failClosedDecision, canonicalPolicyInput,
  type ChildSafetyPolicyDefinition, type PolicyRule, type PolicyEffect,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const P = ChildSafetyPolicyPurpose;
const O = PolicyOperator;
const E = PolicyEffectType;
const NOW = "2026-07-27T12:00:00.000Z";

function def(purpose: ChildSafetyPolicyPurpose, rules: PolicyRule[], defaultEffect = E.RequireReview): ChildSafetyPolicyDefinition {
  return { schemaVersion: CHILD_SAFETY_POLICY_SCHEMA_VERSION, purpose, defaultEffect, rules };
}
const rule = (id: string, priority: number, condition: PolicyRule["condition"], effects: PolicyEffect[], explanationCode = "x"): PolicyRule => ({ id, priority, enabled: true, condition, effects, explanationCode });
const leaf = (field: string, operator: PolicyOperator, value?: unknown) => ({ field, operator, value } as PolicyRule["condition"]);

function main() {
  // ── 1. VALIDATION ─────────────────────────────────────────────────
  console.log("\n1. validation (strict; rejects unknown/oversized/malformed)");
  const validDef = def(P.SignalTriage, [rule("r1", 10, leaf("confidenceBand", O.Equals, "high"), [{ type: E.RequireReview }])]);
  check("★ valid policy validates", validateChildSafetyPolicyDefinition(validDef).valid);
  check("★ unknown FIELD rejected", !validateChildSafetyPolicyDefinition(def(P.SignalTriage, [rule("r", 1, leaf("nope", O.Equals, "x"), [{ type: E.RequireReview }])])).valid);
  check("★ unknown OPERATOR rejected", !validateChildSafetyPolicyDefinition(def(P.SignalTriage, [rule("r", 1, { field: "confidenceBand", operator: "REGEX" as never, value: "x" }, [{ type: E.RequireReview }])])).valid);
  check("★ unknown EFFECT rejected", !validateChildSafetyPolicyDefinition(def(P.SignalTriage, [rule("r", 1, leaf("confidenceBand", O.Equals, "high"), [{ type: "LAUNCH_MISSILE" as never }])])).valid);
  check("★ unknown effect PAYLOAD key rejected", !validateChildSafetyPolicyDefinition(def(P.SignalTriage, [rule("r", 1, leaf("confidenceBand", O.Equals, "high"), [{ type: E.SetRecommendedSeverity, payload: { severity: "high", extra: 1 } as never }])])).valid);
  check("★ bad enum payload value rejected (severity=nope)", !validateChildSafetyPolicyDefinition(def(P.SignalTriage, [rule("r", 1, leaf("confidenceBand", O.Equals, "high"), [{ type: E.SetRecommendedSeverity, payload: { severity: "nope" } }])])).valid);
  check("★ duplicate rule id rejected", !validateChildSafetyPolicyDefinition(def(P.SignalTriage, [rule("dup", 1, leaf("confidenceBand", O.Equals, "high"), [{ type: E.RequireReview }]), rule("dup", 2, leaf("confidenceBand", O.Equals, "low"), [{ type: E.NoAction }])])).valid);
  check("★ oversized rule set (>100) rejected", !validateChildSafetyPolicyDefinition(def(P.SignalTriage, Array.from({ length: POLICY_LIMITS.maxRules + 1 }, (_, i) => rule(`r${i}`, i, leaf("confidenceBand", O.Equals, "high"), [{ type: E.NoAction }])))).valid);
  const deep = (n: number): PolicyRule["condition"] => n <= 0 ? leaf("confidenceBand", O.Equals, "high") : { group: PolicyConditionGroupKind.All, nodes: [deep(n - 1)] };
  check("★ excessive nesting (>5) rejected", !validateChildSafetyPolicyDefinition(def(P.SignalTriage, [rule("r", 1, deep(8), [{ type: E.NoAction }])])).valid);
  check("★ numeric operator on non-numeric field rejected", !validateChildSafetyPolicyDefinition(def(P.SignalTriage, [rule("r", 1, leaf("confidenceBand", O.GreaterThan, 3), [{ type: E.NoAction }])])).valid);
  check("★ IN with bad member rejected", !validateChildSafetyPolicyDefinition(def(P.SignalTriage, [rule("r", 1, leaf("confidenceBand", O.In, ["high", "nope"]), [{ type: E.NoAction }])])).valid);
  check("★ EXISTS with a value rejected", !validateChildSafetyPolicyDefinition(def(P.SignalTriage, [rule("r", 1, leaf("confidenceBand", O.Exists, "x"), [{ type: E.NoAction }])])).valid);
  check("★ empty effects rejected", !validateChildSafetyPolicyDefinition(def(P.SignalTriage, [rule("r", 1, leaf("confidenceBand", O.Equals, "high"), [])])).valid);
  check("★ bad schema version rejected", !validateChildSafetyPolicyDefinition({ ...validDef, schemaVersion: 999 }).valid);

  // ── 2. DETERMINISM ────────────────────────────────────────────────
  console.log("\n2. determinism");
  const d2 = def(P.SignalTriage, [rule("b", 20, leaf("confidenceBand", O.Equals, "high"), [{ type: E.RequireReview }]), rule("a", 10, leaf("confidenceBand", O.Equals, "high"), [{ type: E.RequireSupervisorReview }])]);
  const r1 = evaluateChildSafetyPolicy({ purpose: P.SignalTriage, facts: { confidenceBand: "high" }, evaluatedAt: NOW }, d2);
  const r2 = evaluateChildSafetyPolicy({ purpose: P.SignalTriage, facts: { confidenceBand: "high" }, evaluatedAt: NOW }, d2);
  check("★ same input/def/time → identical result", JSON.stringify(r1) === JSON.stringify(r2));
  check("★ rules ordered by priority then id (a before b)", JSON.stringify(r1.matchedRuleIds) === JSON.stringify(["a", "b"]));
  check("★ canonical input stable regardless of fact key order", canonicalPolicyInput(P.SignalTriage, { confidenceBand: "high", repeatedSignalCount: 3 }) === canonicalPolicyInput(P.SignalTriage, { repeatedSignalCount: 3, confidenceBand: "high" }));
  check("★ canonical input excludes non-allowlisted keys", !canonicalPolicyInput(P.SignalTriage, { confidenceBand: "high", secret: "leak" } as never).includes("leak"));
  check("★ engine version stamped", r1.engineVersion === CHILD_SAFETY_POLICY_ENGINE_VERSION);

  // ── 3. CONDITION EVALUATION ───────────────────────────────────────
  console.log("\n3. condition evaluation (all operators + groups)");
  const ev = (cond: PolicyRule["condition"], facts: Record<string, unknown>) => evaluateChildSafetyPolicy({ purpose: P.IncidentClassification, facts, evaluatedAt: NOW }, def(P.IncidentClassification, [rule("r", 1, cond, [{ type: E.CreateIncident }])])).matchedRuleIds.length === 1;
  check("★ EQUALS", ev(leaf("severity", O.Equals, "critical"), { severity: "critical" }) && !ev(leaf("severity", O.Equals, "critical"), { severity: "low" }));
  check("★ NOT_EQUALS", ev(leaf("severity", O.NotEquals, "low"), { severity: "high" }));
  check("★ IN / NOT_IN", ev(leaf("severity", O.In, ["high", "critical"]), { severity: "high" }) && ev(leaf("severity", O.NotIn, ["low"]), { severity: "high" }));
  check("★ GT / GTE / LT / LTE + numeric boundaries", ev(leaf("signalCount", O.GreaterThan, 3), { signalCount: 4 }) && !ev(leaf("signalCount", O.GreaterThan, 3), { signalCount: 3 }) && ev(leaf("signalCount", O.GreaterThanOrEqual, 3), { signalCount: 3 }) && ev(leaf("signalCount", O.LessThan, 3), { signalCount: 2 }) && ev(leaf("signalCount", O.LessThanOrEqual, 3), { signalCount: 3 }));
  check("★ EXISTS / NOT_EXISTS + missing values", ev(leaf("reviewerAssigned", O.Exists), { reviewerAssigned: true }) && ev(leaf("reviewerAssigned", O.NotExists), {}) && !ev(leaf("reviewerAssigned", O.Exists), {}));
  check("★ ALL group (both must hold)", ev({ group: PolicyConditionGroupKind.All, nodes: [leaf("severity", O.Equals, "critical"), leaf("hasActiveEscalation", O.Equals, true)] }, { severity: "critical", hasActiveEscalation: true }) && !ev({ group: PolicyConditionGroupKind.All, nodes: [leaf("severity", O.Equals, "critical"), leaf("hasActiveEscalation", O.Equals, true)] }, { severity: "critical", hasActiveEscalation: false }));
  check("★ ANY group (either holds)", ev({ group: PolicyConditionGroupKind.Any, nodes: [leaf("severity", O.Equals, "critical"), leaf("hasActiveEscalation", O.Equals, true)] }, { severity: "low", hasActiveEscalation: true }));

  // ── 4. CONFLICT RESOLUTION ────────────────────────────────────────
  console.log("\n4. conflict resolution (documented precedence)");
  const merge = (effects: PolicyEffect[]) => mergeEffects(P.InterventionAuthorization, effects);
  check("★ deny over allow (guardian): PROHIBIT beats ALLOW", !merge([{ type: E.AllowGuardianContactConsideration }, { type: E.ProhibitGuardianContact }]).allowGuardianContactConsideration);
  check("★ MANUAL_ONLY over automatic intervention", !merge([{ type: E.AllowAutomaticIntervention, payload: { interventionType: "queue_for_review", maxSeverity: "low", maxUrgency: "routine", prerequisites: [] } }, { type: E.ManualOnly }]).allowAutomaticIntervention);
  check("★ REQUIRE_MANUAL_INTERVENTION_APPROVAL over automatic", !merge([{ type: E.AllowAutomaticIntervention, payload: { interventionType: "queue_for_review", maxSeverity: "low", maxUrgency: "routine", prerequisites: [] } }, { type: E.RequireManualInterventionApproval }]).allowAutomaticIntervention);
  const sup = merge([{ type: E.RequireReview }, { type: E.RequireSupervisorReview }]);
  check("★ supervisor over reviewer (both flagged, supervisor true)", sup.requireSupervisorReview && sup.requireReview);
  check("★ highest severity wins (medium then critical → critical)", merge([{ type: E.SetRecommendedSeverity, payload: { severity: "medium" } }, { type: E.SetRecommendedSeverity, payload: { severity: "critical" } }]).recommendedSeverity === "critical");
  check("★ highest severity wins regardless of order (critical then low → critical)", merge([{ type: E.SetRecommendedSeverity, payload: { severity: "critical" } }, { type: E.SetRecommendedSeverity, payload: { severity: "low" } }]).recommendedSeverity === "critical");
  check("★ highest urgency wins", merge([{ type: E.SetRecommendedUrgency, payload: { urgency: "routine" } }, { type: E.SetRecommendedUrgency, payload: { urgency: "immediate" } }]).recommendedUrgency === "immediate");
  check("★ highest escalation level wins", mergeEffects(P.Escalation, [{ type: E.SetEscalationLevel, payload: { level: "monitor" } }, { type: E.SetEscalationLevel, payload: { level: "urgent_internal" } }]).escalationLevel === "urgent_internal");
  const dedup = mergeEffects(P.ProtectionPlan, [{ type: E.ProposeProtectionAction, payload: { actionType: "preserve_evidence", reasonCode: "a", requiresApproval: false } }, { type: E.ProposeProtectionAction, payload: { actionType: "preserve_evidence", reasonCode: "a", requiresApproval: true } }]);
  check("★ duplicate proposed actions de-dupe; requiresApproval=true (safer) wins", dedup.proposedActions.length === 1 && dedup.proposedActions[0]!.requiresApproval === true);
  const tie = evaluateChildSafetyPolicy({ purpose: P.SignalTriage, facts: { confidenceBand: "high" }, evaluatedAt: NOW }, def(P.SignalTriage, [rule("z", 5, leaf("confidenceBand", O.Equals, "high"), [{ type: E.NoAction }]), rule("a", 5, leaf("confidenceBand", O.Equals, "high"), [{ type: E.NoAction }])]));
  check("★ deterministic tie-break by id at equal priority (a before z)", JSON.stringify(tie.matchedRuleIds) === JSON.stringify(["a", "z"]));

  // ── 5. FAILURE / FAIL-CLOSED ──────────────────────────────────────
  console.log("\n5. fail-closed");
  const fc = failClosedDecision(P.SignalTriage, "test", NOW);
  check("★ failClosedDecision: manual-only + review + prohibit-guardian, ok=false", fc.ok === false && fc.decision.manualOnly && fc.decision.requireReview && fc.decision.prohibitGuardianContact && !fc.decision.allowAutomaticIntervention);
  const mism = evaluateChildSafetyPolicy({ purpose: P.SignalTriage, facts: {}, evaluatedAt: NOW }, def(P.Escalation, [rule("r", 1, leaf("severity", O.Equals, "high"), [{ type: E.NoAction }])]));
  check("★ purpose mismatch → fail closed", mism.ok === false && mism.errorCode === "policy_purpose_mismatch" && mism.decision.manualOnly);
  const noMatch = evaluateChildSafetyPolicy({ purpose: P.SignalTriage, facts: { confidenceBand: "low" }, evaluatedAt: NOW }, def(P.SignalTriage, [rule("r", 1, leaf("confidenceBand", O.Equals, "high"), [{ type: E.NoAction }])], E.ManualOnly));
  check("★ no rule matched → policy defaultEffect applies (MANUAL_ONLY)", noMatch.matchedRuleIds.length === 0 && noMatch.decision.manualOnly && noMatch.explanationCodes.includes("policy_default_effect"));
  check("★ disabled rules never match", evaluateChildSafetyPolicy({ purpose: P.SignalTriage, facts: { confidenceBand: "high" }, evaluatedAt: NOW }, def(P.SignalTriage, [{ ...rule("r", 1, leaf("confidenceBand", O.Equals, "high"), [{ type: E.CreateIncident }]), enabled: false }])).matchedRuleIds.length === 0);
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Policy Engine (domain) V1: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
