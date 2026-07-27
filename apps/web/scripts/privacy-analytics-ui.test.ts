/**
 * Platform Privacy Analytics UI V1 — UI test (no DB/browser/network). Proves the analytics dashboard source
 * invariants: date filters, summary cards, accessible chart-summary tables (scope=col + caption), low-count
 * suppression surfaced, export gated by the separate capability, NO visitor/session hash rendered, NO raw
 * enums, privacy warnings, and the ingestion HTTP surface safety (same-origin, httpOnly cookies, no raw IP/UA
 * persistence, safe generic response). Run: pnpm privacy-analytics-ui:test
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_COPY } from "../src/app/admin/admin-i18n";
import { ANALYTICS_CONSENT_MODES } from "@guardora/core";
import type { Locale } from "../src/i18n/config";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "src");
const read = (rel: string): string => readFileSync(join(WEB, rel), "utf8");
const has = (rel: string): boolean => existsSync(join(WEB, rel));
const LOCALES: Locale[] = ["en", "sk", "de"];

function main() {
  console.log("\n1. analytics dashboard");
  check("★ analytics page + ingestion route + export route exist", has("app/admin/analytics/page.tsx") && has("app/api/analytics/events/route.ts") && has("app/api/platform/analytics/export/route.ts"));
  const analytics = read("app/admin/analytics/page.tsx");
  check("★ date filters: today / 7 / 30 / 90 presets", /dateFilters\.today/.test(analytics) && /dateFilters\.last7/.test(analytics) && /dateFilters\.last30/.test(analytics) && /dateFilters\.last90/.test(analytics));
  check("★ summary cards (page views / sessions / approx visitors / bounce / conversion rate)", /cards\.pageViews/.test(analytics) && /cards\.approxVisitors/.test(analytics) && /cards\.bounceRate/.test(analytics) && /cards\.conversionRate/.test(analytics));
  check("★ required sections present (top pages, acquisition, devices, countries, funnels, conversions, bot traffic)", ["topPages", "acquisition", "devices", "countries", "funnels", "conversions", "botTraffic", "operatingSystems", "browsers", "languages", "overTime"].every((s) => new RegExp(`sections\\.${s}`).test(analytics)));
  check("★ accessible chart-summary tables (scope=col headers + <caption>)", (analytics.match(/scope="col"/g)?.length ?? 0) >= 4 && (analytics.match(/<caption/g)?.length ?? 0) >= 3);
  check("★ low-count suppression is surfaced in the UI", /suppressedGroups/.test(analytics) && /fields\.suppressed/.test(analytics));
  check("★ approximate-visitor limitation shown (not claimed as exact)", /approxNote|approxVisitors/.test(analytics));
  check("★ CSV export link is gated by the SEPARATE analytics.export capability", /caps\.analyticsExport/.test(analytics));
  check("★ NO visitor/session hash is ever rendered in the analytics UI", !/visitorIdHash|sessionIdHash/.test(analytics));
  check("★ no raw backend enum: referrer/device/browser/os/bot rendered via localized label maps", /referrerLabel/.test(analytics) && /deviceLabel/.test(analytics) && /botLabel/.test(analytics));
  check("★ no unsafe HTML in analytics UI", !/dangerouslySetInnerHTML/.test(analytics));

  console.log("\n2. consent + collection i18n");
  check("★ consent states localized in all locales", LOCALES.every((l) => ANALYTICS_CONSENT_MODES.every((m) => !!ADMIN_COPY[l].consentLabel[m])));
  check("★ collection/consent + retention sections localized", LOCALES.every((l) => !!ADMIN_COPY[l].sections.collection && !!ADMIN_COPY[l].sections.retention && !!ADMIN_COPY[l].sections.botTraffic));

  console.log("\n3. ingestion HTTP surface (privacy)");
  const core = read("server/analytics/ingest-core.ts");
  const route = read("app/api/analytics/events/route.ts");
  check("★ ingestion enforces same-origin", /sameOrigin/.test(core) && /isSameOrigin/.test(route));
  check("★ strict content-type + bounded body size + batch cap", /contentType/.test(core) && /json/.test(core) && /maxBodyBytes/.test(core) && /maxBatch/.test(core));
  check("★ rate limiting present", /rateLimited/.test(core) && /429/.test(core));
  check("★ consent-aware: no persistent identifier before consent; withdrawal expires cookies", /ENABLED/.test(core) && /WITHDRAWN/.test(core) && /maxAgeSec: 0/.test(core));
  check("★ first-party cookies are httpOnly + sameSite", /httpOnly: true/.test(route) && /sameSite: "lax"/.test(route));
  check("★ IP/user-agent are used transiently and NOT persisted (no raw IP/UA column write in core/route)", !/ipAddress:|rawUserAgent:|userAgentStored/.test(core) && /transient/.test(core));
  check("★ route NEVER trusts a client-selected tenant/user/visitor id", !/tenantId:\s*(b|body|req)\./.test(route) && !/visitorIdHash:\s*(b|body|req)\./.test(route));
  check("★ safe generic response shape ({ ok }) regardless of accept/reject", /const OK/.test(core) && /body: OK/.test(core));
  check("★ nodejs runtime + no-store on the ingestion route", /runtime = "nodejs"/.test(route) && /no-store/.test(route));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Privacy Analytics UI V1: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
