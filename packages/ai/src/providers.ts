/**
 * Provider-agnostic interfaces for translation and AI risk classification.
 *
 * Ships with `none` (honest no-op — never fabricates output) and `mock`
 * (deterministic, clearly-labelled, DEV/TEST ONLY) implementations. A real
 * external provider plugs in behind the same interface with no pipeline changes.
 * Nothing here performs a platform action.
 */

/* -------------------------------------------------------------- Translation */

export interface TranslationInput {
  text: string;
  sourceLanguage: string;
  targetLocale: string;
  brandId?: string;
  tenantId?: string;
  itemId?: string;
}

export type TranslationCallStatus = "translated" | "unavailable" | "failed";

export interface TranslationOutput {
  translatedText: string | null;
  sourceLanguage: string;
  targetLanguage: string;
  confidence: number;
  provider: string;
  status: TranslationCallStatus;
  errorCode?: string;
  latencyMs: number;
}

export interface TranslationProvider {
  readonly name: string;
  translate(input: TranslationInput): Promise<TranslationOutput>;
}

/** Honest no-op: never invents a translation. */
export class NoneTranslationProvider implements TranslationProvider {
  readonly name = "none";
  async translate(input: TranslationInput): Promise<TranslationOutput> {
    return {
      translatedText: null,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLocale,
      confidence: 0,
      provider: this.name,
      status: "unavailable",
      latencyMs: 0,
    };
  }
}

/** Deterministic MOCK — clearly labelled, for local tests only. Not for production. */
export class MockTranslationProvider implements TranslationProvider {
  readonly name = "mock";
  async translate(input: TranslationInput): Promise<TranslationOutput> {
    return {
      translatedText: `[mock→${input.targetLocale}] ${input.text}`,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLocale,
      confidence: 0.5,
      provider: this.name,
      status: "translated",
      latencyMs: 1,
    };
  }
}

export function getTranslationProvider(name: string): TranslationProvider {
  // `mock` is refused in production — it must never ship a fake translation live.
  if (name === "mock" && process.env.NODE_ENV !== "production") return new MockTranslationProvider();
  return new NoneTranslationProvider();
}

/* ----------------------------------------------------------------- AI Risk */

export type RecommendedAction = "escalate" | "review" | "monitor" | "none";

export interface AiRiskInput {
  originalText: string;
  translatedText?: string | null;
  detectedLanguage: string;
  brandContext?: string;
  existingRuleSignals: string[];
  platform: string;
  itemKind: string;
}

export type AiRiskCallStatus = "classified" | "skipped" | "unavailable" | "failed";

export interface AiRiskOutput {
  riskLevel: string;
  priority: string;
  sentiment: string;
  categories: string[];
  confidence: number;
  shortReason: string;
  approvalRequired: boolean;
  recommendedReviewAction: RecommendedAction;
  matchedSignals: string[];
  provider: string;
  status: AiRiskCallStatus;
  errorCode?: string;
  latencyMs: number;
}

export interface AiRiskProvider {
  readonly name: string;
  classify(input: AiRiskInput): Promise<AiRiskOutput>;
}

/** Honest no-op: contributes nothing; the Risk Rules V1 result stands. */
export class NoneAiRiskProvider implements AiRiskProvider {
  readonly name = "none";
  async classify(input: AiRiskInput): Promise<AiRiskOutput> {
    return {
      riskLevel: "none",
      priority: "low",
      sentiment: "neutral",
      categories: [],
      confidence: 0,
      shortReason: "",
      approvalRequired: false,
      recommendedReviewAction: "none",
      matchedSignals: input.existingRuleSignals,
      provider: this.name,
      status: "skipped",
      latencyMs: 0,
    };
  }
}

/** Deterministic MOCK AI — clearly labelled, for local tests only. Not for production. */
export class MockAiRiskProvider implements AiRiskProvider {
  readonly name = "mock";
  async classify(input: AiRiskInput): Promise<AiRiskOutput> {
    const hasSignals = input.existingRuleSignals.length > 0;
    if (hasSignals) {
      return {
        riskLevel: "high",
        priority: "high",
        sentiment: "negative",
        categories: input.existingRuleSignals,
        confidence: 0.82,
        shortReason: "[mock-ai] Confirmed rule signals; human review recommended.",
        approvalRequired: true,
        recommendedReviewAction: "review",
        matchedSignals: input.existingRuleSignals,
        provider: this.name,
        status: "classified",
        latencyMs: 2,
      };
    }
    if (input.detectedLanguage === "unknown") {
      return {
        riskLevel: "medium",
        priority: "normal",
        sentiment: "neutral",
        categories: [],
        confidence: 0.7,
        shortReason: "[mock-ai] Unknown language — flagged for human review.",
        approvalRequired: false,
        recommendedReviewAction: "review",
        matchedSignals: [],
        provider: this.name,
        status: "classified",
        latencyMs: 2,
      };
    }
    return {
      riskLevel: "none",
      priority: "low",
      sentiment: "neutral",
      categories: [],
      confidence: 0.75,
      shortReason: "[mock-ai] No additional risk detected.",
      approvalRequired: false,
      recommendedReviewAction: "none",
      matchedSignals: [],
      provider: this.name,
      status: "classified",
      latencyMs: 2,
    };
  }
}

export function getAiRiskProvider(name: string): AiRiskProvider {
  if (name === "mock" && process.env.NODE_ENV !== "production") return new MockAiRiskProvider();
  return new NoneAiRiskProvider();
}
