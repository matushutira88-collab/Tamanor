/**
 * V1.54 — brand/positioning truthfulness test. Pure (reads source + dictionaries). Guards the
 * pan-European repositioning against regressions and against fake claims.
 * Run via: pnpm --filter @guardora/worker exec tsx ../web/scripts/brand-positioning.test.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { en } from "../src/i18n/dictionaries/en";
import { sk } from "../src/i18n/dictionaries/sk";
import { de } from "../src/i18n/dictionaries/de";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, "..", p), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const layout = read("src/app/layout.tsx");
const about = read("src/app/about/page.tsx");

// --- Positioning: pan-European platform, not a single-feature "firewall" on the marketing surfaces ---
check("homepage <title> repositioned (not 'Social Account Firewall')", /const TITLE =/.test(layout) && !/TITLE = "Tamanor — Social Account Firewall/.test(layout) && /reputation-security platform/i.test(layout));
check("homepage description mentions European privacy/governance + control", /European/i.test(layout) && /(control|governance|auditable)/i.test(layout));
for (const [name, d] of [["en", en], ["sk", sk], ["de", de]] as const) {
  check(`${name}: landingTitle not 'Social Account Firewall'`, !/Social Account Firewall/.test((d.meta as { landingTitle: string }).landingTitle));
  check(`${name}: footer.rights not 'Social Account Firewall'`, !/Social Account Firewall/.test((d.footer as { rights: string }).rights));
  check(`${name}: hero badge signals a European platform`, /Európsk|European|Europäische/i.test((d.hero as { badge: string }).badge));
}

// --- Truthfulness: no fake certifications / offices / startup-beta framing on public marketing ---
const publicText = layout + about + JSON.stringify(en) + JSON.stringify(sk) + JSON.stringify(de);
for (const claim of ["ISO 27001", "SOC 2", "SOC2", "NIS2 certified", "24/7 SOC", "penetration tested"]) {
  check(`no fake certification claim: ${claim}`, !new RegExp(claim, "i").test(publicText));
}
for (const office of ["Berlin office", "Paris office", "German headquarters", "French office", "Amsterdam office"]) {
  check(`no invented office: ${office}`, !new RegExp(office, "i").test(publicText));
}
check("about copy dropped the 'early-stage startup / design partners' signal", !/early-stage|design partner|dizajnov.* partner|Design-Partner/i.test(about));
check("operator identity is truthful (Infotech Solutions, s. r. o.)", read("src/components/site-footer.tsx").includes("Infotech Solutions, s. r. o."));

// --- CTA truthfulness: no beta/pilot/demo-primary marketing verbs in the CTA copy ---
const cta = [en.common, sk.common, de.common].map((c) => JSON.stringify(c)).join(" ");
for (const bad of ["Book a demo", "Request beta", "Join pilot", "early access"]) {
  check(`no obsolete CTA phrase in common CTAs: ${bad}`, !new RegExp(bad, "i").test(cta));
}
check("primary CTA 'Start (for) free' present", /Start (for )?free/i.test(JSON.stringify(en.common)));
check("secondary CTA 'Log in' present", /Log ?in/i.test(JSON.stringify(en.common)));

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — brand positioning & truthfulness (V1.54)`);
if (failures > 0) process.exit(1);
