import {
  RiskCategory,
  RiskLevel,
  RuleCategory,
  Sentiment,
} from "@guardora/core";
import type {
  ClassificationInput,
  ClassificationResult,
  ClassifierRule,
  MatchedRule,
  RiskEngine,
} from "./types";

/**
 * RiskClassifier — placeholder AI Risk Engine.
 *
 * This is a deterministic, dependency-free skeleton so the rest of the system
 * (worker, inbox, rules, audit) can be built and tested end-to-end WITHOUT any
 * real model calls. Swap this for a model-backed engine (Anthropic/OpenAI)
 * behind the same {@link RiskEngine} interface — no downstream changes needed.
 *
 * It intentionally makes NO network calls.
 */
export class RiskClassifier implements RiskEngine {
  readonly name = "placeholder-heuristic-v0";

  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const text = input.text.toLowerCase();

    const categories = new Set<RiskCategory>();
    let score = 0;

    for (const [category, weight, terms] of SIGNALS) {
      if (terms.some((t) => text.includes(t))) {
        categories.add(category);
        score = Math.max(score, weight);
      }
    }

    // Low review ratings lean negative/complaint.
    if (typeof input.rating === "number" && input.rating <= 2) {
      categories.add(RiskCategory.Complaint);
      score = Math.max(score, 0.4);
    }

    // Apply brand rules: phrase matches map onto risk categories/score.
    const matchedRules = matchBrandRules(text, input.rules);
    for (const match of matchedRules) {
      const { category, weight } = RULE_CATEGORY_EFFECT[match.category];
      if (category) categories.add(category);
      score = Math.max(score, weight);
    }

    const sentiment = deriveSentiment(categories, input.rating);
    if (categories.size === 0) {
      categories.add(sentiment === Sentiment.Positive
        ? RiskCategory.Positive
        : RiskCategory.Neutral);
    }

    const result: ClassificationResult = {
      level: scoreToLevel(score),
      confidence: round2(placeholderConfidence(score)),
      categories: [...categories],
      sentiment,
      rationale:
        matchedRules.length > 0
          ? `Placeholder heuristic + ${matchedRules.length} brand-rule match(es). Not a production model.`
          : "Placeholder heuristic classification. Not a production model.",
      engine: this.name,
    };
    if (matchedRules.length > 0) result.matchedRules = matchedRules;
    return result;
  }
}

/** How each rule category influences the risk assessment. */
const RULE_CATEGORY_EFFECT: Record<
  RuleCategory,
  { category: RiskCategory | null; weight: number }
> = {
  [RuleCategory.BlockedWords]: { category: RiskCategory.Profanity, weight: 0.8 },
  [RuleCategory.CompetitorMentions]: { category: null, weight: 0.3 },
  [RuleCategory.CrisisKeywords]: { category: RiskCategory.BrandAttack, weight: 0.9 },
  [RuleCategory.CustomPhrases]: { category: RiskCategory.Neutral, weight: 0.35 },
};

function matchBrandRules(
  text: string,
  rules: ClassifierRule[] | undefined,
): MatchedRule[] {
  if (!rules?.length) return [];
  const matches: MatchedRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const phrase of rule.phrases) {
      const needle = phrase.trim().toLowerCase();
      if (needle.length > 0 && text.includes(needle)) {
        matches.push({ category: rule.category, phrase });
      }
    }
  }
  return matches;
}

/** [category, severity 0..1, trigger terms] — illustrative, not exhaustive. */
const SIGNALS: ReadonlyArray<
  readonly [RiskCategory, number, readonly string[]]
> = [
  [RiskCategory.Scam, 0.9, ["free money", "click here", "crypto giveaway", "wire transfer"]],
  [RiskCategory.Spam, 0.7, ["buy now", "promo code", "subscribe to my", "check my profile"]],
  [RiskCategory.LegalThreat, 0.85, ["lawsuit", "sue you", "my lawyer", "legal action"]],
  [RiskCategory.Harassment, 0.8, ["idiot", "shut up", "loser"]],
  [RiskCategory.Profanity, 0.5, ["damn", "hell"]],
  [RiskCategory.Complaint, 0.4, ["terrible", "worst", "refund", "scammed me", "never again"]],
];

function deriveSentiment(
  categories: ReadonlySet<RiskCategory>,
  rating?: number,
): Sentiment {
  if (typeof rating === "number") {
    if (rating >= 4) return Sentiment.Positive;
    if (rating <= 2) return Sentiment.Negative;
  }
  const negative = [
    RiskCategory.Scam,
    RiskCategory.Spam,
    RiskCategory.LegalThreat,
    RiskCategory.Harassment,
    RiskCategory.Complaint,
    RiskCategory.HateSpeech,
  ];
  if (negative.some((c) => categories.has(c))) return Sentiment.Negative;
  return Sentiment.Neutral;
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 0.85) return RiskLevel.Critical;
  if (score >= 0.65) return RiskLevel.High;
  if (score >= 0.4) return RiskLevel.Medium;
  if (score > 0) return RiskLevel.Low;
  return RiskLevel.None;
}

/** Placeholder confidence is deliberately capped below auto-action thresholds. */
function placeholderConfidence(score: number): number {
  return Math.min(0.6, 0.3 + score * 0.3);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
