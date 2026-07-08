import type {
  ContentItem,
  Platform,
  ReputationRisk,
  RuleCategory,
} from "@guardora/core";

/** Minimal brand-rule shape the classifier consumes (decoupled from the DB). */
export interface ClassifierRule {
  category: RuleCategory;
  phrases: string[];
  enabled: boolean;
}

/** A brand rule that matched during classification (surfaced for auditing). */
export interface MatchedRule {
  category: RuleCategory;
  phrase: string;
}

/** Minimal input the classifier needs. Decoupled from persistence. */
export interface ClassificationInput {
  text: string;
  platform: Platform;
  /** BCP-47 locale hint, if known. */
  locale?: string;
  /** Numeric rating for reviews (1–5), if applicable. */
  rating?: number;
  /** Active brand rules to apply. Optional. */
  rules?: ClassifierRule[];
}

/** Recommended human-review action (never auto-executed). */
export type RecommendedReviewAction = "escalate" | "review" | "monitor" | "none";

/** Structured, language-neutral explanation of why an item was flagged. */
export interface RiskExplanation {
  /** Lexicon/rule terms that matched (deduped, normalized). */
  matchedTerms: string[];
  /** Brand-rule names/phrases that matched. */
  matchedRules: string[];
  /** Risk signals (categories) that fired. */
  riskSignals: string[];
  /** Suggested human action. Advisory only — no platform action is executed. */
  recommendedReviewAction: RecommendedReviewAction;
}

/** Result of a single classification pass. */
export interface ClassificationResult extends ReputationRisk {
  /** Brand rules that matched, if any. */
  matchedRules?: MatchedRule[];
  /** Detected language of the content (best-effort; may be "unknown"). */
  detectedLanguage?: string;
  languageConfidence?: number;
  isMixedLanguage?: boolean;
  languageDetectionSource?: "rules" | "library" | "ai" | "unknown";
  /** Structured explanation for the "Why this was flagged" UI. */
  explanation?: RiskExplanation;
}

/** Contract every AI risk engine implementation must satisfy. */
export interface RiskEngine {
  readonly name: string;
  classify(input: ClassificationInput): Promise<ClassificationResult>;
}

/** Convenience adapter: classify directly from a ContentItem. */
export function toClassificationInput(
  item: ContentItem,
  rules?: ClassifierRule[],
): ClassificationInput {
  return {
    text: item.text,
    platform: item.platform,
    locale: item.author.locale,
    rating: item.rating,
    rules,
  };
}
