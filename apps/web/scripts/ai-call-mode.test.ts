/**
 * V1.61 — AI_RISK_CALL_MODE (value_gated | all), PURE tests (no DB, no network, mock provider).
 *
 * Proves:
 *  - config parsing fails SAFE: missing / empty / whitespace / invalid → value_gated; all/ALL/" all " → all;
 *  - value_gated is UNCHANGED: a confident, benign, known-language comment does NOT call the AI provider;
 *  - `all` consults the provider for EVERY comment (benign AND high-risk), after enabled+provider hold;
 *  - the rules floor is intact in BOTH modes: the AI can RAISE but never LOWER the rules risk
 *    (a critical rules result stays critical even when the provider returns a lower level).
 *
 * Run: pnpm ai-call-mode:test
 */
import { normalizeAiRiskCallMode } from "@guardora/config";
import { classifyHybrid, type ClassificationInput } from "@guardora/ai";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
};

const RISK_ORDER = ["none", "low", "medium", "high", "critical"];
const rank = (l: string) => Math.max(0, RISK_ORDER.indexOf(l));

// Test the pure normalizer directly (loadEnv memoizes, so env variants can't be exercised via getAiRiskConfig).
const callMode = (v?: string) => normalizeAiRiskCallMode(v);

const BENIGN = "Thank you so much, this update was genuinely helpful — looking forward to more!";
const SCAM = "This is a scam and fraud — total ripoff, you are a crook and a thief, I will sue you.";

const input = (text: string): ClassificationInput => ({
  text, platform: "facebook_page" as ClassificationInput["platform"], locale: "en", rules: [],
});
// `minConfidence: 0` makes the value-gate's "low confidence" branch FALSE for a benign comment
// (whose rules confidence is a normal ~0.3), so value_gated genuinely declines to call — isolating callMode.
const cfg = (mode: "value_gated" | "all", provider = "mock") => ({
  workspaceLocale: "en",
  translation: { enabled: false, provider: "none", targetMode: "workspace_locale" as const },
  aiRisk: { enabled: provider !== "none", provider, minConfidence: 0, callMode: mode },
  memoryRules: [],
});

async function run() {
  // --- 1) config parsing fails SAFE ---------------------------------------------------------------
  check("missing AI_RISK_CALL_MODE → value_gated", callMode(undefined) === "value_gated", callMode(undefined));
  check("empty string → value_gated", callMode("") === "value_gated", callMode(""));
  check("whitespace → value_gated", callMode("   ") === "value_gated", callMode("   "));
  check("invalid value → value_gated", callMode("banana") === "value_gated", callMode("banana"));
  check("explicit value_gated → value_gated", callMode("value_gated") === "value_gated");
  check("all → all", callMode("all") === "all");
  check("ALL (uppercase) → all", callMode("ALL") === "all", callMode("ALL"));
  check("'  all  ' (padded) → all", callMode("  all  ") === "all", callMode("  all  "));

  // --- 2) value_gated is UNCHANGED: confident benign comment does NOT call the provider ------------
  const vg = await classifyHybrid(input(BENIGN), cfg("value_gated"));
  check("value_gated + confident benign → AI NOT called", vg.aiProvider === "none" && vg.classificationMode === "rules_only", `${vg.aiProvider}/${vg.classificationMode}`);
  check("value_gated + benign → aiProviderStatus skipped", vg.aiProviderStatus === "skipped", vg.aiProviderStatus);

  // --- 3) `all` consults the provider for EVERY comment -------------------------------------------
  const allBenign = await classifyHybrid(input(BENIGN), cfg("all"));
  check("all + benign → AI called (ai_assisted)", allBenign.aiProvider === "mock" && allBenign.classificationMode === "ai_assisted", `${allBenign.aiProvider}/${allBenign.classificationMode}`);

  const allScam = await classifyHybrid(input(SCAM), cfg("all"));
  check("all + high-risk → AI called (ai_assisted)", allScam.aiProvider === "mock" && allScam.classificationMode === "ai_assisted", `${allScam.aiProvider}/${allScam.classificationMode}`);

  // --- 4) rules floor intact in BOTH modes: AI can RAISE but never LOWER --------------------------
  const rulesOnlyScam = await classifyHybrid(input(SCAM), { ...cfg("all"), aiRisk: { enabled: false, provider: "none", minConfidence: 0 } });
  check("all-mode final level ≥ rules-only level (never lowers, risky)", rank(allScam.level) >= rank(rulesOnlyScam.level), `${allScam.level} vs ${rulesOnlyScam.level}`);
  // The mock provider caps at "high"; a critical rules verdict must survive the merge unchanged.
  if (rulesOnlyScam.level === "critical") check("critical rules verdict is NOT lowered by AI", allScam.level === "critical", allScam.level);
  const rulesOnlyBenign = await classifyHybrid(input(BENIGN), { ...cfg("all"), aiRisk: { enabled: false, provider: "none", minConfidence: 0 } });
  check("all-mode does not RAISE a benign comment above rules (mock adds none)", rank(allBenign.level) >= rank(rulesOnlyBenign.level) && allBenign.level === rulesOnlyBenign.level, `${allBenign.level} vs ${rulesOnlyBenign.level}`);

  // --- 4b) diagnostics breakdown is emitted (rules vs AI vs merged + how AI was invoked) ----------
  check("diagnostics.callMode reflects the mode", allBenign.diagnostics?.callMode === "all" && vg.diagnostics?.callMode === "value_gated", `${allBenign.diagnostics?.callMode}/${vg.diagnostics?.callMode}`);
  check("diagnostics gate records AI consulted vs not (+ reason)", allBenign.diagnostics?.gate.aiCalled === true && allBenign.diagnostics?.gate.reason === "all_mode" && vg.diagnostics?.gate.aiCalled === false && vg.diagnostics?.gate.reason === "gate_not_fired", `${allBenign.diagnostics?.gate.reason}/${vg.diagnostics?.gate.reason}`);
  check("diagnostics keeps rules + merged snapshots", !!allScam.diagnostics?.rules && !!allScam.diagnostics?.merged && allScam.diagnostics?.merged.level === allScam.level);
  check("diagnostics AI verdict present when classified (mock)", !!allScam.diagnostics?.ai.verdict);
  check("diagnostics does NOT carry model/tokens (joined from UsageEvent)", !!allScam.diagnostics && !("model" in allScam.diagnostics.ai) && !("inputTokens" in allScam.diagnostics.ai));

  // --- 5) omitted callMode in the config defaults to value_gated behaviour ------------------------
  const omitted = await classifyHybrid(input(BENIGN), {
    workspaceLocale: "en",
    translation: { enabled: false, provider: "none", targetMode: "workspace_locale" },
    aiRisk: { enabled: true, provider: "mock", minConfidence: 0 }, // no callMode
    memoryRules: [],
  });
  check("omitted callMode behaves as value_gated (benign → not called)", omitted.aiProvider === "none", omitted.aiProvider);

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — AI call mode (V1.61): pure config + pipeline gate + floor`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
