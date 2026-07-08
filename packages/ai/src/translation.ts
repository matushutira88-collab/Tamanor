/**
 * Translation abstraction. No provider is wired yet — this only decides the
 * translation STATUS honestly. It never fabricates a translation: if there is no
 * provider, status is `unavailable` and the original text is always preserved.
 */

export type TranslationStatus = "not_needed" | "translated" | "unavailable" | "failed";

export interface TranslationResult {
  status: TranslationStatus;
  provider: string; // "none" until a real provider is configured
  translatedText: string | null;
  translatedToLocale: string | null;
}

export interface TranslationConfig {
  enabled: boolean;
  provider: string; // "none" | future provider name
}

/**
 * Decide the translation outcome for a comment.
 * - Same language as the workspace → not_needed.
 * - Different language + no provider → unavailable (never faked).
 * - A real provider would produce `translated` / `failed`; not implemented yet.
 */
export function resolveTranslation(input: {
  detectedLanguage: string;
  workspaceLocale: string;
  config: TranslationConfig;
}): TranslationResult {
  const { detectedLanguage, workspaceLocale, config } = input;

  const sameLanguage =
    detectedLanguage !== "unknown" &&
    detectedLanguage.slice(0, 2) === workspaceLocale.slice(0, 2);
  if (sameLanguage) {
    return { status: "not_needed", provider: "none", translatedText: null, translatedToLocale: null };
  }

  if (!config.enabled || config.provider === "none") {
    return { status: "unavailable", provider: "none", translatedText: null, translatedToLocale: workspaceLocale };
  }

  // A configured provider would translate here. Until one is wired, stay honest.
  return { status: "unavailable", provider: config.provider, translatedText: null, translatedToLocale: workspaceLocale };
}

/**
 * Map a classification result + workspace locale into the persisted multilingual
 * intelligence fields (language detection + translation status + explanation).
 * Plain data — the caller spreads it into the ReputationItem create/update.
 */
export function buildReputationIntel(
  risk: {
    detectedLanguage?: string;
    languageConfidence?: number;
    isMixedLanguage?: boolean;
    languageDetectionSource?: string;
    explanation?: unknown;
  },
  workspaceLocale: string,
  config: TranslationConfig,
) {
  const detectedLanguage = risk.detectedLanguage ?? "unknown";
  const tr = resolveTranslation({ detectedLanguage, workspaceLocale, config });
  return {
    detectedLanguage,
    languageConfidence: risk.languageConfidence ?? null,
    isMixedLanguage: risk.isMixedLanguage ?? false,
    languageDetectionSource: risk.languageDetectionSource ?? "unknown",
    translationStatus: tr.status,
    translationProvider: tr.provider,
    translatedText: tr.translatedText,
    translatedToLocale: tr.translatedToLocale,
    // Dynamic JSON column — cast to satisfy Prisma's InputJsonValue at call sites.
    riskExplanation: (risk.explanation ?? undefined) as never,
  };
}
