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
  RecommendedReviewAction,
  RiskEngine,
} from "./types";
import { detectLanguage } from "./language-detect";
import { findTermSpans, assessScamContext, type EvidenceSpan } from "./evidence";

/**
 * RiskClassifier — deterministic Risk Rules V1 (+ placeholder heuristic).
 *
 * A dependency-free, model-free classifier so the whole system (worker, inbox,
 * rules, audit) runs end-to-end WITHOUT any network calls. Risk Rules V1 adds
 * multilingual profanity/abuse/scam/threat lexicons (SK/CZ/EN/DE) with text
 * normalization (diacritics + basic obfuscation) so real-world insults are
 * caught before an AI model is ever involved.
 *
 * It never performs platform actions and makes NO network calls. Swap in a
 * model-backed engine behind the same {@link RiskEngine} interface later.
 */
export class RiskClassifier implements RiskEngine {
  readonly name = "risk-rules-v1";

  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const norm = normalize(input.text);

    const categories = new Set<RiskCategory>();
    const matchedTerms = new Set<string>();
    let score = 0;
    let deterministic = false;

    // Lexicon rules (multilingual, obfuscation-tolerant). Every hit must produce a VERIFIABLE span of
    // the analyzed text — a term that cannot point at a real word does not count as a match at all.
    const evidence: EvidenceSpan[] = [];
    for (const [category, weight, terms, isStem] of LEXICON) {
      let fired = false;
      for (const t of terms) {
        const spans = findTermSpans(norm, t, category, { stem: isStem === true });
        if (spans.length === 0) continue;
        evidence.push(...spans);
        matchedTerms.add(t.trim());
        fired = true;
      }
      if (fired) {
        categories.add(category);
        score = Math.max(score, weight);
        deterministic = true;
      }
    }

    // Contextual scam gating. An accusatory term above already confirms; otherwise scam is only
    // confirmed by TWO distinct contextual dimensions including a harm-bearing one. A lone CTA
    // ("kliknite sem"), a lone urgency word or a CTA stacked with an offer confirms nothing.
    const scamContext = assessScamContext(norm, categories.has(RiskCategory.Scam), findTermSpans);
    if (scamContext.confirms && scamContext.reason === "multi_dimension_with_harm") {
      categories.add(RiskCategory.Scam);
      evidence.push(...scamContext.spans);
      for (const s of scamContext.spans) matchedTerms.add(s.term);
      score = Math.max(score, 0.9);
      deterministic = true;
    }

    // Positive signals only count when nothing negative fired.
    const hasNegative = [...categories].some((c) => NEGATIVE_CATEGORIES.has(c));
    let positiveHit = false;
    if (!hasNegative && POSITIVE_TERMS.some((t) => containsFuzzy(norm, t))) {
      positiveHit = true;
    }

    // Low review ratings lean negative/complaint.
    if (typeof input.rating === "number" && input.rating <= 2) {
      categories.add(RiskCategory.Complaint);
      score = Math.max(score, 0.45);
    }

    // Brand rules: phrase matches map onto risk categories/score.
    const matchedRules = matchBrandRules(norm, input.rules);
    for (const match of matchedRules) {
      const { category, weight } = RULE_CATEGORY_EFFECT[match.category];
      if (category) categories.add(category);
      score = Math.max(score, weight);
      deterministic = true;
    }

    const sentiment = deriveSentiment(categories, input.rating, positiveHit);
    if (categories.size === 0) {
      categories.add(
        sentiment === Sentiment.Positive ? RiskCategory.Positive : RiskCategory.Neutral,
      );
    }

    const level = scoreToLevel(score);
    const lang = detectLanguage(input.text);
    const riskSignals = [...categories].filter((c) => c !== RiskCategory.Positive && c !== RiskCategory.Neutral);

    const result: ClassificationResult = {
      level,
      confidence: round2(confidenceFor(score, deterministic)),
      categories: [...categories],
      sentiment,
      rationale: buildRationale(deterministic, matchedRules.length),
      engine: this.name,
      detectedLanguage: lang.language,
      languageConfidence: lang.confidence,
      isMixedLanguage: lang.isMixed,
      languageDetectionSource: lang.source,
      /** The exact normalized text every rule verdict was computed against — spans index into THIS. */
      analyzedText: norm,
      evidence,
      explanation: {
        matchedTerms: [...matchedTerms],
        matchedRules: matchedRules.map((m) => m.phrase),
        riskSignals: riskSignals as unknown as string[],
        recommendedReviewAction: recommendedAction(level),
      },
    };
    if (matchedRules.length > 0) result.matchedRules = matchedRules;
    return result;
  }
}

/* ------------------------------------------------------------------ matching */

/**
 * Normalize text for matching: lowercase, strip diacritics, fold common leet /
 * obfuscation substitutions. `*` is preserved as a single-char wildcard so
 * masked insults (e.g. `p*ca`) still match. Other punctuation → spaces.
 */
export function normalize(input: string): string {
  const lower = input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const leet = lower
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/@/g, "a")
    .replace(/\$/g, "s");
  // Keep letters, digits (rare leftovers), spaces and the `*` wildcard.
  return leet.replace(/[^a-z0-9*\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Substring match where a `*` in `hay` acts as a single-character wildcard. */
export function containsFuzzy(hay: string, needle: string): boolean {
  if (hay.includes(needle)) return true;
  if (!hay.includes("*")) return false;
  const n = needle.length;
  for (let i = 0; i + n <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      const c = hay[i + j];
      if (c !== needle[j] && c !== "*") { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * [category, severity 0..1, normalized trigger terms, isStem?].
 * Terms MUST be diacritics-free/lowercase (matched against normalize()).
 *
 * MATCHING IS WORD-BOUNDED, not substring-based: see `findTermSpans` in ./evidence. Marking a row as a
 * STEM opts it into the stricter, purely inflectional suffix set — that is what stops `pic` from firing
 * on "suspicious", "picture", "picked", "topic", "epic" and "olympic" while still catching "pica"/"picu".
 * Irregular forms (doubled consonants, compounds) are listed explicitly rather than guessed at.
 */
const LEXICON: ReadonlyArray<readonly [RiskCategory, number, readonly string[], boolean?]> = [
  // Strong vulgarity (SK/CZ/EN/DE) → critical.
  [RiskCategory.Profanity, 0.9, [
    "kokot", "pica", "kurva", "kurv", "hovno", "skurveny", "chuj", "curak", "sracka",
    "mrdka", "jebat", "vyjebany", "zmrd", "ojeb", "kokotina",
    "fuck", "fucker", "motherfucker", "shit", "bitch", "asshole", "cunt",
    "scheisse", "arschloch", "hurensohn", "wichser", "fick",
  ]],
  // Short profanity stems (catch masked variants like jeb***). STEM = strict suffixes only.
  [RiskCategory.Profanity, 0.85, ["jeb", "pic"], true],
  // Personal insults / harassment → high.
  [RiskCategory.Harassment, 0.8, [
    "kreten", "idiot", "debil", "hajzel", "svina", "sprostak", "magor",
    "nenazraty", "hovado", "vul ", "blbec", "trkvas",
    "moron", "loser", "stupid", "dumb", "shut up", "you are idiots", "scumbag",
    "blodmann", "spinner", "vollidiot", "trottel", "hulye", "barom", "glupek",
  ]],
  // Hate speech / racism / extremism markers → critical.
  [RiskCategory.HateSpeech, 0.9, [
    "hateful", "disgusting people", "nenavid",
    "go back to your country", "your race", "subhuman", "racial slur",
    "plant a bomb", "jihad", "heil hitler", "terror attack",
  ]],
  // Threats / violence (no dedicated enum) → map to Harassment, critical.
  [RiskCategory.Harassment, 0.92, [
    "zabijem", "zabit ta", "i will kill", "kill you", "vyhrazam",
    "ublizim", "umresh", "toch dich", "i will hurt", "burn your store", "beat you up",
  ]],
  // Scam / fraud / phishing → critical. ACCUSATORY TERMS ONLY: each of these is independently strong
  // evidence of fraud. Ordinary call-to-action, urgency, offer, prize and payment wording is NOT here —
  // it lives in SCAM_CONTEXT_LEXICON and can only confirm in combination (see assessScamContext).
  // "kliknite sem" is marketing copy, not a crime.
  [RiskCategory.Scam, 0.9, [
    // Naming the fraud itself.
    "podvod", "podvodnik", "scam", "scammer", "scammed", "fraud", "fraudulent",
    "betrug", "betrueger", "oszustwo", "oszust", "atveres", "csalas", "csalo",
    // Explicit credential theft.
    "verify your account", "confirm your password", "reset your password", "send your password",
    "confirm your login details", "zadajte heslo", "poslite heslo", "posli heslo",
    "bestatigen sie ihr passwort", "geben sie ihr passwort ein",
    // Explicit payment/prize fraud.
    "free money", "crypto giveaway", "claim prize", "claim your prize", "click here to claim",
    "click here to win", "advance fee", "pay to claim", "zaplatte za vyhru",
    // Explicit investment fraud.
    "guaranteed returns", "guaranteed profit", "double your money", "garantovany vynos",
    "garantovany zisk", "garantierte rendite",
  ]],
  // Spam → high.
  [RiskCategory.Spam, 0.7, [
    "buy now", "promo code", "subscribe to my", "check my profile",
    "kup teraz", "zlava len dnes", "jetzt kaufen",
  ]],
  // Legal threats → high.
  [RiskCategory.LegalThreat, 0.85, [
    "lawsuit", "sue you", "my lawyer", "legal action", "pravnik", "zalujem", "anwalt",
  ]],
  // Thief / dishonesty → scam-adjacent, high.
  [RiskCategory.Scam, 0.75, ["zlodej", "thief", "dieb", "okradli"]],
  // Complaint / dishonesty claims → medium.
  [RiskCategory.Complaint, 0.5, [
    "klamar", "klamete", "liar", "luegner", "terrible", "worst", "refund",
    "scammed me", "never again", "reklamacia", "otrasne",
  ]],
];

const POSITIVE_TERMS: readonly string[] = [
  "super", "dakujem", "vyborne", "skvele", "najlepsi", "odporucam",
  "great", "thanks", "thank you", "love it", "perfect", "amazing", "excellent",
  "danke", "toll", "super service",
];

const NEGATIVE_CATEGORIES = new Set<RiskCategory>([
  RiskCategory.Scam,
  RiskCategory.Spam,
  RiskCategory.LegalThreat,
  RiskCategory.Harassment,
  RiskCategory.Profanity,
  RiskCategory.HateSpeech,
  RiskCategory.Complaint,
  RiskCategory.BrandAttack,
]);

/** How each brand-rule category influences the risk assessment. */
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
  normText: string,
  rules: ClassifierRule[] | undefined,
): MatchedRule[] {
  if (!rules?.length) return [];
  const matches: MatchedRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const phrase of rule.phrases) {
      const needle = normalize(phrase);
      if (needle.length > 0 && containsFuzzy(normText, needle)) {
        matches.push({ category: rule.category, phrase });
      }
    }
  }
  return matches;
}

function deriveSentiment(
  categories: ReadonlySet<RiskCategory>,
  rating: number | undefined,
  positiveHit: boolean,
): Sentiment {
  if (typeof rating === "number") {
    if (rating >= 4) return Sentiment.Positive;
    if (rating <= 2) return Sentiment.Negative;
  }
  if ([...categories].some((c) => NEGATIVE_CATEGORIES.has(c))) return Sentiment.Negative;
  if (positiveHit || categories.has(RiskCategory.Positive)) return Sentiment.Positive;
  return Sentiment.Neutral;
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 0.85) return RiskLevel.Critical;
  if (score >= 0.65) return RiskLevel.High;
  if (score >= 0.4) return RiskLevel.Medium;
  if (score > 0) return RiskLevel.Low;
  return RiskLevel.None;
}

/**
 * Deterministic lexicon/brand-rule matches carry higher confidence (0.75–0.90)
 * than the soft heuristic fallback (capped low). No auto-actions depend on this
 * — moderation execution is disabled regardless.
 */
function confidenceFor(score: number, deterministic: boolean): number {
  if (deterministic) return Math.min(0.9, 0.75 + score * 0.15);
  return Math.min(0.6, 0.3 + score * 0.3);
}

function buildRationale(deterministic: boolean, ruleMatches: number): string {
  if (deterministic) {
    const suffix = ruleMatches > 0 ? ` + ${ruleMatches} brand-rule match(es)` : "";
    return `Risk Rules V1: deterministic lexicon match${suffix}. Human review recommended; no platform action taken.`;
  }
  return "Risk Rules V1: no deterministic match; heuristic classification only.";
}

function recommendedAction(level: RiskLevel): RecommendedReviewAction {
  if (level === RiskLevel.Critical) return "escalate";
  if (level === RiskLevel.High) return "review";
  if (level === RiskLevel.Medium) return "monitor";
  return "none";
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
