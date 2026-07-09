/**
 * Social Reputation Control Center — the unified decision layer.
 *
 * A company defines the boundaries (Control Policies + Autonomy Matrix); Guardora
 * acts ONLY within those rules. This module is the single source of truth for
 * control categories, modes, allowed actions, the hard safety layer, presets, and
 * the `evaluateControl` decision. Nothing here executes a platform action — it
 * decides intent; execution stays gated (default: none, live actions = 0).
 */
import { matchAutoProtectCategory } from "./auto-protect";
import { normalize, containsFuzzy } from "./risk-classifier";

/* ------------------------------------------------------------- Vocabulary */

export type SourceType = "comment" | "review" | "mention" | "message" | "post" | "rating";
export const SOURCE_TYPES: SourceType[] = ["comment", "review", "mention", "message", "post", "rating"];

export type ControlCategory =
  | "spam" | "scam" | "phishing" | "profanity" | "personal_attack" | "hate_speech"
  | "racism" | "threat" | "violence" | "terrorism_extremism" | "sexual_vulgarity"
  | "competitor_promo" | "coordinated_attack" | "brand_impersonation" | "crisis_keyword"
  | "normal_criticism" | "customer_question" | "refund_complaint" | "legal_complaint"
  | "safety_claim" | "positive_feedback";

export const CONTROL_CATEGORIES: ControlCategory[] = [
  "spam", "scam", "phishing", "profanity", "personal_attack", "hate_speech", "racism",
  "threat", "violence", "terrorism_extremism", "sexual_vulgarity", "competitor_promo",
  "coordinated_attack", "brand_impersonation", "crisis_keyword", "normal_criticism",
  "customer_question", "refund_complaint", "legal_complaint", "safety_claim", "positive_feedback",
];

export type ControlMode = "monitor" | "assist" | "approval" | "autonomous";
export const CONTROL_MODES: ControlMode[] = ["monitor", "assist", "approval", "autonomous"];

export type ControlAction =
  | "notify" | "create_inbox_item" | "suggest_reply" | "request_approval" | "hide_comment"
  | "report" | "escalate" | "assign_to_user" | "create_incident" | "no_action";

export type QueueState =
  | "suggested" | "approval_required" | "approved" | "rejected" | "blocked_by_safety"
  | "dry_run" | "executed" | "failed" | "rollback_needed" | "monitor" | "no_action";

/* ------------------------------------------------------------ Safety layer */

/**
 * Categories that may NEVER be auto-hidden autonomously. Legitimate customer
 * voice and critical judgement calls always route to a human at most.
 */
export const NEVER_AUTONOMOUS: Set<ControlCategory> = new Set([
  "normal_criticism", "refund_complaint", "legal_complaint", "safety_claim",
  "customer_question", "positive_feedback",
]);

/** Categories eligible for an autonomous hide candidate (still gated + shadow). */
export const AUTONOMOUS_ELIGIBLE: Set<ControlCategory> = new Set([
  "spam", "scam", "phishing", "profanity", "personal_attack", "hate_speech",
  "racism", "threat", "violence", "terrorism_extremism", "sexual_vulgarity",
]);

/** Categories that raise an incident when detected. */
export const INCIDENT_CATEGORIES: Set<ControlCategory> = new Set([
  "crisis_keyword", "coordinated_attack", "threat", "legal_complaint",
  "safety_claim", "brand_impersonation", "terrorism_extremism",
]);

const MIN_AUTONOMOUS_CONFIDENCE = 0.8;

/* ------------------------------------------------ Customer-intent detection */

const INTENT_LEXICON: { category: ControlCategory; terms: string[] }[] = [
  { category: "refund_complaint", terms: ["refund", "money back", "chargeback", "vratenie penazi", "vratte mi peniaze", "ruckerstattung", "reklamacia"] },
  { category: "legal_complaint", terms: ["my lawyer", "lawsuit", "sue you", "legal action", "pravnik", "zalujem", "anwalt", "gdpr complaint"] },
  { category: "safety_claim", terms: ["injury", "got hurt", "unsafe", "dangerous", "got sick", "food poisoning", "zranenie", "ublizilo", "nebezpecne"] },
];

/**
 * Map an item to a Control Center category. Harmful categories (from Auto-Protect)
 * take priority; otherwise customer-intent (question/refund/legal/safety) and
 * finally positive/normal_criticism.
 */
export function matchControlCategory(input: {
  text: string;
  riskSignals: string[];
  categories: string[];
  sentiment: string;
  riskLevel: string;
}): ControlCategory {
  const harmful = matchAutoProtectCategory(input.text, [...new Set([...input.riskSignals, ...input.categories])]) as ControlCategory;
  if (harmful !== "normal_criticism") return harmful;

  const norm = normalize(input.text);
  // legal > safety > refund precedence.
  for (const cat of ["legal_complaint", "safety_claim", "refund_complaint"] as ControlCategory[]) {
    const entry = INTENT_LEXICON.find((e) => e.category === cat)!;
    if (entry.terms.some((t) => containsFuzzy(norm, t))) return cat;
  }
  if (input.sentiment === "positive" && input.riskLevel === "none") return "positive_feedback";
  if (/\?\s*$/.test(input.text) && input.riskLevel === "none") return "customer_question";
  return "normal_criticism";
}

/* -------------------------------------------------------------- Presets */

export type PresetName = "conservative" | "balanced" | "aggressive" | "custom";

/** Preset → per-category mode. Autonomous appears only where clearly safe. */
export const PRESETS: Record<Exclude<PresetName, "custom">, Partial<Record<ControlCategory, ControlMode>>> = {
  conservative: {
    spam: "autonomous", scam: "autonomous", phishing: "autonomous",
    profanity: "approval", personal_attack: "approval", hate_speech: "approval",
    racism: "approval", threat: "approval", violence: "approval",
    terrorism_extremism: "approval", sexual_vulgarity: "approval",
    competitor_promo: "approval", coordinated_attack: "approval",
    brand_impersonation: "approval", crisis_keyword: "approval",
    refund_complaint: "assist", legal_complaint: "approval", safety_claim: "approval",
    customer_question: "assist", normal_criticism: "monitor", positive_feedback: "monitor",
  },
  balanced: {
    spam: "autonomous", scam: "autonomous", phishing: "autonomous",
    profanity: "approval", personal_attack: "approval", hate_speech: "autonomous",
    racism: "autonomous", threat: "approval", violence: "approval",
    terrorism_extremism: "autonomous", sexual_vulgarity: "approval",
    competitor_promo: "approval", coordinated_attack: "approval",
    brand_impersonation: "approval", crisis_keyword: "approval",
    refund_complaint: "assist", legal_complaint: "approval", safety_claim: "approval",
    customer_question: "assist", normal_criticism: "monitor", positive_feedback: "monitor",
  },
  aggressive: {
    spam: "autonomous", scam: "autonomous", phishing: "autonomous",
    profanity: "autonomous", personal_attack: "autonomous", hate_speech: "autonomous",
    racism: "autonomous", threat: "approval", violence: "approval",
    terrorism_extremism: "autonomous", sexual_vulgarity: "autonomous",
    competitor_promo: "approval", coordinated_attack: "approval",
    brand_impersonation: "approval", crisis_keyword: "approval",
    refund_complaint: "assist", legal_complaint: "approval", safety_claim: "approval",
    customer_question: "assist", normal_criticism: "monitor", positive_feedback: "monitor",
  },
};

/** Full policy set for a preset (every category gets a mode; safety-clamped). */
export function presetPolicies(preset: Exclude<PresetName, "custom">): { category: ControlCategory; mode: ControlMode }[] {
  const map = PRESETS[preset];
  return CONTROL_CATEGORIES.map((category) => {
    let mode = map[category] ?? "monitor";
    // Safety clamp: never-autonomous categories can be at most approval.
    if (NEVER_AUTONOMOUS.has(category) && mode === "autonomous") mode = "approval";
    return { category, mode };
  });
}

/* ------------------------------------------------------ Control evaluation */

export interface ControlPolicyLite {
  category: string;
  mode: string; // monitor | assist | approval | autonomous
  minConfidence: number;
  isActive: boolean;
}

export interface ControlDecision {
  matchedCategory: ControlCategory;
  mode: ControlMode | "none";
  proposedAction: ControlAction;
  queueState: QueueState;
  confidence: number;
  reason: string;
  safetyBlocked: boolean;
  /** True only for an autonomous candidate that COULD execute if env gates allowed. */
  wouldExecute: boolean;
  raisesIncident: boolean;
}

/**
 * Decide what Guardora may do for an item, within the brand's policy. Applies the
 * hard safety layer. Never returns a live execution — autonomous resolves to a
 * gated candidate (dry-run/shadow) that the execution layer decides on.
 */
export function evaluateControl(input: {
  text: string;
  riskSignals: string[];
  categories: string[];
  sentiment: string;
  riskLevel: string;
  confidence: number;
}, policies: ControlPolicyLite[]): ControlDecision {
  const matchedCategory = matchControlCategory(input);
  const raisesIncident = INCIDENT_CATEGORIES.has(matchedCategory);
  const policy = policies.find((p) => p.category === matchedCategory && p.isActive);
  const confidence = input.confidence;

  const base = { matchedCategory, confidence, raisesIncident, safetyBlocked: false, wouldExecute: false };

  if (!policy) {
    return { ...base, mode: "none", proposedAction: "create_inbox_item", queueState: "monitor", reason: "No active policy — monitor only." };
  }
  const mode = policy.mode as ControlMode;

  if (mode === "monitor") {
    return { ...base, mode, proposedAction: "create_inbox_item", queueState: "monitor", reason: "Monitor policy." };
  }
  if (mode === "assist") {
    return { ...base, mode, proposedAction: "suggest_reply", queueState: "suggested", reason: "Assist policy — reply suggested for review." };
  }
  if (mode === "approval") {
    return { ...base, mode, proposedAction: "request_approval", queueState: "approval_required", reason: "Approval policy — routed to a human." };
  }

  // mode === autonomous — hard safety gates.
  if (NEVER_AUTONOMOUS.has(matchedCategory)) {
    return { ...base, mode, proposedAction: "request_approval", queueState: "blocked_by_safety", safetyBlocked: true, reason: "Safety floor: this category is never auto-hidden." };
  }
  if (!AUTONOMOUS_ELIGIBLE.has(matchedCategory)) {
    return { ...base, mode, proposedAction: "request_approval", queueState: "approval_required", reason: "Category not eligible for autonomous action — human review." };
  }
  if (confidence < Math.max(MIN_AUTONOMOUS_CONFIDENCE, policy.minConfidence)) {
    return { ...base, mode, proposedAction: "request_approval", queueState: "approval_required", reason: `Confidence ${confidence.toFixed(2)} below autonomous threshold — downgraded to approval.` };
  }
  // Autonomous candidate. Execution stays gated (shadow/dry-run by default).
  return { ...base, mode, proposedAction: "hide_comment", queueState: "dry_run", wouldExecute: true, reason: "Autonomous candidate — would hide (gated: shadow/dry-run until live env enabled). No live action by default." };
}

/** Map a legacy Auto-Protect decision to a Control queue state (migration). */
export function autoProtectToQueueState(decision: string): QueueState {
  switch (decision) {
    case "monitor": return "monitor";
    case "requires_approval": return "approval_required";
    case "would_auto_hide": return "dry_run";
    case "blocked_by_safety": return "blocked_by_safety";
    default: return "no_action";
  }
}
