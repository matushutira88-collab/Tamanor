/**
 * Multilingual comment intelligence tests. Run via: pnpm intel:test
 * Covers language detection + risk + sentiment + approval + explanation for the
 * top languages and edge cases. No platform action is ever taken.
 */
import { RiskClassifier } from "../src/risk-classifier";
import { detectLanguage } from "../src/language-detect";
import { resolveTranslation } from "../src/translation";
import { Platform } from "@guardora/core";

const clf = new RiskClassifier();
let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const hot = (l: string) => ["high", "critical"].includes(l);

async function run() {
  const P = Platform.FacebookPage;

  const cases: Array<{ text: string; langIn?: string[]; hotExpected: boolean; sent?: string }> = [
    { text: "Kokot nenažratý", langIn: ["sk", "cs", "unknown"], hotExpected: true, sent: "negative" },
    { text: "To je podvod, vy zloději", langIn: ["cs", "sk"], hotExpected: true, sent: "negative" },
    { text: "This is a scam, don't buy", langIn: ["en"], hotExpected: true, sent: "negative" },
    { text: "Das ist Betrug", langIn: ["de"], hotExpected: true, sent: "negative" },
    { text: "To oszustwo", langIn: ["pl", "cs", "sk"], hotExpected: true, sent: "negative" },
    { text: "Ez átverés", langIn: ["hu"], hotExpected: true, sent: "negative" },
    { text: "Super služba, ďakujem", langIn: ["sk"], hotExpected: false, sent: "positive" },
    { text: "Máte otvorené v sobotu?", langIn: ["sk"], hotExpected: false },
  ];

  for (const c of cases) {
    const r = await clf.classify({ text: c.text, platform: P });
    const label = `"${c.text}"`;
    if (c.langIn) check(`${label} lang ∈ [${c.langIn.join(",")}] (got ${r.detectedLanguage})`, c.langIn.includes(r.detectedLanguage ?? "unknown"));
    check(`${label} risk ${c.hotExpected ? "high/critical" : "low/none/medium"} (got ${r.level})`, c.hotExpected ? hot(r.level) : !hot(r.level), r.level);
    if (c.sent) check(`${label} sentiment ${c.sent}`, r.sentiment === c.sent, r.sentiment);
    if (c.hotExpected) {
      check(`${label} approvalRequired (level implies)`, hot(r.level));
      check(`${label} explanation exists`, !!r.explanation && r.explanation.riskSignals.length > 0);
      check(`${label} matchedTerms non-empty`, (r.explanation?.matchedTerms.length ?? 0) > 0);
    }
  }

  // Unknown-language / gibberish → unknown detection, not negative.
  {
    const r = await clf.classify({ text: "xkqz vprtn zzz", platform: P });
    check("gibberish → language unknown", r.detectedLanguage === "unknown", r.detectedLanguage);
    check("gibberish → not high/critical", !hot(r.level), r.level);
  }

  // Mixed language → isMixed true, still flags the profanity.
  {
    const r = await clf.classify({ text: "Your service je úplne na hovno", platform: P });
    check("mixed EN+SK → detected mixed", r.isMixedLanguage === true, String(r.isMixedLanguage));
    check("mixed → high/critical (profanity 'hovno')", hot(r.level), r.level);
  }

  // Translation resolution honesty (no provider).
  {
    const same = resolveTranslation({ detectedLanguage: "en", workspaceLocale: "en", config: { enabled: false, provider: "none" } });
    check("same language → not_needed", same.status === "not_needed");
    const diff = resolveTranslation({ detectedLanguage: "de", workspaceLocale: "en", config: { enabled: false, provider: "none" } });
    check("diff language, no provider → unavailable (no fake translation)", diff.status === "unavailable" && diff.translatedText === null);
  }

  // detectLanguage direct spot-checks.
  check("detectLanguage('Das ist Betrug') = de", detectLanguage("Das ist Betrug").language === "de");
  check("detectLanguage('To oszustwo') = pl", detectLanguage("To oszustwo").language === "pl");

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — multilingual comment intelligence`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
