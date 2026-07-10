/**
 * V1.33 Public rebrand → Tamanor (Social Account Firewall). Verifies the public
 * brand is Tamanor across user-facing surfaces, the tagline is present, no
 * user-facing dictionary/page still says "Guardora", and that NOTHING about
 * behavior/state-truth/Facebook/Instagram changed. Internal package names, DB
 * tables and Prisma models may still use "guardora" — that is allowed.
 *
 * Run via: pnpm rebrand:tamanor:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getPlatformConnector, INSTAGRAM_CAPABILITIES, HIDDEN_FROM_PUBLIC_REASONS } from "@guardora/core";
import { sentimentBucket } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");
  const layout = readSrc("apps/web/src/app/layout.tsx");
  const logo = readSrc("apps/web/src/components/logo.tsx");
  const footer = readSrc("apps/web/src/components/site-footer.tsx");
  const control = readSrc("apps/web/src/app/dashboard/control-center/page.tsx");
  const comments = readSrc("apps/web/src/app/dashboard/comments/page.tsx");
  const security = readSrc("apps/web/src/app/security/page.tsx");
  const nav = readSrc("apps/web/src/lib/nav.ts");
  const dicts = [en, sk, de];

  // 1) Public UI uses Tamanor (wordmark + metadata + dictionaries).
  check("1) public UI uses Tamanor", logo.includes(">Tamanor<") && layout.includes("Tamanor") && footer.includes(">Tamanor<") && dicts.every((d) => d.includes("Tamanor")));

  // 2) Tagline "Social Account Firewall" appears on brand surfaces.
  check("2) tagline present", layout.includes("Social Account Firewall") && dicts.every((d) => d.includes("Social Account Firewall")) && en.includes('brandFull: "Tamanor — Social Account Firewall"'));

  // 3) User-facing dictionaries no longer say Guardora / Guardora.ai.
  check("3) dictionaries free of Guardora", dicts.every((d) => !d.includes("Guardora")));

  // 4) Command Center uses Tamanor copy.
  check("4) Command Center Tamanor copy", sk.includes("Tamanor aktuálne chráni") && en.includes("Tamanor"));

  // 5) Control Center self-service copy uses Tamanor + still self-service.
  check("5) Control Center self-service Tamanor", control.includes("controlExplainer") && en.includes("You define the rules") && sk.includes("Vy určujete pravidlá") && !control.includes("Guardora"));

  // 6) Trust copy still says normal criticism is not automatically hidden.
  check("6) trust copy intact", sk.includes("Normálna kritika nie je automaticky skrývaná") && en.includes("Normal criticism is not hidden automatically") && de.includes("Normale Kritik wird nicht automatisch verborgen"));

  // 7) UI does not imply a moderation agency (self-service negation intact).
  check("7) not a moderation agency", sk.includes("nie je moderátorská agentúra") && en.includes("not a moderation agency") && dicts.every((d) => !/naši moderátori|our moderators|managed moderation/i.test(d)));

  // 8) Metadata/browser title uses Tamanor — Social Account Firewall.
  check("8) metadata title Tamanor", /TITLE = "Tamanor — Social Account Firewall"/.test(layout) && layout.includes('applicationName: "Tamanor"') && layout.includes('siteName: "Tamanor"'));

  // 9) Internal @guardora/* package names may remain (not user-visible).
  const pkg = readSrc("package.json");
  check("9) internal guardora names allowed", comments.includes("@guardora/") && pkg.includes("guardora"));

  // 10) DB/Prisma/internal migration names are NOT required to change.
  const schema = readSrc("packages/db/prisma/schema.prisma");
  check("10) prisma models untouched", /model ContentItem/.test(schema) && /model ReputationItem/.test(schema));

  // 11) Facebook behavior unchanged (capabilities + hide set).
  check("11) Facebook unchanged", getPlatformConnector("facebook").capabilities.canHideComment === true && HIDDEN_FROM_PUBLIC_REASONS.length === 2 && HIDDEN_FROM_PUBLIC_REASONS.includes("live_hide_executed"));

  // 12) Instagram remains test-only / read-only.
  check("12) Instagram unchanged", INSTAGRAM_CAPABILITIES.canHideComment === false && INSTAGRAM_CAPABILITIES.canReadComments === true && getPlatformConnector("instagram").capabilities.canModerateAutomatically === false);

  // 13) No state truth change.
  check("13) state truth intact", sentimentBucket({ categories: ["normal_criticism"], sentiment: "negative", riskLevel: "critical" }) !== "risky" && sentimentBucket({ categories: ["scam"], sentiment: "neutral", riskLevel: "none" }) === "risky");

  // 14) No raw provider ids/codes in default UI.
  check("14) no raw provider codes default", !comments.includes("providerResponseCode") && !comments.includes("providerErrorCode") && !nav.includes("providerResponseCode"));

  // 15) SK/EN/DE brand keys present.
  check("15) brand i18n keys present", dicts.every((d) => /brand: "Tamanor"/.test(d) && d.includes('brandTagline: "Social Account Firewall"')));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Public rebrand to Tamanor`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
