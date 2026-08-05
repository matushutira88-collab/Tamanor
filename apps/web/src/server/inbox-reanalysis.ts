import "server-only";
import {
  buildIntelFromHybrid,
  evaluateAutoProtect,
  persistedProjectionFieldsAfterClassification,
  type ClassifierRule,
} from "@guardora/ai";
import { Platform } from "@guardora/core";
import {
  abandonReanalysisPreview,
  beginReanalysisPreview,
  completeReanalysisPreview,
  withTenant,
  type PreviewRecord,
  type ReanalysisProposalV1,
} from "@guardora/db";
import { getAiRiskConfig, getTranslationConfig } from "@guardora/config";
import { CLASSIFIER_VERSION, classifyWithUsagePolicy } from "@guardora/sync";

export type PreviewItemReanalysisResult =
  | { ok: true; preview: PreviewRecord; reused: boolean }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "not_found"
        | "in_progress"
        | "provider_failure"
        | "expired"
        | "superseded"
        | "source_changed"
        | "invalid_proposal"
        | "proposal_too_large";
    };

function priorityForRisk(level: string): "low" | "normal" | "high" | "urgent" {
  if (level === "critical") return "urgent";
  if (level === "high") return "high";
  if (level === "medium") return "normal";
  return "low";
}

/**
 * Execute the ONE classifier/provider run for Preview and persist only the durable proposal.
 * ReputationItem, AutoProtectDecision, moderation and workflow rows are untouched here.
 */
export async function previewItemReanalysis(input: {
  tenantId: string;
  itemId: string;
  actorUserId: string;
  idempotencyKey: string;
}): Promise<PreviewItemReanalysisResult> {
  const begun = await beginReanalysisPreview(input);
  if (!begun.ok) return begun;
  if (begun.kind === "existing") {
    return { ok: true, preview: begun.preview, reused: true };
  }
  const { source, previewId } = begun;

  try {
    const cfg = await withTenant(input.tenantId, async (db) => {
      const [tenant, brand, rules, memoryRules, policies] = await Promise.all([
        db.tenant.findUnique({
          where: { id: input.tenantId },
          select: { plan: true, accessState: true, internalAccess: true },
        }),
        db.brand.findFirst({
          where: { id: source.item.brandId, tenantId: input.tenantId },
          select: { defaultLocale: true },
        }),
        db.brandRule.findMany({
          where: { brandId: source.item.brandId, tenantId: input.tenantId, enabled: true },
          select: { category: true, phrases: true, enabled: true },
        }),
        db.brandRiskMemoryRule.findMany({
          where: { brandId: source.item.brandId, tenantId: input.tenantId, isActive: true },
          select: {
            type: true,
            normalizedPhrase: true,
            language: true,
            severity: true,
            isActive: true,
          },
        }),
        db.brandAutoProtectPolicy.findMany({
          where: { brandId: source.item.brandId, tenantId: input.tenantId, isActive: true },
          select: { category: true, mode: true, minConfidence: true, isActive: true },
        }),
      ]);
      return {
        tenant,
        workspaceLocale: brand?.defaultLocale ?? "en",
        rules: rules.map((rule) => ({
          category: rule.category as unknown as ClassifierRule["category"],
          phrases: rule.phrases,
          enabled: rule.enabled,
        })),
        memoryRules,
        policies,
      };
    });

    const hybrid = await classifyWithUsagePolicy(
      {
        tenantId: input.tenantId,
        plan: cfg.tenant?.plan ?? "free",
        accessState: cfg.tenant?.accessState ?? "full_access",
        internalAccess: cfg.tenant?.internalAccess ?? false,
        reputationItemId: source.item.id,
        contentItemId: source.content.id,
        correlationId: `rean:${previewId}`,
        refresh: true,
      },
      {
        text: source.content.text,
        platform: source.item.platform as Platform,
        locale: source.content.authorLocale ?? undefined,
        rating: source.content.rating ?? undefined,
        rules: cfg.rules,
      },
      {
        workspaceLocale: cfg.workspaceLocale,
        translation: getTranslationConfig(),
        aiRisk: getAiRiskConfig(),
        memoryRules: cfg.memoryRules,
      },
    );

    const processedAt = new Date();

    // A failed paid-provider pass falls back to rules, but an operator must not confirm a run that the UI
    // would describe as a successful advanced verification. Keep the item untouched and surface failure.
    if (hybrid.processingStatus === "failed") {
      await abandonReanalysisPreview(input.tenantId, input.itemId, input.actorUserId, previewId);
      return { ok: false, reason: "provider_failure" };
    }

    const autoProtect = evaluateAutoProtect(
      {
        text: source.content.text,
        riskLevel: hybrid.level,
        categories: hybrid.categories,
        riskSignals: hybrid.explanation.riskSignals,
        matchedTerms: hybrid.explanation.matchedTerms,
        sentiment: hybrid.sentiment,
        confidence: hybrid.confidence,
        requiresReview: hybrid.requiresReview,
      },
      cfg.policies,
    );
    const intel = buildIntelFromHybrid(hybrid);
    const projection = persistedProjectionFieldsAfterClassification({
      riskLevel: hybrid.level,
      riskCategories: hybrid.categories,
      riskConfidence: hybrid.confidence,
      aiDiagnostics: hybrid.diagnostics,
      autoProtect: {
        decision: autoProtect.decision,
        matchedCategory: autoProtect.matchedCategory,
      },
    });

    const proposal: ReanalysisProposalV1 = {
      version: 1,
      processedAt: processedAt.toISOString(),
      classification: {
        riskLevel: hybrid.level,
        riskConfidence: hybrid.confidence,
        riskCategories: [...hybrid.categories],
        sentiment: hybrid.sentiment,
        riskRationale: hybrid.explanation.shortReason || hybrid.engine || null,
        riskEngine: hybrid.engine || null,
        assessedAt: processedAt.toISOString(),
      },
      intelligence: {
        detectedLanguage: intel.detectedLanguage ?? null,
        languageConfidence: intel.languageConfidence ?? null,
        isMixedLanguage: intel.isMixedLanguage,
        languageDetectionSource: intel.languageDetectionSource ?? null,
        translationStatus: intel.translationStatus,
        translationProvider: intel.translationProvider,
        translatedText: intel.translatedText ?? null,
        translatedToLocale: intel.translatedToLocale ?? null,
        classificationMode: intel.classificationMode,
        aiProvider: intel.aiProvider,
        aiProviderStatus: intel.aiProviderStatus,
        riskExplanation: hybrid.explanation,
        aiDiagnostics: hybrid.diagnostics,
      },
      processing: {
        processingTier: hybrid.processingTier,
        processingStatus: hybrid.processingStatus,
        processingReason: hybrid.processingReason ?? null,
        lastProcessedAt: processedAt.toISOString(),
        classifierVersion: CLASSIFIER_VERSION,
        contentHash: hybrid.contentHash,
      },
      projection: {
        customerClassificationState: projection.customerClassificationState,
        customerRiskLevel: projection.customerRiskLevel,
        customerRiskCategories: [...projection.customerRiskCategories],
        customerClassificationProjectionVersion:
          projection.customerClassificationProjectionVersion,
        customerRequiresReanalysis: projection.customerRequiresReanalysis,
      },
      priority: { proposed: priorityForRisk(hybrid.level) },
      autoProtect: {
        matchedCategory: autoProtect.matchedCategory,
        policyMode: autoProtect.policyMode,
        confidence: autoProtect.confidence,
        decision: autoProtect.decision,
        reason: autoProtect.reason ?? null,
      },
      providerCalls: hybrid.providerCalls.map((call) => ({
        type: call.type,
        provider: call.provider,
        status: call.status,
        latencyMs: call.latencyMs,
        errorCode: call.errorCode ?? null,
      })),
    };

    const completed = await completeReanalysisPreview({
      tenantId: input.tenantId,
      itemId: input.itemId,
      actorUserId: input.actorUserId,
      previewId,
      proposal,
      now: processedAt,
    });
    if (completed.ok) {
      return { ok: true, preview: completed.preview, reused: completed.reused };
    }
    await abandonReanalysisPreview(input.tenantId, input.itemId, input.actorUserId, previewId);
    return completed;
  } catch {
    await abandonReanalysisPreview(
      input.tenantId,
      input.itemId,
      input.actorUserId,
      previewId,
    ).catch(() => undefined);
    return { ok: false, reason: "provider_failure" };
  }
}
