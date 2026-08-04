/**
 * EVIDENCE — the fail-closed basis for every customer-visible classification label.
 *
 * WHY THIS EXISTS. A customer was shown "Vulgarita / Kritické" (profanity / critical, confidence 0.88)
 * for the sentence "Which pattern would concern your brand most: repeated comments, suspicious profiles
 * or sudden engagement spikes?" — a neutral marketing question with no profanity in it. The label came
 * from a RAW SUBSTRING match: the profanity stem `pic` occurs inside "sus-PIC-ious". Nothing downstream
 * could tell a real hit from a substring accident, because no layer ever recorded WHICH TEXT justified
 * the label. A score alone is not evidence.
 *
 * Two independent guarantees live here:
 *
 *  1. MATCHING PRECISION — a lexicon term only matches at a word boundary, and only with a known
 *     inflection suffix. `pic` no longer matches "suspicious", "picture", "picked", "topic", "epic" or
 *     "olympic"; `pica` no longer matches "typical"; `fick` no longer matches "trafficking"; `scam` no
 *     longer matches "scampi". Genuine (and obfuscated/masked) profanity still matches — see the
 *     regression suite.
 *
 *  2. EVIDENCE — every match carries the exact span of the analyzed text that justifies it, and that
 *     span is re-validated against the original normalized text before anything is shown to a customer.
 *     A sensitive label with no valid span is never presented as fact.
 *
 * This module is pure: no I/O, no network, no clock, no randomness.
 */

/**
 * The exact stretch of ANALYZED (normalized) text that justifies one category claim.
 * `text` must always equal `normalized.slice(start, end)` — that is what makes it verifiable.
 */
export interface EvidenceSpan {
  /** Risk/control category this span supports (e.g. "profanity"). */
  category: string;
  /** The lexicon term that produced the match. */
  term: string;
  /** Offsets into the NORMALIZED text (not the raw text). */
  start: number;
  end: number;
  /** The matched token, taken verbatim from the normalized text. */
  text: string;
}

/**
 * Categories that make a definitive accusation about a person's words. A customer may only be shown one
 * of these as a CONFIRMED fact when a validated evidence span exists. Everything else (spam, complaint,
 * neutral, positive, …) is descriptive rather than accusatory and is not evidence-gated.
 */
export const EVIDENCE_REQUIRED_CATEGORIES: ReadonlySet<string> = new Set([
  "profanity", "hate_speech", "racism", "harassment", "personal_attack",
  "threat", "violence", "terrorism_extremism", "sexual_vulgarity", "scam", "phishing",
]);

/**
 * Per-category confidence floor for a CONFIRMED customer-visible label. Deliberately separate from any
 * severity threshold: clearing this bar makes a label showable, never critical (see `severityForVerdicts`).
 */
export const CATEGORY_CONFIDENCE_THRESHOLD: Readonly<Record<string, number>> = {
  profanity: 0.8, hate_speech: 0.85, racism: 0.85, harassment: 0.8, personal_attack: 0.8,
  threat: 0.85, violence: 0.85, terrorism_extremism: 0.9, sexual_vulgarity: 0.85,
  scam: 0.8, phishing: 0.8,
};
export const DEFAULT_CATEGORY_THRESHOLD = 0.7;

export function categoryThreshold(category: string): number {
  return CATEGORY_CONFIDENCE_THRESHOLD[category] ?? DEFAULT_CATEGORY_THRESHOLD;
}

/* ------------------------------------------------------------------ matching */

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[a-z0-9*]/.test(c);

/**
 * Inflection suffixes allowed after a full lexicon term (SK/CZ/EN/DE). A CLOSED list: anything else means
 * the term is merely a prefix of an unrelated word, not an inflected form of it.
 * `le` is absent on purpose — it is what separates German "fick(en)" from English "fickle".
 */
const TERM_SUFFIXES: ReadonlySet<string> = new Set([
  "", "s", "es", "y", "ies", "ed", "d", "ing", "er", "ers", "ty",
  "a", "u", "e", "o", "i", "om", "ou", "ov", "ami", "och", "mi", "ach",
  "at", "al", "ala", "ali", "am", "as", "em", "eme", "ete", "aj", "ajte",
  "en", "et", "st", "t", "te", "n", "ne", "ny", "na", "no", "nu", "ka", "ko", "ku",
]);

/**
 * Stems are deliberately aggressive fragments (they exist to catch masked variants such as `jeb***`), so
 * they get a STRICTER, purely inflectional suffix set — no English plural/gerund endings, which is what
 * turns `pic` into "pics"/"picked"/"picture" false positives.
 */
const STEM_SUFFIXES: ReadonlySet<string> = new Set([
  "", "a", "u", "e", "o", "y", "i", "om", "ou", "ov", "ami", "och", "mi",
  "at", "al", "ala", "ali", "am", "as", "em", "eme", "ete", "aj", "ajte",
  "ovina", "ovinu", "ovine", "ka", "ko", "ku", "ne", "ny", "na", "no", "nut",
]);

/**
 * Known-safe words that would otherwise survive the boundary + suffix rules. Defence in depth, NOT the
 * mechanism: the boundary rule already removes the entire "suspicious/typical/trafficking" class. Keep
 * this list tiny and justified — it must never grow into "the sentence that broke production".
 */
const SAFE_WORDS: ReadonlySet<string> = new Set(["fickle", "fickles", "scampi", "picnic", "picnics"]);

/** Character-level compare that honours `*` in the HAYSTACK as a single-character wildcard (masked text). */
function tokenMatchesAt(hay: string, term: string, i: number): boolean {
  for (let j = 0; j < term.length; j++) {
    const c = hay[i + j];
    if (c !== term[j] && c !== "*") return false;
  }
  return true;
}

export interface MatchOptions {
  /** Treat `term` as an aggressive stem (stricter suffix set). */
  stem?: boolean;
}

/**
 * Locate every place `term` legitimately occurs in `normalized`, returning a verifiable span per hit.
 *
 * Rules, in order:
 *   - multi-word terms match as a whole phrase between word boundaries;
 *   - a single-word term must start at a word boundary (this is what kills "sus|pic|ious");
 *   - the rest of that token must be an allowed inflection suffix (this is what kills "pic|ked");
 *   - the resulting token must not be a known-safe word.
 * The span always covers the WHOLE token, so the evidence shown to a reviewer is a real word.
 */
export function findTermSpans(
  normalized: string,
  term: string,
  category: string,
  opts: MatchOptions = {},
): EvidenceSpan[] {
  const spans: EvidenceSpan[] = [];
  if (!term || !normalized) return spans;
  const suffixes = opts.stem ? STEM_SUFFIXES : TERM_SUFFIXES;
  const multiWord = term.includes(" ");

  for (let i = 0; i + term.length <= normalized.length; i++) {
    if (!tokenMatchesAt(normalized, term, i)) continue;
    if (isWordChar(normalized[i - 1])) continue;                 // must start a word

    if (multiWord) {
      // A phrase must also END on a boundary — "click here" must not match "click herexyz".
      if (isWordChar(normalized[i + term.length])) continue;
      const text = normalized.slice(i, i + term.length);
      spans.push({ category, term, start: i, end: i + term.length, text });
      continue;
    }

    // Single word: take the whole token and check what follows the term inside it.
    let end = i;
    while (end < normalized.length && isWordChar(normalized[end])) end++;
    const token = normalized.slice(i, end);
    const suffix = token.slice(term.length);
    if (!suffixes.has(suffix)) continue;
    if (SAFE_WORDS.has(token)) continue;
    spans.push({ category, term, start: i, end, text: token });
  }
  return spans;
}

/**
 * Re-validate a span against the text that was actually analyzed. Fails closed on ANY mismatch: out of
 * range, empty, or text that does not match the offsets (which is exactly what a stale span attached to
 * another item, or a fabricated model span, looks like).
 */
export function validateEvidenceSpan(normalized: string, span: EvidenceSpan | null | undefined): boolean {
  if (!span) return false;
  if (typeof span.start !== "number" || typeof span.end !== "number") return false;
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end)) return false;
  if (span.start < 0 || span.end > normalized.length || span.end <= span.start) return false;
  if (typeof span.text !== "string" || span.text.length === 0) return false;
  if (typeof span.category !== "string" || span.category.length === 0) return false;
  return normalized.slice(span.start, span.end) === span.text;
}

/** Spans that both validate against the text AND belong to `category` (evidence↔category consistency). */
export function validEvidenceForCategory(
  normalized: string,
  spans: readonly EvidenceSpan[] | undefined,
  category: string,
): EvidenceSpan[] {
  return (spans ?? []).filter((s) => s.category === category && validateEvidenceSpan(normalized, s));
}

/* ------------------------------------------------------------------ verdicts */

/**
 * The three states a category claim can be in. `confirmed` is the only one a customer may see as fact;
 * `review_required` reuses the product's existing "needs review" language; `rejected` is admin-only
 * diagnostics.
 */
export type CategoryVerdict = "confirmed" | "review_required" | "rejected";

export interface CategoryDecisionInput {
  category: string;
  /** Number of spans that validated against the analyzed text for THIS category. */
  validEvidenceCount: number;
  /** Did the deterministic rule engine independently reach this category? */
  rulesAgree: boolean;
  /** Did the AI claim this category? */
  aiClaimed: boolean;
  confidence: number;
  /** False when the provider output failed schema/parse validation (ambiguity ⇒ never confirm). */
  parserOk: boolean;
}

export interface CategoryDecision {
  category: string;
  verdict: CategoryVerdict;
  /** Stable machine reason — safe to log and to show in admin diagnostics. */
  reason: string;
}

/**
 * Decide what a single category claim is worth.
 *
 * The fail-closed core: for an accusatory category, a validated evidence span is MANDATORY. Confidence
 * can only ever downgrade a claim, never substitute for evidence. Rule/AI disagreement without evidence
 * abstains (`review_required`) instead of confirming.
 */
export function decideCategory(input: CategoryDecisionInput): CategoryDecision {
  const { category, validEvidenceCount, rulesAgree, aiClaimed, confidence, parserOk } = input;
  const gated = EVIDENCE_REQUIRED_CATEGORIES.has(category);

  if (!gated) {
    // Descriptive categories (neutral, positive, spam, complaint, …) are not accusations.
    return { category, verdict: "confirmed", reason: "not_evidence_gated" };
  }
  // Any parser/schema ambiguity anywhere in the AI response ⇒ never confirm an accusation from it.
  if (!parserOk && !rulesAgree) return { category, verdict: "review_required", reason: "provider_output_ambiguous" };

  if (validEvidenceCount === 0) {
    // THE DEFECT CLASS: a category asserted with no text to point at.
    if (aiClaimed && !rulesAgree) return { category, verdict: "review_required", reason: "ai_claim_without_evidence" };
    return { category, verdict: "rejected", reason: "no_valid_evidence_span" };
  }
  if (confidence < categoryThreshold(category)) {
    return { category, verdict: "review_required", reason: "below_category_threshold" };
  }
  return { category, verdict: "confirmed", reason: "evidence_validated" };
}

/**
 * Severity is derived from CONFIRMED harm only — never from a category score.
 *
 * A merged risk level may be raised to high/critical only when at least one evidence-gated category was
 * confirmed. An unconfirmed accusation cannot make a neutral marketing question critical; it produces a
 * review request instead. `baseLevel` (the deterministic rules floor) is never lowered.
 */
const RISK_ORDER = ["none", "low", "medium", "high", "critical"] as const;
const rank = (l: string): number => Math.max(0, RISK_ORDER.indexOf(l as (typeof RISK_ORDER)[number]));

/* ------------------------------------------------------------------ customer-facing presentation */

/** Categories that describe rather than accuse — never rendered as a violation badge. */
const NON_ACCUSATORY: ReadonlySet<string> = new Set(["neutral", "positive"]);

/**
 * What a customer may be shown for one item.
 *  - `confirmed_category` — an accusation backed by validated evidence; show the category label.
 *  - `review_required`    — the AI suspected something it could not substantiate; show a review prompt,
 *                           NEVER the category name and never a definitive severity.
 *  - `no_issue`           — nothing to assert.
 */
export type CustomerClassificationDisplay =
  | { kind: "confirmed_category"; category: string }
  | { kind: "review_required" }
  | { kind: "no_issue" };

/**
 * The single place the customer-visible verdict is decided, so no surface can accidentally render an
 * unsupported label. `persistedCategories` are already evidence-gated by the pipeline; `gateDecisions`
 * (from admin diagnostics, when present) tells us whether something was held back for review.
 *
 * Fail-closed: if ANY category is still awaiting review, the item is presented as review_required even
 * if another category was confirmed — we never mix "confirmed fact" with "unproven accusation".
 */
export function customerClassificationDisplay(
  persistedCategories: readonly string[] | null | undefined,
  gateDecisions?: readonly { category: string; verdict: string }[] | null,
): CustomerClassificationDisplay {
  const held = (gateDecisions ?? []).some((d) => d.verdict === "review_required");
  if (held) return { kind: "review_required" };
  const accusatory = (persistedCategories ?? []).filter((c) => !NON_ACCUSATORY.has(c));
  const first = accusatory[0];
  if (first === undefined) return { kind: "no_issue" };
  return { kind: "confirmed_category", category: first };
}

/** Severity a customer may be shown. An unconfirmed item is never presented at a definitive level. */
export function customerVisibleRiskLevel(level: string, display: CustomerClassificationDisplay): string {
  if (display.kind === "confirmed_category") return level;
  // Nothing is confirmed — never assert high/critical to a customer.
  return rank(level) >= rank("high") ? "medium" : level;
}

export function severityForVerdicts(
  baseLevel: string,
  proposedLevel: string,
  decisions: readonly CategoryDecision[],
): { level: string; capped: boolean; reason: string } {
  const confirmedAccusation = decisions.some(
    (d) => d.verdict === "confirmed" && EVIDENCE_REQUIRED_CATEGORIES.has(d.category),
  );
  if (rank(proposedLevel) <= rank(baseLevel)) {
    return { level: baseLevel, capped: false, reason: "no_escalation_proposed" };
  }
  if (confirmedAccusation) {
    return { level: proposedLevel, capped: false, reason: "confirmed_harm" };
  }
  // Escalation proposed, nothing confirmed it: hold at the rules floor, but never above "medium".
  const held = rank(baseLevel) > rank("medium") ? baseLevel : baseLevel;
  return { level: held, capped: true, reason: "escalation_without_confirmed_evidence" };
}
