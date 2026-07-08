/**
 * Lightweight, dependency-free language detection.
 *
 * Beta-safe heuristic: scores a few top languages (EN/SK/CS/DE/PL/HU) by
 * distinctive characters + stopwords, and falls back to `unknown` when nothing
 * is confident. Best-effort for other languages of the world — this is NOT a
 * production model and never claims perfect coverage. The original text is never
 * altered or lost.
 */

export type DetectedLanguage = "en" | "sk" | "cs" | "de" | "pl" | "hu" | "unknown";

export interface LanguageDetection {
  language: DetectedLanguage;
  confidence: number; // 0..1
  isMixed: boolean;
  source: "rules" | "unknown";
}

/** Distinctive characters + common stopwords per language. */
const SIGNALS: Record<Exclude<DetectedLanguage, "unknown">, { chars: RegExp; words: string[] }> = {
  en: { chars: /[a-z]/, words: ["the", "and", "you", "this", "service", "thanks", "scam", "buy", "don't", "is", "are", "not", "please", "great"] },
  sk: { chars: /[ľĺŕôäď]/, words: ["ďakujem", "služba", "otvorené", "veľmi", "prepáčte", "máte", "vy", "nie", "som", "hovno", "úplne", "sobotu"] },
  cs: { chars: /[řěů]/, words: ["zloději", "děkuji", "není", "prosím", "dobrý", "špatný", "vy", "podvod"] },
  de: { chars: /[ß]/, words: ["das", "ist", "und", "nicht", "betrug", "danke", "sie", "ein", "sehr", "der", "die", "kein"] },
  pl: { chars: /[łśżźćęą]/, words: ["oszustwo", "dziękuję", "jest", "nie ma", "że", "bardzo", "proszę"] },
  hu: { chars: /[őű]/, words: ["átverés", "köszönöm", "nagyon", "hogy", "van", "nem", "ez", "kérem"] },
};

function wordRe(w: string): RegExp {
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, "u");
}

/** Detect the dominant language of a short comment/review. */
export function detectLanguage(input: string): LanguageDetection {
  const text = input.toLowerCase();
  if (text.trim().length < 2) return { language: "unknown", confidence: 0, isMixed: false, source: "unknown" };

  const scores: Record<string, number> = {};
  for (const [lang, sig] of Object.entries(SIGNALS)) {
    let s = 0;
    for (const w of sig.words) if (wordRe(w).test(text)) s += 2;
    // Distinctive characters (skip the generic [a-z] EN base signal).
    if (lang !== "en") {
      const m = text.match(new RegExp(sig.chars, "gu"));
      if (m) s += Math.min(4, m.length);
    }
    scores[lang] = s;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLang, topScore] = ranked[0]!;

  if (topScore < 2) {
    // Nothing distinctive matched — do not guess. Keep it honest as unknown.
    return { language: "unknown", confidence: 0, isMixed: false, source: "unknown" };
  }

  const confidence = Math.min(0.95, 0.5 + topScore * 0.1);
  // Mixed when two or more languages each show a strong (>=2) signal.
  const isMixed = ranked.filter(([, s]) => s >= 2).length >= 2;
  return { language: topLang as DetectedLanguage, confidence: round2(confidence), isMixed, source: "rules" };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
