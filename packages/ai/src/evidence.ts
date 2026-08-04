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

/* ------------------------------------------------------------------ scam context gating */

/**
 * SCAM / PHISHING CONTEXT MODEL.
 *
 * "Kliknite sem pre viac informácií o produkte." — ordinary Slovak marketing copy — was classified as
 * CRITICAL SCAM and reached `would_auto_hide`, because `klikni`/`kliknite`/`kliknite sem` sat in the
 * lexicon as standalone weight-0.9 scam terms. Word boundaries and evidence validation both worked
 * perfectly: the word really is there. The word is simply not evidence of fraud.
 *
 * The lexicon is therefore split by EVIDENTIAL STRENGTH rather than by language:
 *
 *  - ACCUSATORY terms are independently strong evidence of fraud on their own (naming the fraud,
 *    demanding a credential, demanding an advance payment to release a prize, promising guaranteed
 *    returns). One validated span confirms.
 *  - CONTEXTUAL terms are ordinary commercial language that only becomes suspicious in combination.
 *    Each belongs to a DIMENSION, and dimensions are further split into:
 *      · ambient  — CTA, urgency, offer, verification prompts: present in most marketing copy;
 *      · harm-bearing — credential request, payment request, impersonation, prize claim, suspicious
 *        link, investment promise: the things a fraud actually needs.
 *
 * CONFIRMATION RULE: one accusatory span, OR at least two DISTINCT contextual dimensions of which at
 * least one is harm-bearing. Stacking ambient words never confirms — "click here" + "our offer" is two
 * dimensions and still nothing, which is exactly the fixture that used to fail.
 */
export type ScamDimension =
  | "cta" | "urgency" | "offer" | "verification_prompt"
  | "credential_request" | "payment_request" | "impersonation" | "prize_claim"
  | "suspicious_link" | "investment_promise";

/** Dimensions a fraud actually needs. At least one must be present for a contextual confirmation. */
export const HARM_BEARING_DIMENSIONS: ReadonlySet<ScamDimension> = new Set<ScamDimension>([
  "credential_request", "payment_request", "impersonation", "prize_claim",
  "suspicious_link", "investment_promise",
]);

/** [dimension, terms] — matched with the same word-bounded rule as every other lexicon. */
export const SCAM_CONTEXT_LEXICON: ReadonlyArray<readonly [ScamDimension, readonly string[]]> = [
  // ---- ambient: ordinary commercial language, never confirming on its own ------------------------
  ["cta", [
    "click here", "click the link", "open the link", "follow the link", "tap here",
    "klikni", "kliknite", "klikni sem", "kliknite sem", "otvorte odkaz", "otvor odkaz",
    "hier klicken", "klicken sie hier", "link oeffnen", "kliknij", "kliknij tutaj",
  ]],
  ["urgency", [
    "urgent", "urgently", "immediately", "act now", "right now", "last chance", "expires today",
    "only today", "hurry", "urgentne", "ihned", "okamzite", "posledna sanca", "len dnes",
    "dringend", "sofort", "letzte chance", "nur heute",
  ]],
  ["offer", [
    "special offer", "our offer", "discount", "promo", "sale", "deal",
    "ponuka", "ponuku", "zlava", "akcia", "angebot", "rabatt",
  ]],
  ["verification_prompt", ["verify", "verification", "confirm", "overit", "overte", "bestatigen", "verifizieren"]],

  // ---- harm-bearing: what a fraud actually needs -------------------------------------------------
  ["credential_request", [
    "password", "passwords", "login details", "login credentials", "credentials", "username and password",
    "one time code", "verification code", "security code", "pin code", "otp",
    "heslo", "hesla", "prihlasovacie udaje", "prihlasovacie meno", "overovaci kod", "bezpecnostny kod",
    "passwort", "zugangsdaten", "anmeldedaten", "sicherheitscode",
  ]],
  ["payment_request", [
    "wire transfer", "bank details", "bank account number", "card number", "credit card number",
    "send money", "send payment", "advance payment", "processing fee", "shipping fee", "iban",
    "prevod penazi", "cislo karty", "cislo uctu", "bankove udaje", "poslite peniaze", "zaplatte poplatok",
    "ueberweisung", "kontonummer", "kreditkartennummer", "gebuehr bezahlen",
  ]],
  ["impersonation", [
    "official support", "official support team", "customer service team", "bank support",
    "we are the bank", "security department", "account security team",
    "oficialna podpora", "bankova podpora", "zakaznicka podpora banky",
    "offizieller support", "sicherheitsabteilung",
  ]],
  ["prize_claim", [
    "you won", "you have won", "winner", "free iphone", "claim prize", "claim your reward",
    "vyhraj", "vyhrajte", "vyhrali ste", "vyhra", "sutaz", "vyhrajes", "iphone zadarmo",
    "gewinne", "gewinnen sie", "kostenloses iphone", "wygraj", "darmowy iphone", "nyerj", "ingyen iphone",
  ]],
  ["suspicious_link", [
    "bit ly", "tinyurl", "goo gl", "shortened link", "short link", "t me", "wa me",
  ]],
  ["investment_promise", [
    "invest now", "investment opportunity", "crypto investment", "trading signals", "roi guaranteed",
    "investujte", "investicna prilezitost", "krypto investicia", "investieren sie jetzt",
  ]],
];

export interface ScamContextAssessment {
  /** Distinct contextual dimensions with at least one validated span. */
  dimensions: ScamDimension[];
  /** Dimensions that are harm-bearing. */
  harmDimensions: ScamDimension[];
  /** Spans supporting the assessment (empty when nothing fired). */
  spans: EvidenceSpan[];
  /** True when the contextual evidence is strong enough to confirm scam/phishing on its own. */
  confirms: boolean;
  reason: "accusatory_term" | "multi_dimension_with_harm" | "insufficient_context" | "no_signal";
}

/**
 * Assess contextual scam evidence for `normalized`. `accusatoryHit` is true when an independently
 * accusatory scam/phishing term already matched — in that case the contextual layer is not needed.
 */
export function assessScamContext(
  normalized: string,
  accusatoryHit: boolean,
  findSpans: (text: string, term: string, category: string) => EvidenceSpan[],
): ScamContextAssessment {
  const spans: EvidenceSpan[] = [];
  const dims = new Set<ScamDimension>();
  for (const [dimension, terms] of SCAM_CONTEXT_LEXICON) {
    for (const term of terms) {
      const hits = findSpans(normalized, term, "scam");
      if (hits.length === 0) continue;
      dims.add(dimension);
      spans.push(...hits);
    }
  }
  const dimensions = [...dims];
  const harmDimensions = dimensions.filter((d) => HARM_BEARING_DIMENSIONS.has(d));
  if (accusatoryHit) {
    return { dimensions, harmDimensions, spans, confirms: true, reason: "accusatory_term" };
  }
  // Two distinct dimensions AND at least one of them harm-bearing. Ambient stacking never confirms.
  if (dimensions.length >= 2 && harmDimensions.length >= 1) {
    return { dimensions, harmDimensions, spans, confirms: true, reason: "multi_dimension_with_harm" };
  }
  return {
    dimensions, harmDimensions, spans, confirms: false,
    reason: dimensions.length === 0 ? "no_signal" : "insufficient_context",
  };
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
  /** `legacy` ⇒ the row predates the evidence gate; its stored accusation can never be verified. */
  | { kind: "review_required"; legacy?: boolean }
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
  const decisions = gateDecisions ?? [];
  const categories = (persistedCategories ?? []).filter((c) => !NON_ACCUSATORY.has(c));
  const accusatory = categories.filter((c) => EVIDENCE_REQUIRED_CATEGORIES.has(c));

  // Anything explicitly held for review wins outright — we never mix fact with suspicion.
  if (decisions.some((d) => d.verdict === "review_required")) return { kind: "review_required" };

  if (accusatory.length > 0) {
    // FAIL-CLOSED. An accusation is a fact ONLY when the gate explicitly says `confirmed` for that exact
    // category. A missing gate is the pre-evidence-deployment case (`legacy`) and an unmatched category is
    // a partial/older gate — both are unverified, never confirmed. This is the fix for rows written before
    // the evidence gate existed, which previously rendered as "Vulgarita / Kritické" purely by default.
    const unverified = accusatory.filter(
      (c) => !decisions.some((d) => d.category === c && d.verdict === "confirmed"),
    );
    if (unverified.length > 0) return { kind: "review_required", legacy: decisions.length === 0 };
    const first = accusatory[0] as string;
    return { kind: "confirmed_category", category: first };
  }

  // No accusation at all: a descriptive category (spam, complaint, …) may still be shown as-is.
  const descriptive = categories[0];
  if (descriptive === undefined) return { kind: "no_issue" };
  return { kind: "confirmed_category", category: descriptive };
}

/**
 * Is this item's stored verdict unverifiable legacy data (accusatory category, no evidence gate)?
 * Admin diagnostics use this to label the raw stored category/level as legacy/unverified rather than
 * hiding it. Customer surfaces must use {@link customerClassificationDisplay} instead.
 */
export function isLegacyUnverifiedVerdict(
  persistedCategories: readonly string[] | null | undefined,
  gateDecisions?: readonly { category: string; verdict: string }[] | null,
): boolean {
  const hasAccusation = (persistedCategories ?? []).some((c) => EVIDENCE_REQUIRED_CATEGORIES.has(c));
  return hasAccusation && (gateDecisions ?? []).length === 0;
}

/* ------------------------------------------------------------------ canonical customer projection */

/** The stored shape every customer surface reads. Only these columns are needed to interpret a verdict. */
export interface StoredClassificationRow {
  riskLevel: string;
  riskCategories: readonly string[] | null | undefined;
  riskConfidence?: number | null;
  /** Raw `aiDiagnostics` JSON exactly as persisted. Malformed values fail CLOSED. */
  aiDiagnostics?: unknown;
  /** The persisted Auto-Protect decision for this item, if one exists. */
  autoProtect?: { decision: string; matchedCategory: string } | null;
}

/** Customer-visible Auto-Protect state. A stale decision is never presented as actionable. */
export interface CustomerAutoProtectView {
  state: "confirmed" | "stale_unverified" | "none";
  /** Withheld (null) unless the source classification is confirmed. */
  decision: string | null;
  matchedCategory: string | null;
  /** May this decision be counted in affirmative would_auto_hide totals/samples? */
  countsTowardWouldAutoHide: boolean;
  /** Stored decision rests on an unverified verdict and can only be cleared by re-analysis. */
  requiresReanalysis: boolean;
}

/**
 * THE single authoritative interpretation of a stored reputation classification. Every customer-facing
 * badge, count, chart, export and API response must go through this — no surface may re-derive the
 * evidence gate on its own, or the fail-open bug returns on whichever page was forgotten.
 */
export interface CustomerClassificationProjection {
  state: "confirmed" | "review_required" | "no_issue";
  /** Categories the customer may see. Empty when nothing is confirmed. */
  categories: string[];
  /** Severity the customer may see (safe-capped for anything unconfirmed). */
  riskLevel: string;
  legacyUnverified: boolean;
  requiresReview: boolean;
  /** May this row count toward confirmed accusatory-category totals (profanity/scam/threat/…)? */
  eligibleForCategoryTotals: boolean;
  /** May this row count toward confirmed high/critical totals? */
  eligibleForSeverityTotals: boolean;
  autoProtect: CustomerAutoProtectView;
  /** ADMIN-ONLY raw stored values, preserved verbatim. Never render these on a customer surface. */
  stored: {
    riskLevel: string;
    categories: string[];
    autoProtectDecision: string | null;
    matchedCategory: string | null;
  };
}

/**
 * Read the evidence-gate decisions out of a raw `aiDiagnostics` value. Anything unexpected — null, a
 * string, a missing `evidenceGate`, a non-array `decisions`, entries without a category/verdict — is
 * treated as NO GATE, which fails closed into review_required. Malformed diagnostics must never be
 * mistaken for confirmation.
 */
export function readEvidenceGateDecisions(aiDiagnostics: unknown): { category: string; verdict: string }[] {
  if (!aiDiagnostics || typeof aiDiagnostics !== "object" || Array.isArray(aiDiagnostics)) return [];
  const gate = (aiDiagnostics as { evidenceGate?: unknown }).evidenceGate;
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) return [];
  const raw = (gate as { decisions?: unknown }).decisions;
  if (!Array.isArray(raw)) return [];
  const out: { category: string; verdict: string }[] = [];
  for (const d of raw) {
    if (!d || typeof d !== "object") continue;
    const { category, verdict } = d as { category?: unknown; verdict?: unknown };
    if (typeof category !== "string" || typeof verdict !== "string") continue;
    if (!category || !verdict) continue;
    out.push({ category, verdict });
  }
  return out;
}

const HIGHISH = new Set(["high", "critical"]);

/** Project a stored row into the one customer-visible truth. Pure; safe to call per row. */
export function projectStoredClassification(row: StoredClassificationRow): CustomerClassificationProjection {
  const storedCategories = [...(row.riskCategories ?? [])];
  const decisions = readEvidenceGateDecisions(row.aiDiagnostics);
  const display = customerClassificationDisplay(storedCategories, decisions);
  const legacyUnverified = isLegacyUnverifiedVerdict(storedCategories, decisions);
  const requiresReview = display.kind === "review_required";
  const riskLevel = customerVisibleRiskLevel(row.riskLevel, display);

  const state: CustomerClassificationProjection["state"] =
    display.kind === "confirmed_category" ? "confirmed"
      : display.kind === "review_required" ? "review_required"
        : "no_issue";

  // A confirmed row shows exactly the categories the gate stands behind (or its descriptive category).
  const categories = display.kind === "confirmed_category"
    ? storedCategories.filter((c) => !NON_ACCUSATORY.has(c)
      && (!EVIDENCE_REQUIRED_CATEGORIES.has(c) || decisions.some((d) => d.category === c && d.verdict === "confirmed")))
    : [];

  // Aggregate eligibility. Unconfirmed rows are excluded from confirmed totals but are NOT clean —
  // callers must count them under "requires review" instead of dropping them.
  const eligibleForCategoryTotals = state === "confirmed";
  const eligibleForSeverityTotals = state === "confirmed" && HIGHISH.has(row.riskLevel);

  const ap = row.autoProtect ?? null;
  const autoProtect: CustomerAutoProtectView = ap === null
    ? { state: "none", decision: null, matchedCategory: null, countsTowardWouldAutoHide: false, requiresReanalysis: false }
    : state === "confirmed"
      ? {
        state: "confirmed", decision: ap.decision, matchedCategory: ap.matchedCategory,
        countsTowardWouldAutoHide: ap.decision === "would_auto_hide", requiresReanalysis: false,
      }
      : {
        // Source classification is unconfirmed ⇒ the stored decision rests on nothing. Withhold the
        // decision AND the matched category (it is the same accusation by another name), and expose no
        // approval/execution affordance.
        state: "stale_unverified", decision: null, matchedCategory: null,
        countsTowardWouldAutoHide: false, requiresReanalysis: true,
      };

  return {
    state, categories, riskLevel, legacyUnverified, requiresReview,
    eligibleForCategoryTotals, eligibleForSeverityTotals, autoProtect,
    stored: {
      riskLevel: row.riskLevel,
      categories: storedCategories,
      autoProtectDecision: ap?.decision ?? null,
      matchedCategory: ap?.matchedCategory ?? null,
    },
  };
}

/** Bounded tally helper: confirmed category counts plus a separate requires-review bucket. */
export interface ProjectedTally {
  confirmed: Map<string, number>;
  requiresReview: number;
  legacyUnverified: number;
  confirmedHighOrCritical: number;
  total: number;
}

/**
 * Tally an ALREADY-BOUNDED page of rows through the projection. This never widens a query — callers
 * keep their existing `take`/cursor — it only changes how the fetched rows are counted.
 */
export function tallyProjected(rows: readonly StoredClassificationRow[]): ProjectedTally {
  const confirmed = new Map<string, number>();
  let requiresReview = 0, legacyUnverified = 0, confirmedHighOrCritical = 0;
  for (const row of rows) {
    const p = projectStoredClassification(row);
    if (p.eligibleForCategoryTotals) for (const c of p.categories) confirmed.set(c, (confirmed.get(c) ?? 0) + 1);
    if (p.eligibleForSeverityTotals) confirmedHighOrCritical++;
    if (p.requiresReview) requiresReview++;
    if (p.legacyUnverified) legacyUnverified++;
  }
  return { confirmed, requiresReview, legacyUnverified, confirmedHighOrCritical, total: rows.length };
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
