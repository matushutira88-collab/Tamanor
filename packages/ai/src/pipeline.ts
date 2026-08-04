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
  type OpenAiRiskConfig,
} from "./providers";
import { applyBrandMemory, type BrandMemoryRule, type BrandMemoryMatch } from "./brand-memory";
import {
  decideCategory, severityForVerdicts, validEvidenceForCategory, EVIDENCE_REQUIRED_CATEGORIES,
  type CategoryDecision, type EvidenceSpan,
} from "./evidence";

/**
 * The state of the customer-visible classification as a whole.
 *  - `confirmed`       — every presented category has validated evidence (or is non-accusatory).
 *  - `review_required` — at least one accusation could not be substantiated; nothing is asserted as fact.
 * `rejected` is a per-category verdict (admin diagnostics), not a whole-item state.
 */
export type ClassificationState = "confirmed" | "review_required";

const RISK_ORDER = ["none", "low", "medium", "high", "critical"] as const;
const rank = (l: string) => Math.max(0, RISK_ORDER.indexOf(l as (typeof RISK_ORDER)[number]));

export interface HybridConfig {
  workspaceLocale: string;
  translation: { enabled: boolean; provider: string; targetMode: "workspace_locale" | "en" };
  aiRisk: {
    enabled: boolean;
    provider: string;
    minConfidence: number;
    /**
     * `value_gated` (default): call the AI provider only when `shouldCallAi` says it adds value.
     * `all`: call the AI provider for every comment (still only after enabled+provider hold, and — in the
     * metered path — after all paid guards + non-cache). Missing is treated as `value_gated` (safe default).
     */
    callMode?: "value_gated" | "all";
    openai?: OpenAiRiskConfig;
  };
  brandContext?: string;
  /** Active brand-scoped memory rules (applied after Risk Rules V1). */
  memoryRules?: BrandMemoryRule[];
}

export interface ProviderCallRecord {
  type: "translation" | "ai_risk";
  provider: string;
  status: string;
  latencyMs: number;
  errorCode?: string;
}

/** A single verdict snapshot (level/confidence/categories) — used to record the rules, AI, and merged views. */
export interface RiskSnapshot {
  level: string;
  confidence: number;
  categories: string[];
}

/**
 * V1.61 — the admin-only classification breakdown persisted per comment. Lets an operator see EXACTLY what
 * the rules said, what (if anything) the AI said, and the merged outcome — plus how the AI was invoked.
 * Contains NO comment text, prompt, or raw model output; only structured verdicts + provider metadata.
 */
export interface AiDiagnostics {
  callMode: "value_gated" | "all";
  /** Pipeline value-gate decision: whether the AI was consulted and WHY (all_mode / value_added /
   *  gate_not_fired / ai_disabled / no_provider). */
  gate: { aiCalled: boolean; reason: string };
  rules: RiskSnapshot;
  /**
   * Normalized AI verdict/status/errorCode ONLY. Model, input/output tokens and cost are deliberately NOT
   * stored here — the admin panel joins the model + cost from UsageEvent and the status/error from
   * ProviderCall, so nothing is duplicated in this JSON.
   */
  ai: {
    status: AiRiskCallStatus;
    errorCode?: string;
    /** AI's OWN verdict (present only when it classified) — before the rules-floor merge. */
    verdict?: RiskSnapshot;
  };
  merged: RiskSnapshot;
  /** Per-category evidence verdicts + whether a severity escalation was refused. Admin-only. */
  evidenceGate?: {
    decisions: CategoryDecision[];
    severity: { proposed: string; applied: string; capped: boolean; reason: string };
  };
}

// Test-only seam to exercise the fail-open path in {@link safeBuildAiDiagnostics}. No effect in production.
let __forceDiagnosticsError = false;
export function __setForceDiagnosticsErrorForTests(v: boolean): void { __forceDiagnosticsError = v; }

/**
 * V1.61 — assemble the admin diagnostics snapshot with a HARD fail-open guarantee: ANY error while
 * building/normalizing it returns `null` instead of throwing, so a diagnostics problem can NEVER block the
 * classification result or the ReputationItem persist. Emits nothing carrying comment text or secrets.
 */
export function safeBuildAiDiagnostics(build: () => AiDiagnostics): AiDiagnostics | null {
  try {
    if (__forceDiagnosticsError) throw new Error("forced diagnostics failure (test-only)");
    return build();
  } catch {
    return null; // fail-open: diagnostics are optional; classification + persistence proceed unaffected.
  }
}

export interface HybridResult {
  // Final merged assessment.
  level: string;
  /**
   * CUSTOMER-VISIBLE categories only — every entry here is either non-accusatory or backed by a
   * validated evidence span. Unsubstantiated accusations are in `reviewCategories` instead.
   */
  categories: string[];
  confidence: number;
  /** `review_required` ⇒ the UI must not present any category as a confirmed violation. */
  classificationState: ClassificationState;
  requiresReview: boolean;
  confirmedCategories: string[];
  /** Accusations that could not be substantiated. Diagnostic; never presented as fact. */
  reviewCategories: string[];
  /** Accusations affirmatively refuted (no evidence, no rule agreement). Admin diagnostics only. */
  rejectedCategories: string[];
  /** Verifiable spans of `analyzedText` supporting the confirmed categories. */
  evidence: EvidenceSpan[];
  /** The normalized text the verdicts were computed against (spans index into this). */
  analyzedText: string;
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
  /** REAL token usage from a successful paid provider call (for metering). Absent otherwise. */
  aiUsage?: { inputTokens: number; outputTokens: number };
  // Brand memory.
  memoryMatched: BrandMemoryMatch[];
  // Engine + observability.
  engine: string;
  providerCalls: ProviderCallRecord[];
  /** Admin-only classification breakdown (rules vs AI vs merged + how the AI was invoked). No text.
   *  `null` when the (fail-open) diagnostics build errored — never blocks the result. */
  diagnostics: AiDiagnostics | null;
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

  // Brand memory rules (brand-scoped) applied on top of Risk Rules V1.
  const memory = applyBrandMemory({
    text: input.text,
    level: rules.level as unknown as string,
    categories: rules.categories as unknown as string[],
    riskSignals: rules.explanation?.riskSignals ?? [],
    rules: cfg.memoryRules ?? [],
  });
  const ruleSignals = memory.riskSignals;

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
  let level = memory.level;
  let confidence = rules.confidence;
  let sentiment = rules.sentiment as unknown as string;
  let categories = [...memory.categories];
  let recommendedReviewAction = rules.explanation?.recommendedReviewAction ?? "none";
  let approvalRequired = rank(level) >= rank("high");
  let shortReason = "";

  // Rules (+ brand memory) verdict, captured BEFORE any AI merge — the "rules result" for admin diagnostics.
  const rulesSnapshot: RiskSnapshot = { level, confidence: round2(confidence), categories: [...categories] };
  let aiVerdict: RiskSnapshot | undefined;
  let aiErrorCode: string | undefined;
  /** The level the AI would like; only applied if the evidence gate confirms an escalation. */
  let proposedLevel = level;
  let aiCategories: string[] = [];
  /** False as soon as any provider output is ambiguous — ambiguity may never confirm an accusation. */
  let parserOk = true;

  // `all` consults the provider for every comment (rules already ran above and remain the floor); `value_gated`
  // (default, incl. when unset) keeps the historical shouldCallAi value-gate untouched.
  const callMode = cfg.aiRisk.callMode ?? "value_gated";
  const aiEnabled = cfg.aiRisk.enabled && cfg.aiRisk.provider !== "none";
  const valueGateOpen = shouldCallAi({ detectedLanguage, isMixedLanguage: rules.isMixedLanguage, confidence, level, explanation: rules.explanation }, cfg.aiRisk.minConfidence);
  const gated = aiEnabled && (callMode === "all" || valueGateOpen);
  // Diagnostics-only gate reason (why the AI was / was not consulted at the pipeline layer).
  const gateReason = !cfg.aiRisk.enabled ? "ai_disabled"
    : cfg.aiRisk.provider === "none" ? "no_provider"
    : callMode === "all" ? "all_mode"
    : valueGateOpen ? "value_added"
    : "gate_not_fired";

  let aiUsage: HybridResult["aiUsage"];
  if (gated) {
    const ai = getAiRiskProvider(cfg.aiRisk.provider, cfg.aiRisk.openai);
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
    aiErrorCode = out.errorCode;
    providerCalls.push({ type: "ai_risk", provider: out.provider, status: out.status, latencyMs: out.latencyMs, errorCode: out.errorCode });
    if (out.status === "classified") {
      classificationMode = "ai_assisted";
      // AI's OWN verdict, recorded BEFORE the merge so diagnostics can prove the floor was applied.
      aiVerdict = { level: out.riskLevel, confidence: round2(out.confidence), categories: [...out.categories] };
      // Merge: never LOWER the rules risk (rules are a safety floor); union signals.
      // NOTE the AI's proposed level is held separately — it is NOT applied until the evidence gate below
      // has decided whether anything actually confirms an escalation.
      proposedLevel = out.riskLevel;
      aiCategories = [...out.categories];
      confidence = Math.max(confidence, out.confidence);
      if (out.categories.length) categories = [...new Set([...categories, ...out.categories])];
      if (out.recommendedReviewAction !== "none") recommendedReviewAction = out.recommendedReviewAction;
      if (out.sentiment) sentiment = out.sentiment;
      shortReason = out.shortReason;
      aiUsage = out.usage;
    } else {
      // failed/unavailable/refused → the provider output is ambiguous; nothing from it may confirm.
      parserOk = false;
    }
  }

  // ------------------------------------------------------------------ evidence gate (fail-closed)
  // Every accusatory category must point at a span of the analyzed text before a customer sees it as a
  // fact. A confidence score is not evidence. This is what stops "suspicious" → Vulgarita/Kritické.
  const analyzedText = rules.analyzedText ?? "";
  const ruleCategories = new Set(rulesSnapshot.categories);
  const decisions: CategoryDecision[] = categories.map((category) =>
    decideCategory({
      category,
      validEvidenceCount: validEvidenceForCategory(analyzedText, rules.evidence, category).length,
      rulesAgree: ruleCategories.has(category),
      aiClaimed: aiCategories.includes(category),
      confidence,
      parserOk,
    }),
  );

  // Severity comes from CONFIRMED harm, never from a category score.
  const severity = severityForVerdicts(level, proposedLevel, decisions);
  level = severity.level;

  const confirmedCategories = decisions.filter((d) => d.verdict === "confirmed").map((d) => d.category);
  const reviewCategories = decisions.filter((d) => d.verdict === "review_required").map((d) => d.category);
  const rejectedCategories = decisions.filter((d) => d.verdict === "rejected").map((d) => d.category);

  // What the customer sees. An unconfirmed accusation NEVER appears here — it becomes a review request.
  categories = confirmedCategories.length > 0 ? confirmedCategories : [ruleCategories.has("positive") ? "positive" : "neutral"];
  const classificationState: ClassificationState =
    reviewCategories.length > 0 ? "review_required" : confirmedCategories.some((c) => EVIDENCE_REQUIRED_CATEGORIES.has(c)) ? "confirmed" : "confirmed";
  const requiresReview = reviewCategories.length > 0;

  approvalRequired = approvalRequired || rank(level) >= rank("high") || requiresReview;
  if (requiresReview && recommendedReviewAction === "none") recommendedReviewAction = "review";

  return {
    level,
    confidence: round2(confidence),
    categories,
    classificationState,
    requiresReview,
    confirmedCategories,
    reviewCategories,
    rejectedCategories,
    evidence: rules.evidence ?? [],
    analyzedText,
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
    aiUsage,
    memoryMatched: memory.matches,
    engine: rules.engine ?? "risk-rules-v1",
    providerCalls,
    diagnostics: safeBuildAiDiagnostics(() => ({
      callMode,
      gate: { aiCalled: gated, reason: gateReason },
      rules: rulesSnapshot,
      ai: { status: aiProviderStatus, errorCode: aiErrorCode, verdict: aiVerdict },
      merged: { level, confidence: round2(confidence), categories },
      // Admin-only: exactly why each claimed category was confirmed, held for review, or rejected —
      // plus whether a proposed severity escalation was refused for lack of confirmed harm.
      evidenceGate: {
        decisions,
        severity: { proposed: proposedLevel, applied: level, capped: severity.capped, reason: severity.reason },
      },
    })),
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
    aiDiagnostics: (h.diagnostics ?? undefined) as never,
  };
}
