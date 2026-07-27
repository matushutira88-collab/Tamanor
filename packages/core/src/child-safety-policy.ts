/**
 * Child Safety Policy Engine V1 — pure vocabulary, strict schema validation, and DETERMINISTIC evaluation.
 *
 * This module is the whole decision brain, and it is intentionally SMALL and SAFE:
 *   - It reads ONLY bounded, pre-canonicalized facts (never raw message/evidence/note content).
 *   - It has NO I/O, NO clock, NO randomness, NO `eval`/`Function`/dynamic code — tenant policy is DATA
 *     (a strict JSON structure over an allow-listed field/operator/effect vocabulary), never executable.
 *   - The same (facts, policyDefinition, engineVersion, evaluatedAt) always yields the same decision.
 *   - It is side-effect free: it returns a bounded recommendation/authorization envelope; existing domain
 *     services remain solely responsible for validating and executing authorized state transitions.
 *   - Hashing/persistence live in the server-only DB layer; this module only produces the deterministic
 *     canonical input STRING (no `node:crypto` here, so the engine stays client-bundle safe).
 */
import { Role } from "./tenant";
import { Permission, can } from "./permissions";

// ─────────────────────────────────────────────────────────────────────────────
// Engine + schema versioning (a decision is bound to both, forever).
// ─────────────────────────────────────────────────────────────────────────────
export const CHILD_SAFETY_POLICY_ENGINE_VERSION = "cs-policy-engine-v1";
export const CHILD_SAFETY_POLICY_SCHEMA_VERSION = 1;

// Bounds — protect against oversized / adversarial definitions (fail validation, never crash).
export const POLICY_LIMITS = {
  maxRules: 100,
  maxConditionNodesPerRule: 20,
  maxNestingDepth: 5,
  maxEffectsPerRule: 20,
  maxDefinitionBytes: 64 * 1024,
  maxRuleIdLen: 64,
  maxExplanationCodeLen: 64,
  maxInValues: 50,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Permissions.
// ─────────────────────────────────────────────────────────────────────────────
export const canViewChildSafetyPolicy = (r: Role): boolean => can(r, Permission.ChildSafetyPolicyView);
export const canManageChildSafetyPolicy = (r: Role): boolean => can(r, Permission.ChildSafetyPolicyManage);
export const canSubmitChildSafetyPolicy = (r: Role): boolean => can(r, Permission.ChildSafetyPolicySubmit);
export const canApproveChildSafetyPolicy = (r: Role): boolean => can(r, Permission.ChildSafetyPolicyApprove);
export const canActivateChildSafetyPolicy = (r: Role): boolean => can(r, Permission.ChildSafetyPolicyActivate);
export const canSimulateChildSafetyPolicy = (r: Role): boolean => can(r, Permission.ChildSafetyPolicySimulate);
export const canViewChildSafetyPolicyDecisions = (r: Role): boolean => can(r, Permission.ChildSafetyPolicyDecisionView);

// ─────────────────────────────────────────────────────────────────────────────
// Bounded enums.
// ─────────────────────────────────────────────────────────────────────────────
export enum ChildSafetyPolicyPurpose {
  SignalTriage = "SIGNAL_TRIAGE",
  IncidentClassification = "INCIDENT_CLASSIFICATION",
  Escalation = "ESCALATION",
  ProtectionPlan = "PROTECTION_PLAN",
  InterventionAuthorization = "INTERVENTION_AUTHORIZATION",
  GuardianContactEligibility = "GUARDIAN_CONTACT_ELIGIBILITY",
}
export const CHILD_SAFETY_POLICY_PURPOSES: readonly ChildSafetyPolicyPurpose[] = Object.values(ChildSafetyPolicyPurpose);
export const isPolicyPurpose = (v: unknown): v is ChildSafetyPolicyPurpose => (CHILD_SAFETY_POLICY_PURPOSES as readonly string[]).includes(v as string);

export enum ChildSafetyPolicyStatus {
  Draft = "DRAFT",
  PendingApproval = "PENDING_APPROVAL",
  Active = "ACTIVE",
  Retired = "RETIRED",
  Rejected = "REJECTED",
}
export const CHILD_SAFETY_POLICY_STATUSES: readonly ChildSafetyPolicyStatus[] = Object.values(ChildSafetyPolicyStatus);
/** A version in any of these states is IMMUTABLE (no edits permitted). */
export const IMMUTABLE_POLICY_STATUSES: readonly ChildSafetyPolicyStatus[] = [
  ChildSafetyPolicyStatus.PendingApproval, ChildSafetyPolicyStatus.Active, ChildSafetyPolicyStatus.Retired, ChildSafetyPolicyStatus.Rejected,
];
export const isImmutablePolicyStatus = (s: string): boolean => (IMMUTABLE_POLICY_STATUSES as readonly string[]).includes(s);

export enum PolicyOperator {
  Equals = "EQUALS", NotEquals = "NOT_EQUALS", In = "IN", NotIn = "NOT_IN",
  GreaterThan = "GREATER_THAN", GreaterThanOrEqual = "GREATER_THAN_OR_EQUAL",
  LessThan = "LESS_THAN", LessThanOrEqual = "LESS_THAN_OR_EQUAL",
  Exists = "EXISTS", NotExists = "NOT_EXISTS",
}
export const POLICY_OPERATORS: readonly PolicyOperator[] = Object.values(PolicyOperator);
export enum PolicyConditionGroupKind { All = "ALL", Any = "ANY" }

export enum PolicyEffectType {
  CreateIncident = "CREATE_INCIDENT",
  UpdateIncident = "UPDATE_INCIDENT",
  SetRecommendedSeverity = "SET_RECOMMENDED_SEVERITY",
  SetRecommendedUrgency = "SET_RECOMMENDED_URGENCY",
  RequireReview = "REQUIRE_REVIEW",
  RequireSupervisorReview = "REQUIRE_SUPERVISOR_REVIEW",
  CreateEscalationRecommendation = "CREATE_ESCALATION_RECOMMENDATION",
  SetEscalationLevel = "SET_ESCALATION_LEVEL",
  ProposeProtectionPlan = "PROPOSE_PROTECTION_PLAN",
  ProposeProtectionAction = "PROPOSE_PROTECTION_ACTION",
  AllowAutomaticIntervention = "ALLOW_AUTOMATIC_INTERVENTION",
  RequireManualInterventionApproval = "REQUIRE_MANUAL_INTERVENTION_APPROVAL",
  AllowGuardianContactConsideration = "ALLOW_GUARDIAN_CONTACT_CONSIDERATION",
  ProhibitGuardianContact = "PROHIBIT_GUARDIAN_CONTACT",
  ManualOnly = "MANUAL_ONLY",
  NoAction = "NO_ACTION",
}
export const POLICY_EFFECT_TYPES: readonly PolicyEffectType[] = Object.values(PolicyEffectType);

// Canonical value sets used by both fields and effect payloads.
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const URGENCIES = ["routine", "elevated", "immediate"] as const;
const CONFIDENCE_BANDS = ["low", "medium", "high"] as const;
const RISK_FAMILIES = ["sexual", "grooming", "violence", "coercion", "scam", "bullying", "identity"] as const;
const INCIDENT_STATUSES = ["open", "under_review", "action_required", "monitoring", "waiting", "resolved", "dismissed", "reopened", "closed"] as const;
const GUARDIAN_AUTHORITY_STATES = ["none", "pending", "authorized", "revoked", "expired"] as const;
const AGE_BANDS = ["under_10", "age_10_12", "age_13_15", "age_16_17"] as const;
const SIGNAL_TYPES = ["GROOMING", "SEXUAL_SOLICITATION", "SEXTORTION", "MEETING_ATTEMPT", "CYBERBULLYING", "THREAT", "IDENTITY_MANIPULATION", "COERCION"] as const;
const ESCALATION_LEVELS = ["none", "monitor", "internal", "urgent_internal"] as const;
export const CHILD_SAFETY_POLICY_ESCALATION_LEVELS = ESCALATION_LEVELS;
const PROTECTION_ACTION_TYPES = ["review_account_safety", "preserve_evidence", "verify_guardian_contact", "notify_authorized_guardian", "restrict_interaction", "recommend_blocking", "recommend_reporting", "escalate_internal_safety", "legal_review", "welfare_check", "follow_up_review", "custom_internal_action"] as const;
const INTERVENTION_TYPES = ["local_safety_guidance", "queue_for_review", "notify_authorized_guardian", "create_or_update_incident", "urgent_escalation"] as const;

const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const URGENCY_RANK: Record<string, number> = { routine: 0, elevated: 1, immediate: 2 };
const ESCALATION_RANK: Record<string, number> = { none: 0, monitor: 1, internal: 2, urgent_internal: 3 };

// ─────────────────────────────────────────────────────────────────────────────
// Field allow-list (per purpose). No arbitrary object paths / dynamic field names.
// ─────────────────────────────────────────────────────────────────────────────
type FieldKind = "string" | "number" | "boolean";
interface FieldDescriptor { kind: FieldKind; enumValues?: readonly string[]; }

const SIGNAL_FIELDS: Record<string, FieldDescriptor> = {
  signalType: { kind: "string", enumValues: SIGNAL_TYPES },
  riskFamily: { kind: "string", enumValues: RISK_FAMILIES },
  confidenceBand: { kind: "string", enumValues: CONFIDENCE_BANDS },
  sourceType: { kind: "string" },
  repeatedSignalCount: { kind: "number" },
  distinctSourceCount: { kind: "number" },
  signalAgeSeconds: { kind: "number" },
  immediateDangerFlag: { kind: "boolean" },
  ageBand: { kind: "string", enumValues: AGE_BANDS },
};
const INCIDENT_FIELDS: Record<string, FieldDescriptor> = {
  severity: { kind: "string", enumValues: SEVERITIES },
  urgency: { kind: "string", enumValues: URGENCIES },
  incidentStatus: { kind: "string", enumValues: INCIDENT_STATUSES },
  riskFamily: { kind: "string", enumValues: RISK_FAMILIES },
  signalCount: { kind: "number" },
  previousEscalationCount: { kind: "number" },
  hasActiveEscalation: { kind: "boolean" },
  hasActiveProtectionPlan: { kind: "boolean" },
  reviewerAssigned: { kind: "boolean" },
  guardianAuthorityState: { kind: "string", enumValues: GUARDIAN_AUTHORITY_STATES },
  evidenceCount: { kind: "number" },
  ageBand: { kind: "string", enumValues: AGE_BANDS },
  immediateDangerFlag: { kind: "boolean" },
};

/** The allow-listed fact fields for a purpose. Signal triage uses signal fields; everything else the
 *  incident fact-set (a superset covering classification / escalation / plan / intervention / guardian). */
export function policyFieldsFor(purpose: ChildSafetyPolicyPurpose): Record<string, FieldDescriptor> {
  return purpose === ChildSafetyPolicyPurpose.SignalTriage ? SIGNAL_FIELDS : INCIDENT_FIELDS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy definition types (the strict, JSON-compatible schema — data, never code).
// ─────────────────────────────────────────────────────────────────────────────
export type PolicyConditionValue = string | number | boolean | Array<string | number>;
export interface PolicyConditionLeaf { field: string; operator: PolicyOperator; value?: PolicyConditionValue; }
export interface PolicyConditionGroup { group: PolicyConditionGroupKind; nodes: PolicyConditionNode[]; }
export type PolicyConditionNode = PolicyConditionLeaf | PolicyConditionGroup;
export interface PolicyEffect { type: PolicyEffectType; payload?: Record<string, unknown>; }
export interface PolicyRule {
  id: string; priority: number; enabled: boolean;
  condition: PolicyConditionNode; effects: PolicyEffect[]; explanationCode: string;
}
export interface ChildSafetyPolicyDefinition {
  schemaVersion: number;
  purpose: ChildSafetyPolicyPurpose;
  defaultEffect: PolicyEffectType;
  rules: PolicyRule[];
}

const isGroup = (n: PolicyConditionNode): n is PolicyConditionGroup => typeof (n as PolicyConditionGroup).group === "string";

// ─────────────────────────────────────────────────────────────────────────────
// STRICT validation — reject unknown fields/operators/effects/payload keys, enforce bounds. Pure; returns
// a bounded list of error codes (never throws). This is the hand-written, dependency-free equivalent of a
// strict Zod schema — kept dependency-free so the engine stays client-bundle safe.
// ─────────────────────────────────────────────────────────────────────────────
export interface ChildSafetyPolicyValidationResult { valid: boolean; errors: string[]; ruleCount: number; }

const VALUE_OPERATORS = new Set<string>([PolicyOperator.Equals, PolicyOperator.NotEquals, PolicyOperator.GreaterThan, PolicyOperator.GreaterThanOrEqual, PolicyOperator.LessThan, PolicyOperator.LessThanOrEqual]);
const ARRAY_OPERATORS = new Set<string>([PolicyOperator.In, PolicyOperator.NotIn]);
const NUMERIC_OPERATORS = new Set<string>([PolicyOperator.GreaterThan, PolicyOperator.GreaterThanOrEqual, PolicyOperator.LessThan, PolicyOperator.LessThanOrEqual]);
const NO_VALUE_OPERATORS = new Set<string>([PolicyOperator.Exists, PolicyOperator.NotExists]);

/** Per-effect payload schema: allowed keys + a validator. Unknown effect type or extra key → error. */
const EFFECT_PAYLOAD_SPECS: Record<PolicyEffectType, (p: Record<string, unknown>, err: (c: string) => void) => void> = {
  [PolicyEffectType.SetRecommendedSeverity]: (p, err) => { onlyKeys(p, ["severity"], err); enumKey(p, "severity", SEVERITIES, err); },
  [PolicyEffectType.SetRecommendedUrgency]: (p, err) => { onlyKeys(p, ["urgency"], err); enumKey(p, "urgency", URGENCIES, err); },
  [PolicyEffectType.SetEscalationLevel]: (p, err) => { onlyKeys(p, ["level"], err); enumKey(p, "level", ESCALATION_LEVELS, err); },
  [PolicyEffectType.ProposeProtectionAction]: (p, err) => {
    onlyKeys(p, ["actionType", "reasonCode", "requiresApproval"], err);
    enumKey(p, "actionType", PROTECTION_ACTION_TYPES, err);
    if (typeof p.reasonCode !== "string" || !p.reasonCode || (p.reasonCode as string).length > 64) err("effect_payload:reasonCode");
    if (typeof p.requiresApproval !== "boolean") err("effect_payload:requiresApproval");
  },
  [PolicyEffectType.AllowAutomaticIntervention]: (p, err) => {
    onlyKeys(p, ["interventionType", "maxSeverity", "maxUrgency", "prerequisites"], err);
    enumKey(p, "interventionType", INTERVENTION_TYPES, err);
    enumKey(p, "maxSeverity", SEVERITIES, err);
    enumKey(p, "maxUrgency", URGENCIES, err);
    if (!Array.isArray(p.prerequisites) || (p.prerequisites as unknown[]).length > 10 || (p.prerequisites as unknown[]).some((x) => typeof x !== "string" || (x as string).length > 64)) err("effect_payload:prerequisites");
  },
  // Flag effects — NO payload permitted.
  [PolicyEffectType.CreateIncident]: (p, err) => noPayload(p, err),
  [PolicyEffectType.UpdateIncident]: (p, err) => noPayload(p, err),
  [PolicyEffectType.RequireReview]: (p, err) => noPayload(p, err),
  [PolicyEffectType.RequireSupervisorReview]: (p, err) => noPayload(p, err),
  [PolicyEffectType.CreateEscalationRecommendation]: (p, err) => noPayload(p, err),
  [PolicyEffectType.ProposeProtectionPlan]: (p, err) => noPayload(p, err),
  [PolicyEffectType.RequireManualInterventionApproval]: (p, err) => noPayload(p, err),
  [PolicyEffectType.AllowGuardianContactConsideration]: (p, err) => noPayload(p, err),
  [PolicyEffectType.ProhibitGuardianContact]: (p, err) => noPayload(p, err),
  [PolicyEffectType.ManualOnly]: (p, err) => noPayload(p, err),
  [PolicyEffectType.NoAction]: (p, err) => noPayload(p, err),
};
function onlyKeys(p: Record<string, unknown>, keys: string[], err: (c: string) => void): void {
  for (const k of Object.keys(p ?? {})) if (!keys.includes(k)) err(`effect_payload_unknown_key:${k}`);
}
function noPayload(p: Record<string, unknown>, err: (c: string) => void): void {
  if (p && Object.keys(p).length) err("effect_payload_not_allowed");
}
function enumKey(p: Record<string, unknown>, key: string, allowed: readonly string[], err: (c: string) => void): void {
  if (typeof p[key] !== "string" || !allowed.includes(p[key] as string)) err(`effect_payload:${key}`);
}

export function validateChildSafetyPolicyDefinition(def: unknown): ChildSafetyPolicyValidationResult {
  const errors: string[] = [];
  const err = (c: string) => { if (errors.length < 100) errors.push(c); };
  // Size bound (guards oversized JSON before structural checks).
  try { if (JSON.stringify(def).length > POLICY_LIMITS.maxDefinitionBytes) err("definition_too_large"); } catch { err("definition_unserializable"); }

  const d = def as Partial<ChildSafetyPolicyDefinition>;
  if (!d || typeof d !== "object") return { valid: false, errors: ["not_an_object"], ruleCount: 0 };
  if (d.schemaVersion !== CHILD_SAFETY_POLICY_SCHEMA_VERSION) err("bad_schema_version");
  if (!isPolicyPurpose(d.purpose)) err("bad_purpose");
  if (!POLICY_EFFECT_TYPES.includes(d.defaultEffect as PolicyEffectType)) err("bad_default_effect");
  if (!Array.isArray(d.rules)) { err("rules_not_array"); return { valid: false, errors, ruleCount: 0 }; }
  if (d.rules.length > POLICY_LIMITS.maxRules) err("too_many_rules");

  const fields = isPolicyPurpose(d.purpose) ? policyFieldsFor(d.purpose) : {};
  const seenIds = new Set<string>();
  for (const [i, rule] of d.rules.entries()) {
    if (!rule || typeof rule !== "object") { err(`rule_${i}_invalid`); continue; }
    if (typeof rule.id !== "string" || !rule.id || rule.id.length > POLICY_LIMITS.maxRuleIdLen) err(`rule_${i}_bad_id`);
    else { if (seenIds.has(rule.id)) err(`duplicate_rule_id:${rule.id}`); seenIds.add(rule.id); }
    if (typeof rule.priority !== "number" || !Number.isFinite(rule.priority)) err(`rule_${i}_bad_priority`);
    if (typeof rule.enabled !== "boolean") err(`rule_${i}_bad_enabled`);
    if (typeof rule.explanationCode !== "string" || !rule.explanationCode || rule.explanationCode.length > POLICY_LIMITS.maxExplanationCodeLen) err(`rule_${i}_bad_explanation`);
    // effects
    if (!Array.isArray(rule.effects) || rule.effects.length === 0) err(`rule_${i}_no_effects`);
    else {
      if (rule.effects.length > POLICY_LIMITS.maxEffectsPerRule) err(`rule_${i}_too_many_effects`);
      for (const [j, e] of rule.effects.entries()) {
        if (!e || typeof e !== "object" || !POLICY_EFFECT_TYPES.includes((e as PolicyEffect).type)) { err(`rule_${i}_effect_${j}_bad_type`); continue; }
        EFFECT_PAYLOAD_SPECS[(e as PolicyEffect).type]((e as PolicyEffect).payload ?? {}, (c) => err(`rule_${i}_effect_${j}_${c}`));
      }
    }
    // condition tree
    let nodeCount = 0;
    const walk = (node: unknown, depth: number): void => {
      if (depth > POLICY_LIMITS.maxNestingDepth) { err(`rule_${i}_too_deep`); return; }
      if (++nodeCount > POLICY_LIMITS.maxConditionNodesPerRule) { err(`rule_${i}_too_many_conditions`); return; }
      if (!node || typeof node !== "object") { err(`rule_${i}_bad_condition`); return; }
      if (isGroup(node as PolicyConditionNode)) {
        const g = node as PolicyConditionGroup;
        if (g.group !== PolicyConditionGroupKind.All && g.group !== PolicyConditionGroupKind.Any) err(`rule_${i}_bad_group`);
        if (!Array.isArray(g.nodes) || g.nodes.length === 0) err(`rule_${i}_empty_group`);
        else for (const c of g.nodes) walk(c, depth + 1);
      } else {
        const leaf = node as PolicyConditionLeaf;
        const fd = fields[leaf.field];
        if (!fd) { err(`rule_${i}_unknown_field:${leaf.field}`); return; }
        if (!POLICY_OPERATORS.includes(leaf.operator)) { err(`rule_${i}_unknown_operator`); return; }
        if (NO_VALUE_OPERATORS.has(leaf.operator)) { if (leaf.value !== undefined) err(`rule_${i}_unexpected_value`); return; }
        if (NUMERIC_OPERATORS.has(leaf.operator) && fd.kind !== "number") err(`rule_${i}_numeric_op_non_numeric_field`);
        if (ARRAY_OPERATORS.has(leaf.operator)) {
          if (!Array.isArray(leaf.value) || leaf.value.length === 0 || leaf.value.length > POLICY_LIMITS.maxInValues) { err(`rule_${i}_bad_in_value`); return; }
          for (const v of leaf.value) if (!leafValueOk(fd, v)) err(`rule_${i}_bad_in_member`);
        } else if (VALUE_OPERATORS.has(leaf.operator)) {
          if (!leafValueOk(fd, leaf.value)) err(`rule_${i}_bad_value`);
        }
      }
    };
    walk(rule.condition, 1);
  }
  return { valid: errors.length === 0, errors, ruleCount: Array.isArray(d.rules) ? d.rules.length : 0 };
}
function leafValueOk(fd: FieldDescriptor, v: unknown): boolean {
  if (fd.kind === "number") return typeof v === "number" && Number.isFinite(v);
  if (fd.kind === "boolean") return typeof v === "boolean";
  if (typeof v !== "string") return false;
  return fd.enumValues ? fd.enumValues.includes(v) : v.length <= 128;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical input string (deterministic; NO crypto here — the DB layer hashes it server-side).
// Only allow-listed fields for the purpose are included, in sorted key order.
// ─────────────────────────────────────────────────────────────────────────────
export function canonicalPolicyInput(purpose: ChildSafetyPolicyPurpose, facts: Record<string, unknown>): string {
  const allowed = policyFieldsFor(purpose);
  const out: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(allowed).sort()) {
    const v = facts[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[key] = v;
  }
  return JSON.stringify({ p: purpose, e: CHILD_SAFETY_POLICY_ENGINE_VERSION, s: CHILD_SAFETY_POLICY_SCHEMA_VERSION, f: out });
}

// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC evaluation + conflict resolution.
// ─────────────────────────────────────────────────────────────────────────────
export interface ChildSafetyPolicyEvaluationInput {
  purpose: ChildSafetyPolicyPurpose;
  facts: Record<string, unknown>;
  evaluatedAt: string; // ISO — injected (pure)
  includeUnmatched?: boolean; // simulation only
}
/** The merged, bounded decision — recommendations + authorization BOUNDS only (never a side effect). */
export interface ChildSafetyPolicyEngineDecision {
  purpose: ChildSafetyPolicyPurpose;
  createIncident: boolean;
  updateIncident: boolean;
  recommendedSeverity: string | null;
  recommendedUrgency: string | null;
  requireReview: boolean;
  requireSupervisorReview: boolean;
  recommendEscalation: boolean;
  escalationLevel: string | null;
  proposeProtectionPlan: boolean;
  proposedActions: Array<{ actionType: string; reasonCode: string; requiresApproval: boolean }>;
  allowAutomaticIntervention: boolean;
  automaticInterventionBounds: Array<{ interventionType: string; maxSeverity: string; maxUrgency: string; prerequisites: string[] }>;
  requireManualInterventionApproval: boolean;
  allowGuardianContactConsideration: boolean;
  prohibitGuardianContact: boolean;
  manualOnly: boolean;
}
export interface ChildSafetyPolicyEvaluationResult {
  ok: boolean;
  errorCode: string | null;
  purpose: ChildSafetyPolicyPurpose;
  matchedRuleIds: string[];
  unmatchedRuleIds?: string[];
  explanationCodes: string[];
  decision: ChildSafetyPolicyEngineDecision;
  engineVersion: string;
  evaluatedAt: string;
  canonicalInput: string;
}

const emptyDecision = (purpose: ChildSafetyPolicyPurpose): ChildSafetyPolicyEngineDecision => ({
  purpose, createIncident: false, updateIncident: false, recommendedSeverity: null, recommendedUrgency: null,
  requireReview: false, requireSupervisorReview: false, recommendEscalation: false, escalationLevel: null,
  proposeProtectionPlan: false, proposedActions: [], allowAutomaticIntervention: false, automaticInterventionBounds: [],
  requireManualInterventionApproval: false, allowGuardianContactConsideration: false, prohibitGuardianContact: false, manualOnly: false,
});

/** The safe, FAIL-CLOSED decision: require manual review, allow nothing automatic, contact no guardian. */
export function failClosedDecision(purpose: ChildSafetyPolicyPurpose, errorCode: string, evaluatedAt: string, canonicalInput = ""): ChildSafetyPolicyEvaluationResult {
  const decision = emptyDecision(purpose);
  decision.requireReview = true;
  decision.manualOnly = true;
  decision.prohibitGuardianContact = true;
  return {
    ok: false, errorCode, purpose, matchedRuleIds: [], explanationCodes: ["policy_fail_closed"],
    decision, engineVersion: CHILD_SAFETY_POLICY_ENGINE_VERSION, evaluatedAt, canonicalInput,
  };
}

function evalLeaf(leaf: PolicyConditionLeaf, facts: Record<string, unknown>): boolean {
  const v = facts[leaf.field];
  switch (leaf.operator) {
    case PolicyOperator.Exists: return v !== undefined && v !== null;
    case PolicyOperator.NotExists: return v === undefined || v === null;
    case PolicyOperator.Equals: return v === leaf.value;
    case PolicyOperator.NotEquals: return v !== leaf.value;
    case PolicyOperator.In: return Array.isArray(leaf.value) && (leaf.value as Array<string | number>).includes(v as string | number);
    case PolicyOperator.NotIn: return Array.isArray(leaf.value) && !(leaf.value as Array<string | number>).includes(v as string | number);
    case PolicyOperator.GreaterThan: return typeof v === "number" && typeof leaf.value === "number" && v > leaf.value;
    case PolicyOperator.GreaterThanOrEqual: return typeof v === "number" && typeof leaf.value === "number" && v >= leaf.value;
    case PolicyOperator.LessThan: return typeof v === "number" && typeof leaf.value === "number" && v < leaf.value;
    case PolicyOperator.LessThanOrEqual: return typeof v === "number" && typeof leaf.value === "number" && v <= leaf.value;
    default: return false; // unknown operator → fail closed (no match)
  }
}
function evalNode(node: PolicyConditionNode, facts: Record<string, unknown>): boolean {
  if (isGroup(node)) {
    const g = node;
    if (!Array.isArray(g.nodes) || g.nodes.length === 0) return false;
    return g.group === PolicyConditionGroupKind.All ? g.nodes.every((n) => evalNode(n, facts)) : g.nodes.some((n) => evalNode(n, facts));
  }
  return evalLeaf(node, facts);
}

/**
 * Evaluate a VALIDATED policy definition against facts. Deterministic + side-effect free. Precedence:
 *   1) rules run in ascending `priority`, tie-broken by ascending `id` (never DB/array order);
 *   2) effects merge with deny-over-allow, MANUAL_ONLY over automatic, supervisor over reviewer,
 *      highest severity/urgency/escalation-level wins, and duplicate proposed actions de-dupe (a
 *      requiresApproval=true wins over false for the same action type). See docs for the full model.
 * Assumes `def` already passed {@link validateChildSafetyPolicyDefinition}; a shape problem still fails closed.
 */
export function evaluateChildSafetyPolicy(input: ChildSafetyPolicyEvaluationInput, def: ChildSafetyPolicyDefinition): ChildSafetyPolicyEvaluationResult {
  const canonicalInput = canonicalPolicyInput(input.purpose, input.facts);
  if (!def || def.purpose !== input.purpose || !Array.isArray(def.rules)) {
    return failClosedDecision(input.purpose, "policy_purpose_mismatch", input.evaluatedAt, canonicalInput);
  }
  const ordered = [...def.rules]
    .filter((r) => r.enabled)
    .sort((a, b) => (a.priority - b.priority) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const matchedRuleIds: string[] = [];
  const unmatchedRuleIds: string[] = [];
  const collected: Array<{ effect: PolicyEffect; ruleId: string }> = [];
  const explanationCodes: string[] = [];

  for (const rule of ordered) {
    if (evalNode(rule.condition, input.facts)) {
      matchedRuleIds.push(rule.id);
      if (!explanationCodes.includes(rule.explanationCode)) explanationCodes.push(rule.explanationCode);
      for (const e of rule.effects) collected.push({ effect: e, ruleId: rule.id });
    } else if (input.includeUnmatched) {
      unmatchedRuleIds.push(rule.id);
    }
  }
  // No rule matched → apply the policy's declared default effect (as a single synthetic effect).
  if (matchedRuleIds.length === 0) {
    collected.push({ effect: { type: def.defaultEffect }, ruleId: "__default__" });
    explanationCodes.push("policy_default_effect");
  }

  const decision = mergeEffects(input.purpose, collected.map((c) => c.effect));

  const result: ChildSafetyPolicyEvaluationResult = {
    ok: true, errorCode: null, purpose: input.purpose, matchedRuleIds, explanationCodes,
    decision, engineVersion: CHILD_SAFETY_POLICY_ENGINE_VERSION, evaluatedAt: input.evaluatedAt, canonicalInput,
  };
  if (input.includeUnmatched) result.unmatchedRuleIds = unmatchedRuleIds;
  return result;
}

/** Deterministic effect merge with the documented precedence. Pure. */
export function mergeEffects(purpose: ChildSafetyPolicyPurpose, effects: PolicyEffect[]): ChildSafetyPolicyEngineDecision {
  const d = emptyDecision(purpose);
  const actionMap = new Map<string, { actionType: string; reasonCode: string; requiresApproval: boolean }>();
  const boundsMap = new Map<string, { interventionType: string; maxSeverity: string; maxUrgency: string; prerequisites: string[] }>();

  for (const e of effects) {
    const p = e.payload ?? {};
    switch (e.type) {
      case PolicyEffectType.CreateIncident: d.createIncident = true; break;
      case PolicyEffectType.UpdateIncident: d.updateIncident = true; break;
      case PolicyEffectType.SetRecommendedSeverity:
        if (typeof p.severity === "string" && (d.recommendedSeverity === null || (SEVERITY_RANK[p.severity] ?? -1) > (SEVERITY_RANK[d.recommendedSeverity] ?? -1))) d.recommendedSeverity = p.severity; break;
      case PolicyEffectType.SetRecommendedUrgency:
        if (typeof p.urgency === "string" && (d.recommendedUrgency === null || (URGENCY_RANK[p.urgency] ?? -1) > (URGENCY_RANK[d.recommendedUrgency] ?? -1))) d.recommendedUrgency = p.urgency; break;
      case PolicyEffectType.RequireReview: d.requireReview = true; break;
      case PolicyEffectType.RequireSupervisorReview: d.requireSupervisorReview = true; d.requireReview = true; break;
      case PolicyEffectType.CreateEscalationRecommendation: d.recommendEscalation = true; break;
      case PolicyEffectType.SetEscalationLevel:
        if (typeof p.level === "string" && (d.escalationLevel === null || (ESCALATION_RANK[p.level] ?? -1) > (ESCALATION_RANK[d.escalationLevel] ?? -1))) d.escalationLevel = p.level; break;
      case PolicyEffectType.ProposeProtectionPlan: d.proposeProtectionPlan = true; break;
      case PolicyEffectType.ProposeProtectionAction: {
        const at = String(p.actionType ?? ""); if (!at) break;
        const existing = actionMap.get(at);
        const requiresApproval = Boolean(p.requiresApproval) || (existing?.requiresApproval ?? false); // safer wins
        actionMap.set(at, { actionType: at, reasonCode: String(p.reasonCode ?? existing?.reasonCode ?? ""), requiresApproval });
        break;
      }
      case PolicyEffectType.AllowAutomaticIntervention: {
        const it = String(p.interventionType ?? ""); if (!it) break;
        d.allowAutomaticIntervention = true;
        boundsMap.set(it, { interventionType: it, maxSeverity: String(p.maxSeverity ?? "low"), maxUrgency: String(p.maxUrgency ?? "routine"), prerequisites: Array.isArray(p.prerequisites) ? (p.prerequisites as string[]).map(String).sort() : [] });
        break;
      }
      case PolicyEffectType.RequireManualInterventionApproval: d.requireManualInterventionApproval = true; break;
      case PolicyEffectType.AllowGuardianContactConsideration: d.allowGuardianContactConsideration = true; break;
      case PolicyEffectType.ProhibitGuardianContact: d.prohibitGuardianContact = true; break;
      case PolicyEffectType.ManualOnly: d.manualOnly = true; break;
      case PolicyEffectType.NoAction: break;
    }
  }
  // Deny-over-allow / manual-over-automatic overrides (applied AFTER collection so order can't defeat them).
  if (d.manualOnly || d.requireManualInterventionApproval) { d.allowAutomaticIntervention = false; d.automaticInterventionBounds = []; }
  else d.automaticInterventionBounds = [...boundsMap.values()].sort((a, b) => a.interventionType.localeCompare(b.interventionType));
  if (d.prohibitGuardianContact) d.allowGuardianContactConsideration = false;
  d.proposedActions = [...actionMap.values()].sort((a, b) => a.actionType.localeCompare(b.actionType));
  return d;
}
