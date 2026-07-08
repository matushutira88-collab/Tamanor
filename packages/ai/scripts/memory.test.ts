/**
 * Brand risk memory tests. Run via: pnpm memory:test
 * Covers allow/block/watch/competitor rules, the critical safety floor,
 * inactive-rule handling, brand isolation (pure logic), and no platform action.
 */
import { applyBrandMemory, type BrandMemoryRule } from "../src/brand-memory";
import { classifyHybrid } from "../src/pipeline";
import { Platform } from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const rule = (over: Partial<BrandMemoryRule>): BrandMemoryRule =>
  ({ type: "watch_phrase", normalizedPhrase: "x", severity: "medium", isActive: true, ...over });

async function run() {
  // 3) allow_phrase reduces a low/medium risk.
  {
    const r = applyBrandMemory({ text: "our sale is a steal", level: "medium", categories: [], riskSignals: ["complaint"], rules: [rule({ type: "allow_phrase", normalizedPhrase: "steal" })] });
    check("allow_phrase lowers medium → none", r.level === "none", r.level);
  }
  // 4) allow_phrase does NOT reduce protected signals (floor).
  {
    const scam = applyBrandMemory({ text: "this is a scam giveaway", level: "critical", categories: ["scam"], riskSignals: ["scam"], rules: [rule({ type: "allow_phrase", normalizedPhrase: "giveaway" })] });
    check("allow blocked by floor (scam) → stays critical", scam.level === "critical", scam.level);
    check("allow floor recorded", scam.matches.some((m) => m.effect === "blocked_by_floor"));
    const harass = applyBrandMemory({ text: "kokot idiot", level: "critical", categories: ["profanity", "harassment"], riskSignals: ["profanity", "harassment"], rules: [rule({ type: "allow_phrase", normalizedPhrase: "kokot" })] });
    check("allow blocked by floor (harassment) → stays critical", harass.level === "critical", harass.level);
    const critProf = applyBrandMemory({ text: "kokot", level: "critical", categories: ["profanity"], riskSignals: ["profanity"], rules: [rule({ type: "allow_phrase", normalizedPhrase: "kokot" })] });
    check("allow blocked by floor (critical profanity) → stays critical", critProf.level === "critical", critProf.level);
  }
  // 5) block_phrase raises risk.
  {
    const r = applyBrandMemory({ text: "refund now or else", level: "low", categories: [], riskSignals: [], rules: [rule({ type: "block_phrase", normalizedPhrase: "refund now", severity: "high" })] });
    check("block_phrase raises low → high+", ["high", "critical"].includes(r.level), r.level);
    check("block_phrase adds signal", r.riskSignals.includes("brand_blocked"));
  }
  // 6) watch_phrase adds a signal + raises to at least medium.
  {
    const r = applyBrandMemory({ text: "late delivery again", level: "none", categories: [], riskSignals: [], rules: [rule({ type: "watch_phrase", normalizedPhrase: "late delivery" })] });
    check("watch_phrase adds brand_watch signal", r.riskSignals.includes("brand_watch"));
    check("watch_phrase raises none → medium+", ["medium", "high", "critical"].includes(r.level), r.level);
  }
  // 7) competitor_phrase adds category/signal (no forced escalation).
  {
    const r = applyBrandMemory({ text: "switching to acmecorp", level: "none", categories: [], riskSignals: [], rules: [rule({ type: "competitor_phrase", normalizedPhrase: "acmecorp" })] });
    check("competitor_phrase adds competitor category", r.categories.includes("competitor"));
    check("competitor_phrase adds competitor signal", r.riskSignals.includes("competitor"));
  }
  // 8) inactive memory rule is ignored.
  {
    const r = applyBrandMemory({ text: "refund now", level: "none", categories: [], riskSignals: [], rules: [rule({ type: "block_phrase", normalizedPhrase: "refund now", isActive: false })] });
    check("inactive rule ignored → stays none", r.level === "none" && r.matches.length === 0);
  }
  // 9) feedback-derived rule only applies once ACTIVE (confirmation flow: default inactive → no effect).
  {
    const pending = applyBrandMemory({ text: "refund now", level: "none", categories: [], riskSignals: [], rules: [rule({ type: "block_phrase", normalizedPhrase: "refund now", isActive: false })] });
    const confirmed = applyBrandMemory({ text: "refund now", level: "none", categories: [], riskSignals: [], rules: [rule({ type: "block_phrase", normalizedPhrase: "refund now", isActive: true, severity: "high" })] });
    check("unconfirmed (inactive) feedback rule → no effect", pending.level === "none");
    check("confirmed (active) feedback rule → applied", ["high", "critical"].includes(confirmed.level));
  }
  // 10) brand isolation — a rule from brand B never touches brand A (caller scopes rules[]).
  {
    const brandA = applyBrandMemory({ text: "refund now", level: "none", categories: [], riskSignals: [], rules: [] /* only brand A's (none) */ });
    check("brand isolation: empty rules for brand A → unchanged", brandA.level === "none" && brandA.matches.length === 0);
  }
  // 11) no platform action — hybrid result carries no execution field.
  {
    const h = await classifyHybrid(
      { text: "great service, love it", platform: Platform.FacebookPage },
      { workspaceLocale: "en", translation: { enabled: false, provider: "none", targetMode: "workspace_locale" }, aiRisk: { enabled: false, provider: "none", minConfidence: 0.7 }, memoryRules: [rule({ type: "block_phrase", normalizedPhrase: "love it", severity: "high" })] },
    );
    check("hybrid applies brand memory (block 'love it' → high)", ["high", "critical"].includes(h.level), h.level);
    check("hybrid records memoryMatched", h.memoryMatched.length > 0);
    check("no platform action field", !("executed" in (h as Record<string, unknown>)) && !("hidden" in (h as Record<string, unknown>)));
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — brand risk memory`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
