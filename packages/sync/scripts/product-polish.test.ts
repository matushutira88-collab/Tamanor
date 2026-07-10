/**
 * V1.29B — product polish & demo readiness (beta checklist).
 * Onboarding + empty states, navigation consistency, no dev/debug/demo content in
 * the default UI, trust copy, mobile no-wide-tables, Advanced collapsed. Source +
 * pure-logic assertions; state truth is verified by the other suites.
 *
 * Run via: pnpm product-polish:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import { sentimentBucket, queueTabStates } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const nav = readSrc("apps/web/src/lib/nav.ts");
  const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
  const aqList = readSrc("apps/web/src/app/dashboard/action-queue/page.tsx");
  const aqDetail = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
  const rep = readSrc("apps/web/src/app/dashboard/reputation/page.tsx");
  const incidents = readSrc("apps/web/src/app/dashboard/incidents/page.tsx");
  const accounts = readSrc("apps/web/src/app/dashboard/accounts/page.tsx");
  const acctDetail = readSrc("apps/web/src/app/dashboard/accounts/[accountId]/page.tsx");
  const control = readSrc("apps/web/src/app/dashboard/control-center/page.tsx");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");

  // 1) No-account Command Center onboarding CTA.
  check("1) no-account CC has onboarding CTA + platform note", cc.includes("onbConnectFirst") && cc.includes("connectAccount") && cc.includes("onbPlatformNote") && sk.includes("Pripojte svoj prvý sociálny účet"));
  // 2) connected-no-data friendly empty state.
  check("2) connected-no-data CC friendly state", cc.includes("totalItems === 0") && cc.includes("noDataTitle") && sk.includes("Guardora čaká na prvé komentáre"));
  // 3) Action Queue empty product-friendly.
  check("3) Action Queue empty product-friendly", aqList.includes("queueEmptyActiveBody") && sk.includes("Guardora bude škodlivé komentáre skrývať"));
  // 4) Reputation empty product-friendly.
  check("4) Reputation empty product-friendly", rep.includes("emptyNoComments") && sk.includes("Zatiaľ nemáme dostatok komentárov"));
  // 5) Incidents empty product-friendly.
  check("5) Incidents empty product-friendly", incidents.includes("incidentsEmptyBody") && sk.includes("koordinovaný útok alebo krízový nárast"));
  // 6) Accounts empty product-friendly.
  check("6) Accounts empty product-friendly", accounts.includes("noAccountsBody") && sk.includes("Pripojte Facebook Page, aby Guardora"));

  // 7) exactly 5 primary visible entries (an entry with neither `group` nor `hidden`).
  const entries = nav.match(/\{\s*href: "\/dashboard[^{}]*?\}/gs) ?? [];
  const primaryCount = entries.filter((e) => !e.includes("group:") && !e.includes("hidden:")).length;
  check("7) exactly 5 primary nav items", primaryCount === 5, String(primaryCount));
  // 8) More includes Reputation.
  check("8) More nav includes Reputation", /href: "\/dashboard\/reputation"[\s\S]*?group: "More"/.test(nav));
  // 9) hidden duplicate routes stay routable (hidden:true), not visible.
  for (const h of ["inbox", "approvals", "insights", "brands", "rules", "reports", "leads", "team", "billing"]) {
    check(`9) ${h} route hidden from nav but routable`, new RegExp(`href: "/dashboard/${h}"[^}]*hidden: true`).test(nav));
  }

  // 10/11) no provider codes / raw ids in default product pages.
  for (const [name, src] of [["command-center", cc], ["reputation", rep], ["action-queue list", aqList]] as const) {
    check(`10) ${name}: no provider codes`, !src.includes("providerResponseCode") && !src.includes("providerErrorCode"));
    check(`11) ${name}: no raw ids`, !src.includes("externalCommentId") && !src.includes("policyId"));
  }

  // 12) no demo/mock/fake data in DB.
  const [mock, demo] = await Promise.all([
    prisma.connectedAccount.count({ where: { status: "mock_connected" } }),
    prisma.brand.count({ where: { name: { contains: "Northwind" } } }),
  ]);
  check("12) no demo/mock data", mock === 0 && demo === 0);

  // 13) trust copy: normal criticism is not auto-hidden.
  check("13) trust copy present (criticism not auto-hidden)", cc.includes("neverHideCriticism") && control.includes("neverHideCriticism") && rep.includes("critNote"));

  // 14) Accounts reconnect CTA only when needed.
  check("14) reconnect CTA gated on account state", /lastError === "token_expired"/.test(acctDetail) && /!ok \?[\s\S]*?ctaReconnect/.test(cc));

  // 15) Control Center explains auto protection in plain language.
  check("15) Control Center human explainer", control.includes("controlExplainer") && sk.includes("Jasne škodlivé komentáre môže Guardora skryť automaticky"));

  // 16) Active tab excludes resolved/history/dry-run.
  const active = queueTabStates("active")!;
  check("16) Active excludes executed/no_action/approved/monitor/dry_run", ["executed", "no_action", "approved", "monitor", "dry_run"].every((s) => !active.includes(s as never)));

  // 17) no wide tables in the mobile-critical product pages.
  check("17) Command Center + Reputation have no <table>", !cc.includes("<table") && !rep.includes("<table"));

  // 18) Advanced sections collapsed by default (no `open` attr on details).
  check("18) Advanced <details> collapsed by default", cc.includes("<details") && !cc.includes("<details open") && aqDetail.includes("<details") && !aqDetail.includes("<details open"));

  // 19) i18n SK/EN/DE keys present.
  check("19) i18n keys present (SK/EN/DE)", en.includes("onbConnectFirst") && sk.includes("noDataTitle") && de.includes("connectAccount") && sk.includes("controlExplainer"));

  // 20) state truth (normal criticism never risky/hidden by classification).
  check("20) state truth: normal_criticism never risky", sentimentBucket({ categories: ["normal_criticism"], sentiment: "negative", riskLevel: "critical" }) !== "risky");

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Product polish & demo readiness`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
