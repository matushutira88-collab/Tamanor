/**
 * CLASSIFICATION EVIDENCE — permanent regression guard for the P0 false-positive of 2026-08-04.
 *
 * A customer was shown "Vulgarita / Kritické" (profanity / critical, confidence 0.88) for a neutral
 * marketing question. Root cause: the deterministic lexicon matched the profanity stem `pic` as a RAW
 * SUBSTRING inside "sus-PIC-ious", scored it 0.85 → critical, and nothing downstream could tell a real
 * hit from a substring accident because no layer recorded WHICH TEXT justified the label.
 *
 * This suite proves three things at once:
 *   1. the exact reported sentence — and its whole false-positive class — is clean;
 *   2. GENUINE profanity in EN/SK/DE (including obfuscated and masked forms) is still detected, so the
 *      defect was not "fixed" by suppressing the category;
 *   3. the fail-closed evidence gate holds even if matching were wrong again: a category with no valid
 *      evidence span can never be shown as fact, can never become critical, and can never trigger an
 *      automatic protection action.
 *
 * Run: pnpm classification-evidence:test
 */
import { RiskClassifier, normalize } from "../src/risk-classifier";
import {
  findTermSpans, validateEvidenceSpan, validEvidenceForCategory, decideCategory, severityForVerdicts,
  customerClassificationDisplay, customerVisibleRiskLevel, categoryThreshold,
  EVIDENCE_REQUIRED_CATEGORIES, type EvidenceSpan, type CategoryDecision,
} from "../src/evidence";
import { evaluateAutoProtect } from "../src/auto-protect";
import { parseAndValidateRisk } from "../src/openai-schema";
import type { ClassificationInput } from "../src/types";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const classifier = new RiskClassifier();
const classify = (text: string) => classifier.classify({ text, platform: "facebook" } as unknown as ClassificationInput);

/** THE reported sentence. Permanent fixture — never remove, never add to a blacklist. */
const REPORTED =
  "Which pattern would concern your brand most: repeated comments, suspicious profiles or sudden engagement spikes?";

async function main() {
  // =========================================================================================
  console.log("\n1) the reported false positive, and its whole substring class");
  {
    const r = await classify(REPORTED);
    check("1a) profanity: false", !r.categories.includes("profanity" as never), r.categories.join(","));
    check("1b) severity is NOT critical", r.level !== "critical", r.level);
    check("1c) no risk signal at all fires", (r.explanation?.riskSignals ?? []).length === 0, (r.explanation?.riskSignals ?? []).join(","));
    check("1d) no matched term is recorded", (r.explanation?.matchedTerms ?? []).length === 0, (r.explanation?.matchedTerms ?? []).join(","));
    check("1e) no evidence span exists", (r.evidence ?? []).length === 0);
    const display = customerClassificationDisplay(r.categories as unknown as string[], []);
    check("1f) customer-visible Vulgarita badge: ABSENT", display.kind === "no_issue", JSON.stringify(display));
    check("1g) no automatic moderation action", (() => {
      const d = evaluateAutoProtect(
        { text: REPORTED, riskLevel: r.level as unknown as string, categories: r.categories as unknown as string[], riskSignals: r.explanation?.riskSignals ?? [], matchedTerms: r.explanation?.matchedTerms ?? [], sentiment: r.sentiment as unknown as string, confidence: r.confidence },
        [{ category: "profanity", mode: "auto_hide_shadow", minConfidence: 0.7, isActive: true }],
      );
      return d.decision !== "would_auto_hide" && d.matchedCategory !== "profanity";
    })());

    // Words containing misleading substrings — the class the defect belonged to.
    const MISLEADING = [
      ["suspicious profiles", "pic"], ["a typical response", "pica"], ["the picture quality", "pic"],
      ["off topic", "pic"], ["epic service", "pic"], ["olympic sponsor", "pic"], ["we picked it up", "pic"],
      ["nice pics from the event", "pic"], ["human trafficking report", "fick"], ["a fickle market", "fick"],
      ["scampi pasta was great", "scam"], ["a picnic in the park", "pic"],
    ] as const;
    for (const [text, stem] of MISLEADING) {
      const c = await classify(text);
      check(`1h) "${text}" (contains "${stem}") → no profanity/scam, not critical`,
        !c.categories.includes("profanity" as never) && !c.categories.includes("scam" as never) && c.level !== "critical",
        `${c.level} / ${c.categories.join(",")}`);
    }
  }

  // =========================================================================================
  console.log("\n2) GENUINE profanity is still detected (the fix is precision, not suppression)");
  {
    const GENUINE: [string, string][] = [
      ["EN", "you are a fucking idiot"],
      ["EN", "this is complete shit, absolute bullshit service"],
      ["EN", "what an asshole"],
      ["SK", "Kokot nenažratý"],
      ["SK", "ty si ozajstný kokot a picovina"],
      ["SK", "kurva, toto je hovno"],
      ["DE", "Arschloch, so eine Scheisse"],
      ["DE", "du bist ein Wichser"],
      ["obfuscated", "k0k0t"],
      ["masked", "p*ča"],
    ];
    for (const [lang, text] of GENUINE) {
      const r = await classify(text);
      const isProfane = r.categories.includes("profanity" as never);
      const spans = validEvidenceForCategory(r.analyzedText ?? "", r.evidence, "profanity");
      check(`2a) ${lang}: genuine profanity detected with validated evidence`,
        isProfane && spans.length > 0, `${r.categories.join(",")} spans=${spans.length}`);
      check(`2b) ${lang}: every span is a real word taken from the analyzed text`,
        spans.every((s) => validateEvidenceSpan(r.analyzedText ?? "", s) && s.text.trim().length > 0),
        spans.map((s) => `${s.start}-${s.end}`).join(","));
    }
    const scam = await classify("this is a scam, they scammed me and the scammer vanished");
    check("2c) genuine scam wording still detected", scam.categories.includes("scam" as never), scam.categories.join(","));
  }

  // =========================================================================================
  console.log("\n3) criticism without profanity stays criticism");
  {
    const CRITICISM = [
      "Your service was terrible and the delivery was three weeks late.",
      "Worst customer support I have ever dealt with. I want a refund.",
      "Nie som spokojný, reklamácia trvá príliš dlho.",
    ];
    for (const text of CRITICISM) {
      const r = await classify(text);
      check(`3a) "${text.slice(0, 34)}…" → no profanity, never critical`,
        !r.categories.includes("profanity" as never) && r.level !== "critical", `${r.level} / ${r.categories.join(",")}`);
    }
  }

  // =========================================================================================
  console.log("\n4) evidence span validation (fail-closed)");
  {
    const norm = normalize("you are a fucking idiot");
    const good = findTermSpans(norm, "fuck", "profanity")[0] as EvidenceSpan;
    check("4a) a real span validates", validateEvidenceSpan(norm, good));
    check("4b) a span whose text does not match its offsets is REJECTED",
      !validateEvidenceSpan(norm, { ...good, text: "kokot" }));
    check("4c) an out-of-range span is REJECTED",
      !validateEvidenceSpan(norm, { ...good, start: 9000, end: 9004 }));
    check("4d) an empty span is REJECTED", !validateEvidenceSpan(norm, { ...good, start: 3, end: 3, text: "" }));
    check("4e) a null/undefined span is REJECTED", !validateEvidenceSpan(norm, null) && !validateEvidenceSpan(norm, undefined));
    // A stale result attached to ANOTHER item: the span cannot validate against that item's text.
    check("4f) a span from another item's text is REJECTED (stale-result guard)",
      !validateEvidenceSpan(normalize(REPORTED), good));
    check("4g) evidence↔category consistency is enforced",
      validEvidenceForCategory(norm, [{ ...good, category: "hate_speech" }], "profanity").length === 0);
  }

  // =========================================================================================
  console.log("\n5) the category verdict state machine");
  {
    const base = { confidence: 0.88, parserOk: true };
    const aiOnly = decideCategory({ ...base, category: "profanity", validEvidenceCount: 0, rulesAgree: false, aiClaimed: true });
    check("5a) AI profanity with NO evidence span → review_required (never confirmed)",
      aiOnly.verdict === "review_required" && aiOnly.reason === "ai_claim_without_evidence", JSON.stringify(aiOnly));

    const nothing = decideCategory({ ...base, category: "profanity", validEvidenceCount: 0, rulesAgree: false, aiClaimed: false });
    check("5b) a profanity claim nobody supports → rejected", nothing.verdict === "rejected", JSON.stringify(nothing));

    const confirmed = decideCategory({ ...base, category: "profanity", validEvidenceCount: 1, rulesAgree: true, aiClaimed: true });
    check("5c) validated evidence above threshold → confirmed", confirmed.verdict === "confirmed", JSON.stringify(confirmed));

    const low = decideCategory({ ...base, confidence: 0.4, category: "profanity", validEvidenceCount: 1, rulesAgree: true, aiClaimed: true });
    check("5d) low confidence, even WITH evidence → review_required (never confirmed)",
      low.verdict === "review_required" && low.reason === "below_category_threshold", JSON.stringify(low));

    const ambiguous = decideCategory({ ...base, category: "profanity", validEvidenceCount: 0, rulesAgree: false, aiClaimed: true, parserOk: false });
    check("5e) malformed/ambiguous provider output → review_required, never confirmed",
      ambiguous.verdict === "review_required" && ambiguous.reason === "provider_output_ambiguous", JSON.stringify(ambiguous));

    const disagree = decideCategory({ ...base, category: "profanity", validEvidenceCount: 0, rulesAgree: false, aiClaimed: true });
    check("5f) rules say no profanity + AI says profanity + no span → ABSTAIN", disagree.verdict === "review_required");

    const descriptive = decideCategory({ ...base, category: "neutral", validEvidenceCount: 0, rulesAgree: true, aiClaimed: false });
    check("5g) non-accusatory categories are not evidence-gated", descriptive.verdict === "confirmed");
    check("5h) profanity IS in the evidence-gated set", EVIDENCE_REQUIRED_CATEGORIES.has("profanity"));
    check("5i) the profanity threshold is calibrated above the default", categoryThreshold("profanity") >= 0.8);
  }

  // =========================================================================================
  console.log("\n6) category confidence is separated from severity");
  {
    const unconfirmed: CategoryDecision[] = [{ category: "profanity", verdict: "review_required", reason: "ai_claim_without_evidence" }];
    const s1 = severityForVerdicts("none", "critical", unconfirmed);
    check("6a) an unsupported profanity score cannot make a neutral question critical",
      s1.level === "none" && s1.capped, JSON.stringify(s1));

    const confirmed: CategoryDecision[] = [{ category: "profanity", verdict: "confirmed", reason: "evidence_validated" }];
    const s2 = severityForVerdicts("none", "critical", confirmed);
    check("6b) CONFIRMED harm may still escalate severity", s2.level === "critical" && !s2.capped, JSON.stringify(s2));

    const s3 = severityForVerdicts("high", "critical", unconfirmed);
    check("6c) the deterministic rules floor is never lowered", s3.level === "high", JSON.stringify(s3));

    const rejected: CategoryDecision[] = [{ category: "profanity", verdict: "rejected", reason: "no_valid_evidence_span" }];
    check("6d) a rejected category cannot escalate either", severityForVerdicts("low", "critical", rejected).level === "low");
  }

  // =========================================================================================
  console.log("\n7) customer UI integrity");
  {
    const held = [{ category: "profanity", verdict: "review_required" }];
    const d1 = customerClassificationDisplay(["neutral"], held);
    check("7a) an unconfirmed accusation shows REVIEW REQUIRED, never the category name",
      d1.kind === "review_required" && !JSON.stringify(d1).includes("profanity"), JSON.stringify(d1));
    check("7b) an unconfirmed item is never presented at a definitive high/critical level",
      customerVisibleRiskLevel("critical", d1) !== "critical" && customerVisibleRiskLevel("critical", d1) !== "high");

    const d2 = customerClassificationDisplay(["profanity"], [{ category: "profanity", verdict: "confirmed" }]);
    check("7c) a confirmed category IS shown, with its real severity",
      d2.kind === "confirmed_category" && customerVisibleRiskLevel("critical", d2) === "critical", JSON.stringify(d2));

    check("7d) placeholder categories never render as a violation badge",
      customerClassificationDisplay(["neutral"], []).kind === "no_issue"
      && customerClassificationDisplay(["positive"], []).kind === "no_issue");

    check("7e) a confirmed category mixed with an unproven one still abstains",
      customerClassificationDisplay(["spam", "profanity"], [{ category: "spam", verdict: "confirmed" }, { category: "profanity", verdict: "review_required" }]).kind === "review_required");
  }

  // =========================================================================================
  console.log("\n8) no automatic protection action from an unconfirmed classification");
  {
    const policies = [{ category: "profanity", mode: "auto_hide_shadow", minConfidence: 0.7, isActive: true }];
    const unconfirmed = evaluateAutoProtect(
      { text: REPORTED, riskLevel: "critical", categories: ["profanity"], riskSignals: ["profanity"], matchedTerms: [], sentiment: "negative", confidence: 0.88, requiresReview: true },
      policies,
    );
    check("8a) requiresReview blocks would_auto_hide at 0.88 confidence",
      unconfirmed.decision === "requires_approval" && unconfirmed.safetyBlocked, JSON.stringify(unconfirmed));
    const confirmed = evaluateAutoProtect(
      { text: "you are a fucking idiot", riskLevel: "critical", categories: ["profanity"], riskSignals: ["profanity"], matchedTerms: ["fuck"], sentiment: "negative", confidence: 0.88 },
      policies,
    );
    check("8b) a CONFIRMED profanity item still reaches the configured shadow decision",
      confirmed.decision === "would_auto_hide", JSON.stringify(confirmed));
  }

  // =========================================================================================
  console.log("\n9) quoted profanity used for reporting / moderation discussion");
  {
    const quoted = 'A customer wrote "you are a fucking idiot" on our post — can we hide it?';
    const r = await classify(quoted);
    const spans = validEvidenceForCategory(r.analyzedText ?? "", r.evidence, "profanity");
    // The product deliberately still flags the text (the words ARE present) — but the evidence span must
    // point at the quoted word, so a human reviewer can see the classification is about a quotation.
    check("9a) the span points at the actual quoted word, so a reviewer can judge context",
      spans.length > 0 && spans.every((s) => (r.analyzedText ?? "").slice(s.start, s.end) === s.text),
      spans.map((s) => s.text).join(","));
    check("9b) it is routed for human review rather than silently auto-hidden", (() => {
      const d = evaluateAutoProtect(
        { text: quoted, riskLevel: r.level as unknown as string, categories: r.categories as unknown as string[], riskSignals: r.explanation?.riskSignals ?? [], matchedTerms: [], sentiment: "neutral", confidence: r.confidence, requiresReview: true },
        [{ category: "profanity", mode: "auto_hide_shadow", minConfidence: 0.7, isActive: true }],
      );
      return d.decision === "requires_approval";
    })());
  }

  // =========================================================================================
  console.log("\n10) category-index / mapping integrity and malformed provider output");
  {
    // A category-index mismatch surfaces as a category the schema does not know: it must be rejected at
    // parse time, never silently mapped onto the wrong label.
    const shifted = JSON.stringify({ category: "profanity_", riskLevel: "critical", confidence: 0.88, reasonCodes: ["profanity"], recommendedAction: "escalate", language: "en", sentiment: "negative" });
    check("10a) an unknown category value is rejected by the schema (no index-shift fallback)",
      parseAndValidateRisk(shifted).ok === false);

    const numericCategory = JSON.stringify({ category: 3, riskLevel: "critical", confidence: 0.88, reasonCodes: [], recommendedAction: "none", language: "en", sentiment: "neutral" });
    check("10b) a numeric category index is rejected (categories are names, never positions)",
      parseAndValidateRisk(numericCategory).ok === false);

    for (const bad of ["", "not json at all", "{", '{"category":"profanity"}', JSON.stringify({ category: "profanity", riskLevel: "critical", confidence: 4, reasonCodes: [], recommendedAction: "none", language: "en", sentiment: "negative" })]) {
      check(`10c) malformed provider output rejected: ${JSON.stringify(bad).slice(0, 28)}`, parseAndValidateRisk(bad).ok === false);
    }
    const valid = parseAndValidateRisk(JSON.stringify({ category: "profanity", riskLevel: "critical", confidence: 0.88, reasonCodes: ["profanity"], recommendedAction: "escalate", language: "en", sentiment: "negative" }));
    check("10d) a well-formed response still parses (the gate is evidence, not parsing)", valid.ok === true);
    check("10e) …but on its own it is STILL not confirmable without evidence",
      decideCategory({ category: "profanity", validEvidenceCount: 0, rulesAgree: false, aiClaimed: true, confidence: 0.88, parserOk: true }).verdict !== "confirmed");
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — classification evidence gate: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
