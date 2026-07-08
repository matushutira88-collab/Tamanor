/**
 * Brand risk memory — brand-scoped rules the classifier applies AFTER Risk Rules
 * V1 and before the (gated) AI provider. Learning is per-brand only; there is no
 * global cross-brand learning here. A hard safety floor prevents allow/reduce
 * rules from ever cancelling a critical safety signal.
 */
import { normalize, containsFuzzy } from "./risk-classifier";

export interface BrandMemoryRule {
  type: string; // watch_phrase | block_phrase | allow_phrase | reduce_risk_pattern | increase_risk_pattern | competitor_phrase | crisis_phrase
  normalizedPhrase: string;
  language?: string | null;
  severity: string; // low | medium | high | critical
  isActive: boolean;
}

export interface BrandMemoryMatch {
  type: string;
  phrase: string;
  effect: "raise" | "lower" | "signal" | "blocked_by_floor";
}

export interface BrandMemoryResult {
  level: string;
  categories: string[];
  riskSignals: string[];
  matches: BrandMemoryMatch[];
}

const RISK_ORDER = ["none", "low", "medium", "high", "critical"] as const;
const rank = (l: string) => Math.max(0, RISK_ORDER.indexOf(l as (typeof RISK_ORDER)[number]));
const levelFromRank = (r: number) => RISK_ORDER[Math.max(0, Math.min(RISK_ORDER.length - 1, r))]!;
const severityLevel = (s: string): string =>
  ["low", "medium", "high", "critical"].includes(s) ? s : "medium";

/** Signals that must never be reduced by allow/reduce brand memory rules. */
const PROTECTED_SIGNALS = ["scam", "legal_threat", "harassment", "hate_speech"];

/**
 * Apply active brand memory rules to a rules-derived assessment. Returns the
 * adjusted level/categories/signals plus the matched rules (for audit/UI). Never
 * lowers a protected critical signal (safety floor).
 */
export function applyBrandMemory(input: {
  text: string;
  level: string;
  categories: string[];
  riskSignals: string[];
  rules: BrandMemoryRule[];
}): BrandMemoryResult {
  const norm = normalize(input.text);
  let level = input.level;
  const categories = new Set(input.categories);
  const signals = new Set(input.riskSignals);
  const matches: BrandMemoryMatch[] = [];

  // Safety floor: protected if any hard signal present, or critical profanity.
  const protectedFloor =
    input.riskSignals.some((s) => PROTECTED_SIGNALS.includes(s)) ||
    (input.riskSignals.includes("profanity") && input.level === "critical");

  for (const r of input.rules) {
    if (!r.isActive) continue;
    if (!r.normalizedPhrase || !containsFuzzy(norm, r.normalizedPhrase)) continue;

    switch (r.type) {
      case "block_phrase":
        level = levelFromRank(Math.max(rank(level), rank("high"), rank(severityLevel(r.severity))));
        signals.add("brand_blocked");
        matches.push({ type: r.type, phrase: r.normalizedPhrase, effect: "raise" });
        break;
      case "watch_phrase":
        level = levelFromRank(Math.max(rank(level), rank("medium"), rank(severityLevel(r.severity))));
        signals.add("brand_watch");
        matches.push({ type: r.type, phrase: r.normalizedPhrase, effect: "raise" });
        break;
      case "increase_risk_pattern":
        level = levelFromRank(Math.max(rank(level), rank(severityLevel(r.severity))));
        signals.add("brand_increase");
        matches.push({ type: r.type, phrase: r.normalizedPhrase, effect: "raise" });
        break;
      case "crisis_phrase":
        level = levelFromRank(Math.max(rank(level), rank("high")));
        categories.add("brand_attack");
        signals.add("crisis");
        matches.push({ type: r.type, phrase: r.normalizedPhrase, effect: "raise" });
        break;
      case "competitor_phrase":
        categories.add("competitor");
        signals.add("competitor");
        matches.push({ type: r.type, phrase: r.normalizedPhrase, effect: "signal" });
        break;
      case "allow_phrase":
        if (protectedFloor) {
          matches.push({ type: r.type, phrase: r.normalizedPhrase, effect: "blocked_by_floor" });
        } else {
          level = "none";
          signals.add("brand_allow");
          matches.push({ type: r.type, phrase: r.normalizedPhrase, effect: "lower" });
        }
        break;
      case "reduce_risk_pattern":
        if (protectedFloor) {
          matches.push({ type: r.type, phrase: r.normalizedPhrase, effect: "blocked_by_floor" });
        } else {
          level = levelFromRank(Math.max(0, rank(level) - 2));
          signals.add("brand_reduce");
          matches.push({ type: r.type, phrase: r.normalizedPhrase, effect: "lower" });
        }
        break;
    }
  }

  return { level, categories: [...categories], riskSignals: [...signals], matches };
}
