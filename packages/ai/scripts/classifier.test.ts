/**
 * Risk Rules V1 classifier tests. Dependency-free (no test runner) — run via:
 *   pnpm risk:test   (tsx)
 *
 * Asserts the beta-critical behaviors: SK/CZ/EN/DE vulgarity & abuse and
 * scam/fraud escalate to high/critical + negative + higher confidence, while
 * positive/neutral stay low. Obfuscated variants must still be caught.
 */
import { RiskClassifier } from "../src/risk-classifier";
import { Platform } from "@guardora/core";

const clf = new RiskClassifier();
let failures = 0;

function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const P = Platform.FacebookPage;

  // 1) SK personal vulgarity — the reported blocker.
  {
    const r = await clf.classify({ text: "Kokot nenažratý", platform: P });
    check("SK 'Kokot nenažratý' → high/critical", ["high", "critical"].includes(r.level), r.level);
    check("SK 'Kokot nenažratý' → negative", r.sentiment === "negative", r.sentiment);
    check("SK 'Kokot nenažratý' → profanity/abuse category", r.categories.some((c) => ["profanity", "harassment"].includes(c)), r.categories.join(","));
    check("SK 'Kokot nenažratý' → confidence ≥ 0.75", r.confidence >= 0.75, String(r.confidence));
  }

  // 2) SK scam.
  {
    const r = await clf.classify({ text: "Toto je podvod", platform: P });
    check("SK 'Toto je podvod' → high/critical", ["high", "critical"].includes(r.level), r.level);
    check("SK 'Toto je podvod' → scam category", r.categories.includes("scam"), r.categories.join(","));
  }

  // 3) EN insult.
  {
    const r = await clf.classify({ text: "You are idiots", platform: P });
    check("EN 'You are idiots' → high/critical", ["high", "critical"].includes(r.level), r.level);
    check("EN 'You are idiots' → negative", r.sentiment === "negative", r.sentiment);
  }

  // 4) EN scam.
  {
    const r = await clf.classify({ text: "Scam, do not buy", platform: P });
    check("EN 'Scam, do not buy' → high/critical", ["high", "critical"].includes(r.level), r.level);
  }

  // 5) Positive SK.
  {
    const r = await clf.classify({ text: "Super služba, ďakujem", platform: P });
    check("SK positive → low/none", ["low", "none"].includes(r.level), r.level);
    check("SK positive → positive sentiment", r.sentiment === "positive", r.sentiment);
  }

  // 6) Neutral question SK.
  {
    const r = await clf.classify({ text: "Máte otvorené v sobotu?", platform: P });
    check("SK neutral question → low/none", ["low", "none"].includes(r.level), r.level);
    check("SK neutral question → not negative", r.sentiment !== "negative", r.sentiment);
  }

  // 7) Obfuscated leet.
  {
    const r = await clf.classify({ text: "k0k0t", platform: P });
    check("obfuscated 'k0k0t' → high/critical", ["high", "critical"].includes(r.level), r.level);
  }

  // 8) Obfuscated masked vowel.
  {
    const r = await clf.classify({ text: "ty si p*ča", platform: P });
    check("masked 'p*ča' → high/critical", ["high", "critical"].includes(r.level), r.level);
  }

  // 9) DE profanity.
  {
    const r = await clf.classify({ text: "Du bist ein Arschloch", platform: P });
    check("DE 'Arschloch' → high/critical", ["high", "critical"].includes(r.level), r.level);
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Risk Rules V1 classifier`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
