/**
 * Auto-Protect engine.
 *
 * Maps a merged classification to a product harmful-content category, looks up
 * the brand's policy, and computes a decision. `auto_hide_shadow` yields a
 * "would_auto_hide" decision ONLY — no platform action is ever performed here.
 * Normal criticism is never auto-hidden (safety floor).
 */
import { normalize, containsFuzzy } from "./risk-classifier";

export type AutoProtectCategory =
  | "profanity" | "personal_attack" | "hate_speech" | "racism" | "scam" | "phishing"
  | "spam" | "threat" | "violence" | "terrorism_extremism" | "sexual_vulgarity"
  | "competitor_promo" | "coordinated_attack" | "brand_impersonation" | "crisis_keyword"
  | "normal_criticism";

export type AutoProtectMode = "monitor" | "approval" | "auto_hide_shadow" | "auto_hide_live_reserved";

export type AutoProtectDecisionValue =
  | "no_action" | "monitor" | "requires_approval" | "would_auto_hide" | "blocked_by_safety";

export interface AutoProtectPolicy {
  category: string;
  mode: string;
  minConfidence: number;
  isActive: boolean;
}

export interface AutoProtectInput {
  text: string;
  riskLevel: string;
  categories: string[];
  riskSignals: string[];
  matchedTerms: string[];
  sentiment: string;
  confidence: number;
}

export interface AutoProtectResult {
  decision: AutoProtectDecisionValue;
  matchedCategory: AutoProtectCategory;
  policyMode: AutoProtectMode | "none";
  confidence: number;
  reason: string;
  safetyBlocked: boolean;
}

export const AUTO_PROTECT_CATEGORIES: AutoProtectCategory[] = [
  "profanity", "personal_attack", "hate_speech", "racism", "scam", "phishing",
  "spam", "threat", "violence", "terrorism_extremism", "sexual_vulgarity",
  "competitor_promo", "coordinated_attack", "brand_impersonation", "crisis_keyword",
  "normal_criticism",
];

/** Safe brand defaults — no live action anywhere; criticism stays monitor. */
export const DEFAULT_AUTO_PROTECT_POLICIES: { category: AutoProtectCategory; mode: AutoProtectMode }[] = [
  { category: "profanity", mode: "approval" },
  { category: "personal_attack", mode: "approval" },
  { category: "hate_speech", mode: "auto_hide_shadow" },
  { category: "racism", mode: "auto_hide_shadow" },
  { category: "scam", mode: "auto_hide_shadow" },
  { category: "phishing", mode: "auto_hide_shadow" },
  { category: "spam", mode: "approval" },
  { category: "threat", mode: "approval" },
  { category: "violence", mode: "approval" },
  { category: "terrorism_extremism", mode: "auto_hide_shadow" },
  { category: "sexual_vulgarity", mode: "approval" },
  { category: "competitor_promo", mode: "approval" },
  { category: "coordinated_attack", mode: "approval" },
  { category: "brand_impersonation", mode: "approval" },
  { category: "crisis_keyword", mode: "approval" },
  { category: "normal_criticism", mode: "monitor" },
];

/** Categories that can reach would_auto_hide (confidence-gated). */
const SHADOW_ELIGIBLE = new Set<AutoProtectCategory>([
  "hate_speech", "racism", "terrorism_extremism", "phishing", "scam", "threat",
  "violence", "spam", "profanity", "personal_attack", "sexual_vulgarity",
  "coordinated_attack", "brand_impersonation", "crisis_keyword", "competitor_promo",
]);

/** Supplemental term lexicon for categories the base classifier doesn't signal. */
const TERM_LEXICON: { category: AutoProtectCategory; terms: string[] }[] = [
  { category: "terrorism_extremism", terms: ["bomb", "jihad", "heil hitler", "terror attack", "behead"] },
  { category: "racism", terms: ["go back to your country", "your race", "subhuman", "racial slur"] },
  { category: "violence", terms: ["i will kill you", "kill you", "beat you up", "i will hurt", "stab you", "shoot you", "zabijem ta", "zbijem ta"] },
  { category: "phishing", terms: ["verify your account", "confirm your password", "reset your password", "login here", "click here to claim", "bank details", "wire transfer"] },
  { category: "sexual_vulgarity", terms: ["send nudes", "porn", "explicit sexual"] },
  { category: "brand_impersonation", terms: ["official account", "i am the ceo", "real owner", "verified official", "this page impersonates"] },
  { category: "crisis_keyword", terms: ["class action lawsuit", "data breach", "health inspection", "product recall", "regulatory complaint"] },
];

/** Promo/self-promotion markers that turn a competitor mention into competitor_promo. */
const PROMO_MARKERS = [
  "dm me", "message me", "pm me", "join us", "come to us", "check my page", "follow me",
  "subscribe", "we are cheaper", "piste dm", "podte ku mnu", "podte ku mne", "kupte u mna", "napiste mi",
];

/** Signal → category, ordered by severity (most severe first). */
const SIGNAL_MAP: [string, AutoProtectCategory][] = [
  ["hate_speech", "hate_speech"],
  ["legal_threat", "threat"],
  ["scam", "scam"],
  ["harassment", "personal_attack"],
  ["brand_attack", "coordinated_attack"],
  ["crisis", "crisis_keyword"],
  ["spam", "spam"],
  ["profanity", "profanity"],
];

const PRIORITY: AutoProtectCategory[] = [
  "terrorism_extremism", "racism", "hate_speech", "threat", "violence", "phishing",
  "scam", "sexual_vulgarity", "brand_impersonation", "coordinated_attack",
  "personal_attack", "crisis_keyword", "spam", "profanity", "competitor_promo",
  "normal_criticism",
];

function pickHigher(a: AutoProtectCategory, b: AutoProtectCategory): AutoProtectCategory {
  return PRIORITY.indexOf(a) <= PRIORITY.indexOf(b) ? a : b;
}

/** Determine the matched Auto-Protect category for an item. */
export function matchAutoProtectCategory(text: string, signals: string[]): AutoProtectCategory {
  const norm = normalize(text);
  let category: AutoProtectCategory = "normal_criticism";

  for (const { category: c, terms } of TERM_LEXICON) {
    if (terms.some((t) => containsFuzzy(norm, t))) category = pickHigher(category, c);
  }
  for (const [sig, c] of SIGNAL_MAP) {
    if (signals.includes(sig)) category = pickHigher(category, c);
  }
  // Promo/self-promotion markers → competitor_promo (with or without a competitor
  // signal). A bare competitor mention without promo is a normal comparison.
  const promo = PROMO_MARKERS.some((m) => containsFuzzy(norm, m));
  if (promo) category = pickHigher(category, "competitor_promo");
  else if (signals.includes("competitor")) category = pickHigher(category, "normal_criticism");
  return category;
}

/** Evaluate the Auto-Protect decision. Never performs a platform action. */
export function evaluateAutoProtect(
  input: AutoProtectInput,
  policies: AutoProtectPolicy[],
): AutoProtectResult {
  const signals = [...new Set([...input.riskSignals, ...input.categories])];
  const matchedCategory = matchAutoProtectCategory(input.text, signals);

  const policy = policies.find((p) => p.category === matchedCategory && p.isActive);
  const policyMode = (policy?.mode as AutoProtectMode | undefined) ?? "none";
  const minConfidence = policy?.minConfidence ?? 0.7;
  const confidence = input.confidence;

  // No active policy → client hasn't enabled this category → monitor only.
  if (!policy) {
    return { decision: "monitor", matchedCategory, policyMode: "none", confidence, reason: "No active policy — monitor only.", safetyBlocked: false };
  }

  if (policyMode === "monitor") {
    const positive = input.sentiment === "positive" && input.riskLevel === "none";
    return { decision: positive ? "no_action" : "monitor", matchedCategory, policyMode, confidence, reason: "Monitor policy.", safetyBlocked: false };
  }

  if (policyMode === "approval") {
    return { decision: "requires_approval", matchedCategory, policyMode, confidence, reason: "Approval policy — routed to human review.", safetyBlocked: false };
  }

  // auto_hide_shadow (and reserved-live, which we still treat as shadow here).
  // Safety floor: normal criticism is never auto-hidden.
  if (matchedCategory === "normal_criticism") {
    return { decision: "blocked_by_safety", matchedCategory, policyMode, confidence, reason: "Normal criticism is never auto-hidden.", safetyBlocked: true };
  }
  if (!SHADOW_ELIGIBLE.has(matchedCategory)) {
    return { decision: "requires_approval", matchedCategory, policyMode, confidence, reason: "Category not shadow-eligible — human review.", safetyBlocked: true };
  }
  if (confidence < minConfidence) {
    return { decision: "requires_approval", matchedCategory, policyMode, confidence, reason: `Confidence ${confidence.toFixed(2)} < ${minConfidence.toFixed(2)} — downgraded to review.`, safetyBlocked: false };
  }
  // Shadow decision only — Guardora would hide, but live actions are disabled.
  return { decision: "would_auto_hide", matchedCategory, policyMode, confidence, reason: `Shadow mode: would auto-hide (confidence ${confidence.toFixed(2)} ≥ ${minConfidence.toFixed(2)}). No platform action performed.`, safetyBlocked: false };
}
