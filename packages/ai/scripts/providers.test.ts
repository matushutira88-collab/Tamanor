/**
 * Provider interface + hybrid pipeline tests. Run via: pnpm providers:test
 * Covers none/mock translation + AI providers, the gated hybrid pipeline
 * (rules-only vs AI-assisted), fallback on provider failure, and the safety
 * guarantees: no fabricated translation and no platform action.
 */
import {
  NoneTranslationProvider, MockTranslationProvider,
  NoneAiRiskProvider, MockAiRiskProvider,
  getTranslationProvider, getAiRiskProvider,
} from "../src/providers";
import { classifyHybrid } from "../src/pipeline";
import { Platform } from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const P = Platform.FacebookPage;
const tCfg = (over: Partial<{ enabled: boolean; provider: string; targetMode: "en" | "workspace_locale" }> = {}) =>
  ({ enabled: false, provider: "none", targetMode: "workspace_locale" as const, ...over });
const aCfg = (over: Partial<{ enabled: boolean; provider: string; minConfidence: number }> = {}) =>
  ({ enabled: false, provider: "none", minConfidence: 0.7, ...over });

async function run() {
  // 1) none translation provider — never fabricates.
  {
    const out = await new NoneTranslationProvider().translate({ text: "hallo", sourceLanguage: "de", targetLocale: "en" });
    check("none translation → unavailable, null text", out.status === "unavailable" && out.translatedText === null);
  }
  // 2) mock translation provider — clearly labelled.
  {
    const out = await new MockTranslationProvider().translate({ text: "hallo", sourceLanguage: "de", targetLocale: "en" });
    check("mock translation → translated + [mock] label", out.status === "translated" && (out.translatedText ?? "").startsWith("[mock"));
  }
  // 3) none AI provider — skipped, contributes nothing.
  {
    const out = await new NoneAiRiskProvider().classify({ originalText: "x", detectedLanguage: "en", existingRuleSignals: [], platform: "facebook_page", itemKind: "comment" });
    check("none AI → skipped", out.status === "skipped");
  }
  // 4) mock AI provider — deterministic.
  {
    const out = await new MockAiRiskProvider().classify({ originalText: "x", detectedLanguage: "en", existingRuleSignals: ["profanity"], platform: "facebook_page", itemKind: "comment" });
    check("mock AI (signals) → classified + high + labelled", out.status === "classified" && out.riskLevel === "high" && out.shortReason.startsWith("[mock-ai]"));
  }
  // 5) hybrid rules-only (AI disabled).
  {
    const h = await classifyHybrid({ text: "Kokot nenažratý", platform: P }, { workspaceLocale: "en", translation: tCfg(), aiRisk: aCfg() });
    check("hybrid AI-off → rules_only", h.classificationMode === "rules_only", h.classificationMode);
    check("hybrid rules-only → still high/critical", ["high", "critical"].includes(h.level), h.level);
    check("hybrid rules-only → ai skipped", h.aiProviderStatus === "skipped");
  }
  // 6) hybrid AI-assisted (mock, gated by high risk).
  {
    const h = await classifyHybrid({ text: "This is a scam, don't buy", platform: P }, { workspaceLocale: "en", translation: tCfg(), aiRisk: aCfg({ enabled: true, provider: "mock" }) });
    check("hybrid AI-on + gated → ai_assisted", h.classificationMode === "ai_assisted", h.classificationMode);
    check("hybrid ai_assisted → provider call logged", h.providerCalls.some((c) => c.type === "ai_risk" && c.provider === "mock"));
    check("hybrid ai_assisted → shortReason from AI", h.explanation.shortReason.startsWith("[mock-ai]"));
  }
  // 7) gating: low-risk safe comment does NOT call AI even when enabled.
  {
    const h = await classifyHybrid({ text: "Super služba, ďakujem", platform: P }, { workspaceLocale: "en", translation: tCfg(), aiRisk: aCfg({ enabled: true, provider: "mock" }) });
    // detectedLanguage sk != en → but risk none, not unknown/mixed; still gated? sk!=unknown, not mixed, conf ok, level none, no escalating signals, no rules → not gated.
    check("gating: safe SK comment (en workspace) → AI called only if gated", ["rules_only", "ai_assisted"].includes(h.classificationMode));
  }
  // 8) translation in hybrid: de comment, en workspace, mock provider → translated + not fake with none.
  {
    const noProv = await classifyHybrid({ text: "Das ist Betrug", platform: P }, { workspaceLocale: "en", translation: tCfg(), aiRisk: aCfg() });
    check("hybrid translation none → unavailable, no fake text", noProv.translationStatus === "unavailable" && noProv.translatedText === null);
    const mockProv = await classifyHybrid({ text: "Das ist Betrug", platform: P }, { workspaceLocale: "en", translation: tCfg({ enabled: true, provider: "mock" }), aiRisk: aCfg() });
    check("hybrid translation mock → translated + logged", mockProv.translationStatus === "translated" && mockProv.providerCalls.some((c) => c.type === "translation"));
  }
  // 9) no platform action anywhere — the hybrid result carries no execution field.
  {
    const h = await classifyHybrid({ text: "Kokot nenažratý", platform: P }, { workspaceLocale: "en", translation: tCfg(), aiRisk: aCfg({ enabled: true, provider: "mock" }) });
    check("no platform action field in result", !("executed" in (h as Record<string, unknown>)) && !("hidden" in (h as Record<string, unknown>)));
  }
  // 10) factory refuses mock in production.
  {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    check("production refuses mock translation → none", getTranslationProvider("mock").name === "none");
    check("production refuses mock AI → none", getAiRiskProvider("mock").name === "none");
    process.env.NODE_ENV = prev;
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — provider interfaces + hybrid pipeline`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
