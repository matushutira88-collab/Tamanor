/**
 * Hybrid classification pipeline.
 *
 * Risk Rules V1 is the cheap first-pass filter that runs on every comment. An
 * external AI risk provider is only called when it adds value (gating), and a
 * translation provider only when the comment isn't already in the target locale.
 * `none` providers never fabricate output. Nothing here performs a platform
 * action — it only produces a classification + (optionally) a proposal upstream.
 */
import { RiskClassifier } from "./risk-classifier";
import type { ClassificationInput } from "./types";
import {
  getTranslationProvider,
  getAiRiskProvider,
  type AiRiskCallStatus,
  type TranslationCallStatus,
  type RecommendedAction,
} from "./providers";

const RISK_ORDER = ["none", "low", "medium", "high", "critical"] as const;
const rank = (l: string) => Math.max(0, RISK_ORDER.indexOf(l as (typeof RISK_ORDER)[number]));

export interface HybridConfig {
  workspaceLocale: string;
  translation: { enabled: boolean; provider: string; targetMode: "workspace_locale" | "en" };
  aiRisk: { enabled: boolean; provider: string; minConfidence: number };
  brandContext?: string;
}

export interface ProviderCallRecord {
  type: "translation" | "ai_risk";
  provider: string;
  status: string;
  latencyMs: number;
  errorCode?: string;
}

export interface HybridResult {
  // Final merged assessment.
  level: string;
  confidence: number;
  categories: string[];
  sentiment: string;
  detectedLanguage: string;
  languageConfidence: number;
  isMixedLanguage: boolean;
  languageDetectionSource: string;
  approvalRequired: boolean;
  // Explanation (structured).
  explanation: {
    matchedTerms: string[];
    matchedRules: string[];
    riskSignals: string[];
    recommendedReviewAction: RecommendedAction;
    shortReason: string;
  };
  // Translation outcome.
  translationStatus: "not_needed" | TranslationCallStatus;
  translationProvider: string;
  translatedText: string | null;
  translatedToLocale: string | null;
  // AI outcome.
  classificationMode: "rules_only" | "ai_assisted";
  aiProvider: string;
  aiProviderStatus: AiRiskCallStatus;
  // Engine + observability.
  engine: string;
  providerCalls: ProviderCallRecord[];
}

const classifier = new RiskClassifier();

/** Should the AI provider be consulted for this item? Rules stay the cheap filter. */
function shouldCallAi(rules: {
  detectedLanguage?: string;
  isMixedLanguage?: boolean;
  confidence: number;
  level: string;
  explanation?: { riskSignals: string[]; matchedRules: string[] };
}, minConfidence: number): boolean {
  const signals = rules.explanation?.riskSignals ?? [];
  const escalating = ["scam", "legal_threat", "harassment", "hate_speech"];
  return (
    rules.detectedLanguage === "unknown" ||
    rules.isMixedLanguage === true ||
    rules.confidence < minConfidence ||
    rank(rules.level) >= rank("high") ||
    signals.some((s) => escalating.includes(s)) ||
    (rules.explanation?.matchedRules.length ?? 0) > 0
  );
}

export async function classifyHybrid(
  input: ClassificationInput,
  cfg: HybridConfig,
): Promise<HybridResult> {
  const providerCalls: ProviderCallRecord[] = [];

  // 1–3) original text preserved by caller; language detection + Risk Rules V1.
  const rules = await classifier.classify(input);
  const detectedLanguage = rules.detectedLanguage ?? "unknown";
  const ruleSignals = rules.explanation?.riskSignals ?? [];

  // 4) Translation (only if not already in the target locale).
  const targetLocale = cfg.translation.targetMode === "en" ? "en" : cfg.workspaceLocale;
  const sameLanguage = detectedLanguage !== "unknown" && detectedLanguage.slice(0, 2) === targetLocale.slice(0, 2);
  let translationStatus: HybridResult["translationStatus"] = "not_needed";
  let translationProvider = "none";
  let translatedText: string | null = null;
  let translatedToLocale: string | null = null;
  if (!sameLanguage) {
    translatedToLocale = targetLocale;
    if (cfg.translation.enabled && cfg.translation.provider !== "none") {
      const provider = getTranslationProvider(cfg.translation.provider);
      const out = await provider.translate({
        text: input.text,
        sourceLanguage: detectedLanguage,
        targetLocale,
        brandId: undefined,
      });
      translationStatus = out.status;
      translationProvider = out.provider;
      translatedText = out.translatedText;
      providerCalls.push({ type: "translation", provider: out.provider, status: out.status, latencyMs: out.latencyMs, errorCode: out.errorCode });
    } else {
      translationStatus = "unavailable";
    }
  }

  // 5) AI risk provider — only when it adds value.
  let classificationMode: HybridResult["classificationMode"] = "rules_only";
  let aiProvider = "none";
  let aiProviderStatus: AiRiskCallStatus = "skipped";
  let level = rules.level as unknown as string;
  let confidence = rules.confidence;
  let sentiment = rules.sentiment as unknown as string;
  let categories = [...(rules.categories as unknown as string[])];
  let recommendedReviewAction = rules.explanation?.recommendedReviewAction ?? "none";
  let approvalRequired = rank(level) >= rank("high");
  let shortReason = "";

  const gated = cfg.aiRisk.enabled && cfg.aiRisk.provider !== "none" &&
    shouldCallAi({ detectedLanguage, isMixedLanguage: rules.isMixedLanguage, confidence, level, explanation: rules.explanation }, cfg.aiRisk.minConfidence);

  if (gated) {
    const ai = getAiRiskProvider(cfg.aiRisk.provider);
    const out = await ai.classify({
      originalText: input.text,
      translatedText,
      detectedLanguage,
      brandContext: cfg.brandContext,
      existingRuleSignals: ruleSignals,
      platform: String(input.platform),
      itemKind: "comment",
    });
    aiProvider = out.provider;
    aiProviderStatus = out.status;
    providerCalls.push({ type: "ai_risk", provider: out.provider, status: out.status, latencyMs: out.latencyMs, errorCode: out.errorCode });
    if (out.status === "classified") {
      classificationMode = "ai_assisted";
      // Merge: never LOWER the rules risk (rules are a safety floor); union signals.
      if (rank(out.riskLevel) > rank(level)) level = out.riskLevel;
      confidence = Math.max(confidence, out.confidence);
      if (out.categories.length) categories = [...new Set([...categories, ...out.categories])];
      if (out.recommendedReviewAction !== "none") recommendedReviewAction = out.recommendedReviewAction;
      if (out.sentiment) sentiment = out.sentiment;
      approvalRequired = approvalRequired || out.approvalRequired || rank(level) >= rank("high");
      shortReason = out.shortReason;
    }
    // failed/unavailable → fall back to rules result (already the default).
  }

  return {
    level,
    confidence: round2(confidence),
    categories,
    sentiment,
    detectedLanguage,
    languageConfidence: rules.languageConfidence ?? 0,
    isMixedLanguage: rules.isMixedLanguage ?? false,
    languageDetectionSource: rules.languageDetectionSource ?? "unknown",
    approvalRequired,
    explanation: {
      matchedTerms: rules.explanation?.matchedTerms ?? [],
      matchedRules: rules.explanation?.matchedRules ?? [],
      riskSignals: ruleSignals,
      recommendedReviewAction,
      shortReason,
    },
    translationStatus,
    translationProvider,
    translatedText,
    translatedToLocale,
    classificationMode,
    aiProvider,
    aiProviderStatus,
    engine: rules.engine ?? "risk-rules-v1",
    providerCalls,
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Map a HybridResult into the persisted ReputationItem intelligence fields.
 * Plain data — spread into the create/update. Risk level/priority/etc. are set
 * by the caller from the merged result; this covers language/translation/AI/
 * explanation columns.
 */
export function buildIntelFromHybrid(h: HybridResult) {
  return {
    detectedLanguage: h.detectedLanguage,
    languageConfidence: h.languageConfidence,
    isMixedLanguage: h.isMixedLanguage,
    languageDetectionSource: h.languageDetectionSource,
    translationStatus: h.translationStatus,
    translationProvider: h.translationProvider,
    translatedText: h.translatedText,
    translatedToLocale: h.translatedToLocale,
    classificationMode: h.classificationMode,
    aiProvider: h.aiProvider,
    aiProviderStatus: h.aiProviderStatus,
    riskExplanation: (h.explanation ?? undefined) as never,
  };
}
