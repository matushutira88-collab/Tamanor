/**
 * V1.34 Beta Launch Package. Verifies the public landing/pricing/demo-form/README
 * present Tamanor as a beta Social Account Firewall — clearly, honestly (Facebook
 * available, Instagram monitoring-only, no TikTok/YouTube/LinkedIn claims), with
 * beta pricing cards (no billing), a beta-access CTA, and NO overclaim / fake /
 * managed-moderation wording. No behavior or state-truth change.
 *
 * Run via: pnpm beta-launch:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getPlatformConnector, INSTAGRAM_CAPABILITIES } from "@guardora/core";
import { sentimentBucket } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const landing = readSrc("apps/web/src/components/landing/landing-content.tsx");
  const bookDemo = readSrc("apps/web/src/app/book-demo/page.tsx");
  const layout = readSrc("apps/web/src/app/layout.tsx");
  const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
  const readme = readSrc("README.md");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");
  const dicts = [en, sk, de];

  // 1) Landing uses Tamanor — Social Account Firewall.
  check("1) Tamanor — Social Account Firewall", en.includes('titleBefore: "Tamanor —"') && en.includes('titleHighlight: "Social Account Firewall"') && layout.includes('TITLE = "Tamanor — Social Account Firewall"'));

  // 2) Landing explains who Tamanor is for.
  check("2) explains who it's for", landing.includes("t.beta.whoTitle") && landing.includes("t.beta.whoSegments") && en.includes("whoSegments") && sk.includes("Marketingové a social media agentúry"));

  // 3) Landing explains what Tamanor protects.
  check("3) explains what it protects", landing.includes("t.beta.protectsItems") && dicts.every((d) => /protectsItems: \[/.test(d)) && en.includes('"Spam"') && en.includes('"Phishing"'));

  // 4) Landing explains how it works (4 steps).
  check("4) explains how it works", landing.includes("t.beta.howSteps") && en.includes("Connect your account") && sk.includes("Pripojíte účet") && sk.includes("nejasné prípady pošle vášmu tímu"));

  // 5) Landing says normal criticism is not hidden automatically.
  check("5) not censorship copy", landing.includes("t.beta.notCensorshipBody") && en.includes("Normal criticism is not hidden automatically") && sk.includes("Normálna kritika nie je automaticky skrývaná"));

  // 6) Landing says the customer defines the rules.
  check("6) self-service rules", en.includes("You define the rules. Tamanor applies them automatically") && sk.includes("Vy určujete pravidlá. Tamanor ich automaticky vykonáva") && landing.includes("t.beta.selfServiceTitle"));

  // 7) Landing says Tamanor is not a moderation agency.
  check("7) not a moderation agency", en.includes("not a moderation agency") && sk.includes("nie je moderátorská agentúra"));

  // 8) Platform support: Facebook protection available.
  check("8) Facebook protection available", landing.includes("t.beta.fbBody") && en.includes("Protection, automatic hidden-from-public") && sk.includes("Ochrana, automatické skrytie pre verejnosť"));

  // 9) Platform support: Instagram monitoring/analysis only.
  check("9) Instagram monitoring only", landing.includes("t.beta.igBody") && en.includes("Automatic hiding is not enabled yet") && sk.includes("Automatické skrytie zatiaľ nie je zapnuté"));

  // 10) Does NOT claim TikTok/YouTube/LinkedIn support.
  check("10) no TikTok/YouTube/LinkedIn claims", !landing.includes("YouTube") && !landing.includes("TikTok") && !landing.includes("LinkedIn") && en.includes("does not claim TikTok, YouTube or LinkedIn"));

  // 11) Pricing has Starter Beta / Growth Beta / Agency Beta.
  check("11) beta pricing tiers", ["Starter Beta", "Growth Beta", "Agency Beta"].every((n) => en.includes(n)) && landing.includes("t.beta.plans") && en.includes('"€49"') && en.includes('"€149"') && en.includes('"€399"'));

  // 12) No Stripe / checkout dependency.
  check("12) no billing/checkout", !/stripe|checkout|subscription/i.test(landing) && !/stripe|checkout/i.test(bookDemo));

  // 13) Beta pricing may change at public launch.
  check("13) beta pricing may change", en.includes("may change at public launch") && sk.includes("môžu sa pri verejnom spustení zmeniť"));

  // 14) Beta access CTA exists.
  check("14) beta access CTA", landing.includes("t.common.requestBetaAccess") && en.includes('requestBetaAccess: "Request beta access"') && sk.includes('requestBetaAccess: "Požiadať o beta prístup"'));

  // 15) Demo/contact form copy says beta access + captures segment/platforms.
  check("15) demo form beta access", bookDemo.includes("Request beta access") && bookDemo.includes("Request Tamanor beta access") && bookDemo.includes('name="segment"') && bookDemo.includes('name="platforms"'));

  // 16) Metadata title uses Tamanor — Social Account Firewall.
  check("16) metadata title", layout.includes('TITLE = "Tamanor — Social Account Firewall"') && layout.includes('applicationName: "Tamanor"'));

  // 17) No public Guardora brand remains on these surfaces.
  check("17) no public Guardora brand", [landing, bookDemo, layout].every((s) => !s.includes("Guardora")) && dicts.every((d) => !d.includes("Guardora")));

  // 18) No fake customer/testimonial/logo claims.
  check("18) no fake testimonials/logos", ![landing, ...dicts].some((s) => /testimonial|trusted by|our customers say|as seen on|client logos/i.test(s)));

  // 19) No managed-moderation wording.
  check("19) no managed-moderation wording", ![landing, ...dicts].some((s) => /our moderators|managed moderation|we decide what to hide|human moderators from/i.test(s)));

  // 20) No overclaim wording.
  const OVERCLAIM = [/solves all/i, /removes all hate/i, /detects all fake accounts/i, /guaranteed bot/i, /fully automated moderation for instagram/i, /deletes comments/i, /100% (?:safe|accurate)/i];
  check("20) no overclaim wording", OVERCLAIM.every((re) => !re.test([landing, ...dicts].join("\n"))));

  // 21) App onboarding mentions Facebook first setup.
  check("21) onboarding Facebook first", cc.includes("t.cc.onbPlatformNote") && en.includes("Connect a Facebook Page to start your first comment protection") && sk.includes("Pripojte Facebook Page a spustite prvú ochranu komentárov"));

  // 22) App onboarding says Instagram is monitoring/analysis for now.
  check("22) onboarding Instagram beta", cc.includes("t.cc.onbInstagramBeta") && en.includes("Instagram Business is available in beta for monitoring and analytics") && sk.includes("Instagram Business je v beta režime dostupný na monitoring a analytiku"));

  // 23) README includes beta status + safe env gates.
  check("23) README beta status + env gates", /beta pilot/i.test(readme) && readme.includes("INSTAGRAM_HIDE_TEST_ENABLED=false") && readme.includes("LIVE_ACTIONS_DRY_RUN=true") && readme.includes("INSTAGRAM_AUTO_HIDE_ENABLED=false"));

  // 24) i18n SK/EN/DE beta keys present.
  check("24) i18n beta keys (SK/EN/DE)", dicts.every((d) => /\bbeta: \{/.test(d) && d.includes("whoTitle") && d.includes("Starter Beta") && d.includes("betaNote")));

  // 25) Existing behavior/state-truth unchanged.
  check("25) state truth + platform behavior intact", sentimentBucket({ categories: ["normal_criticism"], sentiment: "negative", riskLevel: "critical" }) !== "risky" && getPlatformConnector("facebook").capabilities.canHideComment === true && INSTAGRAM_CAPABILITIES.canHideComment === false);

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Beta Launch Package`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
