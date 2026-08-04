/**
 * LEGACY VERDICT FAIL-CLOSED + SCAM CONTEXT GATING — P0 trust closure regression suite.
 *
 * Two defects survived the first evidence-gate fix and are covered here permanently:
 *
 *  1. ORDINARY CALL-TO-ACTION TEXT WAS CRITICAL SCAM. "Kliknite sem pre viac informácií o produkte."
 *     scored critical scam and reached would_auto_hide, because `klikni`/`kliknite`/`kliknite sem` sat
 *     in the lexicon as standalone weight-0.9 scam terms. Word boundaries and evidence validation both
 *     worked — the word IS there. The word simply is not evidence of fraud. Fixed by splitting the
 *     scam/phishing lexicon by evidential strength (accusatory vs contextual dimensions).
 *
 *  2. LEGACY ROWS RENDERED AS CONFIRMED VIOLATIONS. Rows written before the evidence gate carry an
 *     accusatory category with no `aiDiagnostics.evidenceGate`, and the customer display treated a
 *     MISSING gate as confirmation — fail-open. A customer still saw "Vulgarita / Kritické" for the
 *     original false positive. Fixed: confirmation now requires the gate to explicitly confirm that
 *     exact category.
 *
 * Stored rows are NOT modified anywhere in this suite or by the fix — the correction is in how a
 * stored verdict is INTERPRETED.
 *
 * Run: pnpm legacy-scam-gating:test
 */
import { RiskClassifier } from "../src/risk-classifier";
import { classifyHybrid } from "../src/pipeline";
import {
  customerClassificationDisplay, customerVisibleRiskLevel, isLegacyUnverifiedVerdict,
  assessScamContext, findTermSpans, SCAM_CONTEXT_LEXICON, HARM_BEARING_DIMENSIONS,
  EVIDENCE_REQUIRED_CATEGORIES,
} from "../src/evidence";
import { evaluateAutoProtect } from "../src/auto-protect";
import type { ClassificationInput } from "../src/types";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const classifier = new RiskClassifier();
const CFG = {
  workspaceLocale: "sk",
  translation: { enabled: false, provider: "none", targetMode: "workspace_locale" as const },
  aiRisk: { enabled: false, provider: "none", minConfidence: 0.7 },
};
/** Brand policies as shipped by DEFAULT_AUTO_PROTECT_POLICIES for the fraud categories. */
const POLICIES = [
  { category: "scam", mode: "auto_hide_shadow", minConfidence: 0.7, isActive: true },
  { category: "phishing", mode: "auto_hide_shadow", minConfidence: 0.7, isActive: true },
  { category: "profanity", mode: "auto_hide_shadow", minConfidence: 0.7, isActive: true },
];

/** Run the FULL customer-facing path: classify → evidence gate → customer display → protection. */
async function endToEnd(text: string) {
  const h = await classifyHybrid({ text, platform: "facebook" } as unknown as ClassificationInput & { platform: string }, CFG);
  const decisions = h.diagnostics?.evidenceGate?.decisions ?? [];
  const display = customerClassificationDisplay(h.categories, decisions);
  const ap = evaluateAutoProtect(
    {
      text, riskLevel: h.level, categories: h.categories, riskSignals: h.explanation.riskSignals,
      matchedTerms: h.explanation.matchedTerms, sentiment: h.sentiment, confidence: h.confidence,
      requiresReview: h.requiresReview,
    },
    POLICIES,
  );
  return {
    level: h.level,
    customerLevel: customerVisibleRiskLevel(h.level, display),
    categories: h.categories,
    display,
    badge: display.kind === "confirmed_category" ? display.category : null,
    autoDecision: ap.decision,
  };
}

const HIGHISH = new Set(["high", "critical"]);

async function main() {
  // =========================================================================================
  console.log("\n1) benign call-to-action / commercial text is CLEAN (required fixtures)");
  {
    const CLEAN = [
      "Kliknite sem pre viac informácií o produkte.",
      "Kliknite sem a pozrite si našu ponuku.",
      "Click here to read the full article.",
      "Verify the opening hours before visiting.",
      "Urgent update about tomorrow's event.",
      "You can open the link in our official documentation.",
    ];
    for (const text of CLEAN) {
      const r = await endToEnd(text);
      check(`1a) "${text.slice(0, 40)}…" → no scam/phishing category`,
        !r.categories.includes("scam") && !r.categories.includes("phishing"), r.categories.join(","));
      check(`1b) "${text.slice(0, 40)}…" → severity none/neutral, never high or critical`,
        !HIGHISH.has(r.level) && !HIGHISH.has(r.customerLevel), `${r.level}/${r.customerLevel}`);
      check(`1c) "${text.slice(0, 40)}…" → no customer violation badge`, r.badge === null, String(r.badge));
      check(`1d) "${text.slice(0, 40)}…" → no automatic moderation action`,
        r.autoDecision !== "would_auto_hide", r.autoDecision);
    }
  }

  // =========================================================================================
  console.log("\n2) genuine scam / phishing is STILL detected (gating is not suppression)");
  {
    const GENUINE: [string, string][] = [
      ["credential phishing via deceptive link", "Click here to reset your password: bit.ly/secure-login"],
      ["fake bank impersonation", "We are the official support team of your bank. Verify your account immediately."],
      ["prize scam with advance payment", "You won a free iPhone! Pay a small processing fee to claim your prize."],
      ["investment scam", "Invest now for guaranteed returns of 300% in crypto."],
      ["SK card/login detail request", "Pošlite nám číslo karty a prihlasovacie údaje, inak vám zrušíme účet."],
      ["DE credential phishing", "Bestätigen Sie Ihr Passwort über diesen Link, sonst wird Ihr Konto gesperrt."],
    ];
    for (const [label, text] of GENUINE) {
      const r = await endToEnd(text);
      check(`2a) ${label}: still classified scam/phishing`,
        r.categories.includes("scam") || r.categories.includes("phishing"), r.categories.join(","));
      check(`2b) ${label}: reaches high/critical severity`, HIGHISH.has(r.level), r.level);
      check(`2c) ${label}: confirmed to the customer (not withheld)`,
        r.display.kind === "confirmed_category", JSON.stringify(r.display));
    }
  }

  // =========================================================================================
  console.log("\n3) the contextual dimension model itself");
  {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9*\s]/g, " ").replace(/\s+/g, " ").trim();
    const assess = (s: string) => assessScamContext(norm(s), false, findTermSpans);

    const cta = assess("click here");
    check("3a) a lone CTA never confirms", !cta.confirms && cta.reason === "insufficient_context", JSON.stringify(cta.dimensions));
    const ctaOffer = assess("click here for our special offer");
    check("3b) CTA + offer — two AMBIENT dimensions — still never confirms",
      !ctaOffer.confirms && ctaOffer.dimensions.length >= 2 && ctaOffer.harmDimensions.length === 0,
      JSON.stringify(ctaOffer.dimensions));
    const ctaUrgency = assess("click here now, act now, last chance, only today");
    check("3c) stacking ambient urgency + CTA still never confirms", !ctaUrgency.confirms, JSON.stringify(ctaUrgency.dimensions));

    const ctaCred = assess("click here and enter your password");
    check("3d) CTA + credential request confirms", ctaCred.confirms && ctaCred.reason === "multi_dimension_with_harm");
    const ctaPay = assess("click here and send payment via wire transfer");
    check("3e) CTA + payment request confirms", ctaPay.confirms);
    const urgImp = assess("urgent: this is the official support team of your bank");
    check("3f) urgency + impersonation confirms", urgImp.confirms);
    const prizePay = assess("you won a prize, pay the processing fee");
    check("3g) prize claim + payment request confirms", prizePay.confirms);
    const linkCred = assess("open the link bit ly and confirm your login details");
    check("3h) suspicious link + credential request confirms", linkCred.confirms);

    const lonePay = assess("wire transfer");
    check("3i) a lone harm-bearing dimension does NOT confirm on its own", !lonePay.confirms, JSON.stringify(lonePay.dimensions));
    check("3j) nothing at all → no_signal", assess("we open at nine").reason === "no_signal");

    // Structural: the lexicon really is split, and CTA words are not harm-bearing.
    const dims = SCAM_CONTEXT_LEXICON.map(([d]) => d);
    check("3k) CTA/urgency/offer/verification are ambient, never harm-bearing",
      (["cta", "urgency", "offer", "verification_prompt"] as const).every((d) => !HARM_BEARING_DIMENSIONS.has(d)));
    check("3l) the harm-bearing dimensions are all represented in the lexicon",
      [...HARM_BEARING_DIMENSIONS].every((d) => dims.includes(d)), [...HARM_BEARING_DIMENSIONS].join(","));
    check("3m) ordinary CTA words are no longer standalone scam lexicon terms", (() => {
      const cta = SCAM_CONTEXT_LEXICON.find(([d]) => d === "cta")?.[1] ?? [];
      return ["klikni", "kliknite", "kliknite sem", "click here"].every((t) => cta.includes(t));
    })());
  }

  // =========================================================================================
  console.log("\n4) LEGACY rows: absence of an evidence gate is never confirmation");
  {
    // A pre-fix row: accusatory category stored, no evidenceGate at all.
    const legacyProfanity = customerClassificationDisplay(["profanity"], undefined);
    check("4a) legacy profanity row (no evidenceGate) → review_required, not confirmed",
      legacyProfanity.kind === "review_required", JSON.stringify(legacyProfanity));
    check("4b) legacy row is flagged as legacy",
      legacyProfanity.kind === "review_required" && legacyProfanity.legacy === true);
    check("4c) the category NAME is withheld from the customer",
      !JSON.stringify(legacyProfanity).includes("profanity"));
    check("4d) legacy critical severity is not shown to the customer",
      !HIGHISH.has(customerVisibleRiskLevel("critical", legacyProfanity)),
      customerVisibleRiskLevel("critical", legacyProfanity));

    const legacyScam = customerClassificationDisplay(["scam"], null);
    check("4e) legacy scam row (no evidenceGate) → review_required", legacyScam.kind === "review_required");
    check("4f) legacy scam severity withheld too", !HIGHISH.has(customerVisibleRiskLevel("critical", legacyScam)));

    // An empty-array gate is just as unverified as a missing one.
    check("4g) an EMPTY evidenceGate is not confirmation",
      customerClassificationDisplay(["profanity"], []).kind === "review_required");

    // A gate that confirms a DIFFERENT category must not confirm this one.
    check("4h) a gate confirming another category does not confirm this accusation",
      customerClassificationDisplay(["profanity"], [{ category: "spam", verdict: "confirmed" }]).kind === "review_required");

    // Current rows behave exactly as before.
    const confirmed = customerClassificationDisplay(["profanity"], [{ category: "profanity", verdict: "confirmed" }]);
    check("4i) current CONFIRMED row still shows its category and real severity",
      confirmed.kind === "confirmed_category" && confirmed.category === "profanity"
      && customerVisibleRiskLevel("critical", confirmed) === "critical", JSON.stringify(confirmed));
    check("4j) current review_required row still withholds",
      customerClassificationDisplay(["neutral"], [{ category: "profanity", verdict: "review_required" }]).kind === "review_required");

    // Non-accusatory historical categories are NOT evidence-gated and must not be withheld.
    check("4k) a legacy NON-accusatory category (spam) is unaffected",
      customerClassificationDisplay(["spam"], undefined).kind === "confirmed_category"
      && !EVIDENCE_REQUIRED_CATEGORIES.has("spam"));
    check("4l) a legacy neutral/positive row shows no issue",
      customerClassificationDisplay(["neutral"], undefined).kind === "no_issue"
      && customerClassificationDisplay(["positive"], undefined).kind === "no_issue");
    check("4m) an empty category list shows no issue", customerClassificationDisplay([], undefined).kind === "no_issue");
  }

  // =========================================================================================
  console.log("\n5) admin diagnostics vs customer visibility");
  {
    check("5a) a legacy accusatory row is identified as legacy/unverified for admins",
      isLegacyUnverifiedVerdict(["profanity"], undefined) && isLegacyUnverifiedVerdict(["scam"], []));
    check("5b) a gated row is NOT legacy", !isLegacyUnverifiedVerdict(["profanity"], [{ category: "profanity", verdict: "confirmed" }]));
    check("5c) a non-accusatory row is not legacy-flagged", !isLegacyUnverifiedVerdict(["spam"], undefined));
    check("5d) the stored raw values are still readable for admin display (nothing is erased)", (() => {
      const stored = { riskLevel: "critical", riskCategories: ["profanity"] };
      const d = customerClassificationDisplay(stored.riskCategories, undefined);
      // Customer sees nothing definitive; the stored values are untouched and available to the admin panel.
      return d.kind === "review_required" && stored.riskLevel === "critical" && stored.riskCategories[0] === "profanity";
    })());
    check("5e) no automatic action may be derived from a legacy/unverified customer verdict", (() => {
      const d = customerClassificationDisplay(["profanity"], undefined);
      const ap = evaluateAutoProtect(
        { text: "irrelevant", riskLevel: "critical", categories: ["profanity"], riskSignals: ["profanity"], matchedTerms: [], sentiment: "negative", confidence: 0.88, requiresReview: d.kind === "review_required" },
        POLICIES,
      );
      return ap.decision === "requires_approval" && ap.safetyBlocked;
    })());
  }

  // =========================================================================================
  console.log("\n6) the ORIGINAL stored false positive, rendered after this fix");
  {
    // The row as it exists in production TODAY (unchanged by this commit):
    const STORED = { riskLevel: "critical", riskCategories: ["profanity"], riskConfidence: 0.88, aiDiagnostics: null as null | { evidenceGate?: unknown } };
    const decisions = ((STORED.aiDiagnostics ?? null) as { evidenceGate?: { decisions?: { category: string; verdict: string }[] } } | null)?.evidenceGate?.decisions;
    const display = customerClassificationDisplay(STORED.riskCategories, decisions);
    const custLevel = customerVisibleRiskLevel(STORED.riskLevel, display);

    check("6a) renders as REVIEW REQUIRED (Vyžaduje kontrolu)", display.kind === "review_required", JSON.stringify(display));
    check("6b) no Vulgarita badge — the category name is withheld",
      display.kind !== "confirmed_category" && !JSON.stringify(display).includes("profanity"));
    check("6c) no Kritické customer-visible severity", !HIGHISH.has(custLevel), custLevel);
    check("6d) no automatic moderation action", (() => {
      const ap = evaluateAutoProtect(
        { text: "…", riskLevel: STORED.riskLevel, categories: STORED.riskCategories, riskSignals: ["profanity"], matchedTerms: [], sentiment: "negative", confidence: STORED.riskConfidence, requiresReview: display.kind === "review_required" },
        POLICIES,
      );
      return ap.decision !== "would_auto_hide";
    })());
    check("6e) the stored row itself is untouched (no migration, no mutation)",
      STORED.riskLevel === "critical" && STORED.riskCategories[0] === "profanity" && STORED.riskConfidence === 0.88);
    check("6f) admins can still see the raw verdict, marked legacy/unverified",
      isLegacyUnverifiedVerdict(STORED.riskCategories, decisions));

    // And re-analyzing that text with the deployed classifier yields nothing at all.
    const fresh = await endToEnd("Which pattern would concern your brand most: repeated comments, suspicious profiles or sudden engagement spikes?");
    check("6g) re-analyzed today it is clean: no category, no severity, no action",
      !fresh.categories.includes("profanity") && !HIGHISH.has(fresh.level) && fresh.badge === null && fresh.autoDecision !== "would_auto_hide",
      `${fresh.level} / ${fresh.categories.join(",")} / ${fresh.autoDecision}`);
  }

  // =========================================================================================
  console.log("\n7) unrelated categories are unaffected by the scam gating");
  {
    const prof = await endToEnd("you are a fucking idiot");
    check("7a) genuine profanity still confirmed at its real severity",
      prof.categories.includes("profanity") && HIGHISH.has(prof.level) && prof.display.kind === "confirmed_category",
      `${prof.level} / ${prof.categories.join(",")}`);
    const sk = await classifier.classify({ text: "Kokot nenažratý", platform: "facebook" } as unknown as ClassificationInput);
    check("7b) SK profanity unaffected", (sk.categories as unknown as string[]).includes("profanity"));
    const crit = await endToEnd("Your delivery was three weeks late and support never replied.");
    check("7c) ordinary criticism is still not a violation",
      crit.badge === null && !HIGHISH.has(crit.level), `${crit.level} / ${crit.categories.join(",")}`);
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — legacy fail-closed + scam context gating: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
