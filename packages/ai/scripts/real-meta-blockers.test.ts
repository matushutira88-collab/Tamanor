/**
 * Real Meta test blockers (V1.21A). Run via: pnpm realmeta:test
 * Verifies the exact comments the tester reported: spam/phishing prize-bait and a
 * profanity/personal-attack insult now classify correctly AND reach would_auto_hide
 * under a shadow policy, while normal criticism is never auto-hidden. No platform
 * action is ever taken.
 */
import { classifyHybrid } from "../src/pipeline";
import { evaluateAutoProtect, DEFAULT_AUTO_PROTECT_POLICIES, type AutoProtectPolicy } from "../src/auto-protect";
import { Platform } from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const hot = (l: string) => ["high", "critical"].includes(l);
const cfg = { workspaceLocale: "sk", translation: { enabled: false, provider: "none", targetMode: "workspace_locale" as const }, aiRisk: { enabled: false, provider: "none", minConfidence: 0.7 } };
const policies: AutoProtectPolicy[] = DEFAULT_AUTO_PROTECT_POLICIES.map((p) => ({ category: p.category, mode: p.mode, minConfidence: 0.7, isActive: true }));

async function evalText(text: string) {
  const h = await classifyHybrid({ text, platform: Platform.FacebookPage }, cfg);
  const ap = evaluateAutoProtect({ text, riskLevel: h.level, categories: h.categories, riskSignals: h.explanation.riskSignals, matchedTerms: h.explanation.matchedTerms, sentiment: h.sentiment, confidence: h.confidence }, policies);
  return { h, ap };
}

async function run() {
  // Default policies: clearly-harmful categories are auto_hide_shadow.
  const mode = (c: string) => DEFAULT_AUTO_PROTECT_POLICIES.find((p) => p.category === c)?.mode;
  check("default profanity policy = auto_hide_shadow", mode("profanity") === "auto_hide_shadow");
  check("default personal_attack policy = auto_hide_shadow", mode("personal_attack") === "auto_hide_shadow");
  check("default spam policy = auto_hide_shadow", mode("spam") === "auto_hide_shadow");
  check("default normal_criticism policy = monitor", mode("normal_criticism") === "monitor");

  // 1/2) "klikni a vyhraj iPhone" → high/critical + scam/phishing/spam + approval + would_auto_hide.
  {
    const { h, ap } = await evalText("klikni a vyhraj iPhone");
    check("'klikni a vyhraj iPhone' → high/critical", hot(h.level), h.level);
    check("'klikni a vyhraj iPhone' → confidence >= 0.8", h.confidence >= 0.8, String(h.confidence));
    check("'klikni a vyhraj iPhone' → approvalRequired", h.approvalRequired);
    check("'klikni a vyhraj iPhone' → category scam/phishing/spam", ["scam", "phishing", "spam"].includes(ap.matchedCategory), ap.matchedCategory);
    check("'klikni a vyhraj iPhone' → would_auto_hide", ap.decision === "would_auto_hide", ap.decision);
  }

  // 3/4) "nenažratý kokot" → high/critical + profanity/personal_attack + matched terms + would_auto_hide.
  {
    const { h, ap } = await evalText("nenažratý kokot");
    check("'nenažratý kokot' → high/critical", hot(h.level), h.level);
    check("'nenažratý kokot' → approvalRequired", h.approvalRequired);
    check("'nenažratý kokot' → matched terms include kokot + nenazraty", h.explanation.matchedTerms.includes("kokot") && h.explanation.matchedTerms.includes("nenazraty"), h.explanation.matchedTerms.join(","));
    check("'nenažratý kokot' → category profanity/personal_attack", ["profanity", "personal_attack"].includes(ap.matchedCategory), ap.matchedCategory);
    check("'nenažratý kokot' → would_auto_hide", ap.decision === "would_auto_hide", ap.decision);
  }
  // reversed order "Kokot nenažratý" too.
  {
    const { ap } = await evalText("Kokot nenažratý");
    check("'Kokot nenažratý' → would_auto_hide", ap.decision === "would_auto_hide", ap.decision);
  }

  // 5) normal criticism → monitor, never auto-hide.
  {
    const { h, ap } = await evalText("Tovar mi prišiel neskoro, som nespokojný.");
    check("normal criticism → not high/critical", !hot(h.level), h.level);
    check("normal criticism → normal_criticism category", ap.matchedCategory === "normal_criticism", ap.matchedCategory);
    check("normal criticism → never would_auto_hide", ap.decision !== "would_auto_hide", ap.decision);
  }

  // 8) low-confidence shadow still downgrades to approval (safety preserved).
  {
    const lowConf = evaluateAutoProtect({ text: "x", riskLevel: "medium", categories: [], riskSignals: ["profanity"], matchedTerms: [], sentiment: "negative", confidence: 0.5 }, policies);
    check("low-confidence profanity shadow → requires_approval (downgrade)", lowConf.decision === "requires_approval", lowConf.decision);
  }

  // No execution field anywhere (live actions = 0 by construction).
  {
    const { ap } = await evalText("klikni a vyhraj iPhone");
    check("Auto-Protect result has no execution field", !("executed" in (ap as Record<string, unknown>)) && !("hidden" in (ap as Record<string, unknown>)));
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — real Meta test blockers`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
