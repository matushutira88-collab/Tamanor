/**
 * Single-item re-analysis language regression.
 *
 * Pins the exact benign production-shaped copy that previously inherited a legacy profanity/critical
 * verdict, while retaining strong positive coverage for real SK/EN/DE harm.
 */
import {
  DEFAULT_AUTO_PROTECT_POLICIES,
  RiskClassifier,
  classifyHybrid,
  evaluateAutoProtect,
  persistedProjectionFieldsAfterClassification,
} from "../src/index";
import { Platform, RiskCategory } from "@guardora/core";

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean, detail = ""): void {
  console.log(`${condition ? "  ✓" : "  ✗"} ${label}${condition ? "" : ` — ${detail}`}`);
  condition ? pass++ : fail++;
}

const policies = DEFAULT_AUTO_PROTECT_POLICIES.map((p) => ({
  ...p,
  minConfidence: 0.7,
  isActive: true,
}));

const benignFixtures = [
  {
    locale: "en",
    text: "Which pattern would concern your brand most: repeated comments, suspicious profiles or sudden engagement spikes?",
  },
  {
    locale: "en",
    text: "What would be hardest for your brand to detect: fake accounts, false claims or coordinated comments?",
  },
  {
    locale: "sk",
    text: "Ktorý vzorec by najviac znepokojoval vašu značku: opakované komentáre, podozrivé profily alebo náhly nárast interakcií?",
  },
  {
    locale: "de",
    text: "Welches Muster würde Ihre Marke am meisten beunruhigen: wiederholte Kommentare, verdächtige Profile oder plötzliche Interaktionsspitzen?",
  },
] as const;

function priorityFor(level: string): "low" | "normal" | "high" | "urgent" {
  if (level === "critical") return "urgent";
  if (level === "high") return "high";
  if (level === "medium") return "normal";
  return "low";
}

async function assertBenign(locale: string, text: string): Promise<void> {
  const result = await classifyHybrid(
    { text, platform: Platform.FacebookPage, locale },
    {
      workspaceLocale: locale,
      translation: { enabled: false, provider: "none", targetMode: "workspace_locale" },
      aiRisk: { enabled: false, provider: "none", minConfidence: 0.7, callMode: "value_gated" },
    },
  );
  const autoProtect = evaluateAutoProtect({
    text,
    riskLevel: result.level,
    categories: result.categories,
    riskSignals: result.explanation.riskSignals,
    matchedTerms: result.explanation.matchedTerms,
    sentiment: result.sentiment,
    confidence: result.confidence,
    requiresReview: result.requiresReview,
  }, policies);
  const projection = persistedProjectionFieldsAfterClassification({
    riskLevel: result.level,
    riskCategories: result.categories,
    riskConfidence: result.confidence,
    aiDiagnostics: result.diagnostics,
    autoProtect: { decision: autoProtect.decision, matchedCategory: autoProtect.matchedCategory },
  });
  const tag = `${locale}: ${text.slice(0, 30)}…`;
  const harmful = new Set(["profanity", "scam", "harassment"]);

  check(`${tag} — no profanity/scam/harassment`, !result.categories.some((c) => harmful.has(c)), result.categories.join(","));
  check(`${tag} — no high/critical risk`, !["high", "critical"].includes(result.level), result.level);
  check(`${tag} — no urgent system priority`, priorityFor(result.level) !== "urgent", priorityFor(result.level));
  check(`${tag} — no affirmative Auto-Protect`, !["would_auto_hide", "requires_approval"].includes(autoProtect.decision), autoProtect.decision);
  check(`${tag} — no review_required`, result.classificationState !== "review_required" && !result.requiresReview, result.classificationState);
  check(`${tag} — customer state no_issue`, projection.customerClassificationState === "no_issue", projection.customerClassificationState);
  check(`${tag} — re-analysis cleared`, projection.customerRequiresReanalysis === false, String(projection.customerRequiresReanalysis));
}

async function assertHarm(label: string, text: string, expected: RiskCategory): Promise<void> {
  const result = await new RiskClassifier().classify({ text, platform: Platform.FacebookPage });
  check(`${label} — high/critical`, ["high", "critical"].includes(result.level), result.level);
  check(`${label} — ${expected}`, result.categories.includes(expected), result.categories.join(","));
}

async function run(): Promise<void> {
  console.log("\nExact benign multilingual fixtures");
  for (const fixture of benignFixtures) await assertBenign(fixture.locale, fixture.text);

  console.log("\nReal harmful positives");
  await assertHarm("SK vulgarity", "Kokot nenažratý", RiskCategory.Profanity);
  await assertHarm("EN vulgarity", "You are a fucking asshole", RiskCategory.Profanity);
  await assertHarm("DE vulgarity", "Du bist ein Arschloch", RiskCategory.Profanity);
  await assertHarm("SK scam", "Toto je podvod", RiskCategory.Scam);
  await assertHarm("EN scam", "This is a scam", RiskCategory.Scam);
  await assertHarm("DE scam", "Das ist Betrug", RiskCategory.Scam);
  await assertHarm("Threat", "I will kill you", RiskCategory.Harassment);
  await assertHarm("Harassment", "You are idiots", RiskCategory.Harassment);

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — single-item re-analysis fixtures (${pass} checks)`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
