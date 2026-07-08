/**
 * Auto-Protect engine tests. Run via: pnpm autoprotect:test
 * Covers policy modes, the shadow-mode "would_auto_hide" decision, the safety
 * floor (criticism never auto-hidden), confidence downgrade, competitor promo vs
 * comparison, disabled policies, and the guarantee of no platform action.
 */
import { evaluateAutoProtect, type AutoProtectPolicy } from "../src/auto-protect";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const pol = (category: string, mode: string, over: Partial<AutoProtectPolicy> = {}): AutoProtectPolicy =>
  ({ category, mode, minConfidence: 0.7, isActive: true, ...over });
const base = { text: "", riskLevel: "high", categories: [] as string[], riskSignals: [] as string[], matchedTerms: [] as string[], sentiment: "negative", confidence: 0.9 };

function run() {
  // 1) profanity approval → requires_approval.
  {
    const r = evaluateAutoProtect({ ...base, riskSignals: ["profanity"] }, [pol("profanity", "approval")]);
    check("profanity approval → requires_approval", r.decision === "requires_approval" && r.matchedCategory === "profanity", r.decision);
  }
  // 2) hate_speech shadow → would_auto_hide.
  {
    const r = evaluateAutoProtect({ ...base, riskSignals: ["hate_speech"] }, [pol("hate_speech", "auto_hide_shadow")]);
    check("hate_speech shadow → would_auto_hide", r.decision === "would_auto_hide", r.decision);
  }
  // 3) racism (term) shadow → would_auto_hide.
  {
    const r = evaluateAutoProtect({ ...base, text: "go back to your country" }, [pol("racism", "auto_hide_shadow")]);
    check("racism shadow → would_auto_hide", r.decision === "would_auto_hide" && r.matchedCategory === "racism", `${r.decision}/${r.matchedCategory}`);
  }
  // 4) scam + phishing shadow → would_auto_hide.
  {
    const scam = evaluateAutoProtect({ ...base, riskSignals: ["scam"] }, [pol("scam", "auto_hide_shadow")]);
    check("scam shadow → would_auto_hide", scam.decision === "would_auto_hide", scam.decision);
    const phish = evaluateAutoProtect({ ...base, text: "verify your account, click here to claim" }, [pol("phishing", "auto_hide_shadow")]);
    check("phishing shadow → would_auto_hide", phish.decision === "would_auto_hide" && phish.matchedCategory === "phishing", `${phish.decision}/${phish.matchedCategory}`);
  }
  // 5) normal criticism → never auto-hide (even if mis-set to shadow).
  {
    const monitor = evaluateAutoProtect({ ...base, riskLevel: "low", sentiment: "negative", riskSignals: ["complaint"], text: "the service was slow and disappointing" }, [pol("normal_criticism", "monitor")]);
    check("normal criticism monitor → monitor (not hide)", monitor.decision === "monitor" && monitor.matchedCategory === "normal_criticism", monitor.decision);
    const mis = evaluateAutoProtect({ ...base, riskLevel: "low", riskSignals: ["complaint"], text: "slow service" }, [pol("normal_criticism", "auto_hide_shadow")]);
    check("normal criticism shadow → blocked_by_safety (never hide)", mis.decision === "blocked_by_safety" && mis.safetyBlocked, mis.decision);
  }
  // 6) low confidence shadow → downgraded to requires_approval.
  {
    const r = evaluateAutoProtect({ ...base, confidence: 0.5, riskSignals: ["hate_speech"] }, [pol("hate_speech", "auto_hide_shadow")]);
    check("low-confidence shadow → requires_approval", r.decision === "requires_approval", r.decision);
  }
  // 7) competitor normal comparison → not auto-hide.
  {
    const r = evaluateAutoProtect({ ...base, riskLevel: "low", sentiment: "neutral", riskSignals: ["competitor"], text: "firma x bola lacnejsia" }, [pol("competitor_promo", "auto_hide_shadow"), pol("normal_criticism", "monitor")]);
    check("competitor comparison → normal_criticism, not hide", r.matchedCategory === "normal_criticism" && r.decision !== "would_auto_hide", `${r.matchedCategory}/${r.decision}`);
  }
  // 8) competitor promo → competitor_promo decision.
  {
    const r = evaluateAutoProtect({ ...base, riskLevel: "medium", riskSignals: ["competitor"], text: "podte ku mne, sme lacnejsi, piste dm" }, [pol("competitor_promo", "approval")]);
    check("competitor promo → competitor_promo + requires_approval", r.matchedCategory === "competitor_promo" && r.decision === "requires_approval", `${r.matchedCategory}/${r.decision}`);
  }
  // 10) shadow records decision but no execution field on result.
  {
    const r = evaluateAutoProtect({ ...base, riskSignals: ["scam"] }, [pol("scam", "auto_hide_shadow")]);
    check("shadow decision has no execution field", !("executed" in (r as Record<string, unknown>)) && !("hidden" in (r as Record<string, unknown>)));
    check("shadow reason states no platform action", /no platform action/i.test(r.reason));
  }
  // 13) disabled policy ignored → monitor only.
  {
    const r = evaluateAutoProtect({ ...base, riskSignals: ["profanity"] }, [pol("profanity", "auto_hide_shadow", { isActive: false })]);
    check("disabled policy → monitor (ignored)", r.decision === "monitor" && r.policyMode === "none", r.decision);
  }
  // 14) reserved-live enum never yields a live action (treated as shadow, no execution).
  {
    const r = evaluateAutoProtect({ ...base, riskSignals: ["scam"] }, [pol("scam", "auto_hide_live_reserved")]);
    check("auto_hide_live_reserved → shadow would_auto_hide, no live action", r.decision === "would_auto_hide" && /no platform action/i.test(r.reason), r.decision);
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Auto-Protect engine`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
