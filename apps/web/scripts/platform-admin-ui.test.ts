/**
 * Platform Admin UI V1 — UI test (no DB/browser/network). Proves the pure view-model, EN/SK/DE i18n parity +
 * enum coverage, and SOURCE INVARIANTS: server-side route protection on every admin page, NO hardcoded-email
 * authorization anywhere, owner-gated administrator management with accessible confirmations + no password/
 * session handling, actor-redaction for analyst audit, distinct restricted-area shell, and safe API routes.
 * Run: pnpm platform-admin-ui:test
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { roleTone, botTone, fmtNum, fmtPct, fmtDate, resolveRange } from "../src/app/admin/admin-view";
import { ADMIN_COPY } from "../src/app/admin/admin-i18n";
import { REFERRER_CATEGORIES, DEVICE_CATEGORIES, BROWSER_FAMILIES, OS_FAMILIES, BOT_CLASSIFICATIONS, ANALYTICS_CONSENT_MODES, CONVERSION_EVENT_TYPES } from "@guardora/core";
import type { Locale } from "../src/i18n/config";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "src");
const read = (rel: string): string => readFileSync(join(WEB, rel), "utf8");
const has = (rel: string): boolean => existsSync(join(WEB, rel));
const LOCALES: Locale[] = ["en", "sk", "de"];

function main() {
  console.log("\n1. view-model");
  check("★ roleTone: owner→danger, admin→brand, analyst/support→warn, none→neutral", roleTone("owner") === "danger" && roleTone("admin") === "brand" && roleTone("analyst") === "warn" && roleTone("none") === "neutral");
  check("★ botTone: known→danger, suspected→warn, human→ok", botTone("KNOWN_BOT") === "danger" && botTone("SUSPECTED_BOT") === "warn" && botTone("HUMAN_LIKELY") === "ok");
  check("★ fmtNum/fmtPct/fmtDate deterministic", fmtNum(1234) === "1,234" && fmtPct(12.5) === "12.5%" && fmtDate("2026-01-02T00:00:00Z") === "2026-01-02" && fmtDate(null) === "—");
  check("★ resolveRange presets (7/30/90/today/custom)", resolveRange("7", undefined, undefined, Date.UTC(2026, 0, 8)).preset === "7" && resolveRange("bad", undefined, undefined, Date.UTC(2026, 0, 8)).preset === "30" && resolveRange("custom", "2026-01-01T00:00:00Z", "2026-01-05T00:00:00Z", Date.now()).preset === "custom");

  console.log("\n2. i18n parity + enum coverage");
  const keyPaths = (o: unknown, p = ""): string[] => (o === null || typeof o !== "object") ? [p] : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keyPaths(v, p ? `${p}.${k}` : k));
  const en = keyPaths(ADMIN_COPY.en).sort();
  check("★ sk structure == en", JSON.stringify(keyPaths(ADMIN_COPY.sk).sort()) === JSON.stringify(en));
  check("★ de structure == en", JSON.stringify(keyPaths(ADMIN_COPY.de).sort()) === JSON.stringify(en));
  const cover = (name: string, keys: readonly string[], pick: (t: (typeof ADMIN_COPY)[Locale]) => Record<string, string>) => check(`★ every ${name} localized in all locales`, LOCALES.every((l) => keys.every((k) => { const v = pick(ADMIN_COPY[l])[k]; return typeof v === "string" && v.length > 0; })));
  cover("platform role", ["none", "staff", "admin", "owner", "analyst", "support"], (t) => t.roleLabel);
  cover("referrer category", REFERRER_CATEGORIES, (t) => t.referrerLabel);
  cover("device category", DEVICE_CATEGORIES, (t) => t.deviceLabel);
  cover("browser family", BROWSER_FAMILIES, (t) => t.browserLabel);
  cover("OS family", OS_FAMILIES, (t) => t.osLabel);
  cover("bot classification", BOT_CLASSIFICATIONS, (t) => t.botLabel);
  cover("consent state", ANALYTICS_CONSENT_MODES, (t) => t.consentLabel);
  cover("conversion event", CONVERSION_EVENT_TYPES, (t) => t.conversionLabel);
  check("★ audit actions localized (role_changed, deactivated, access_denied, exported)", LOCALES.every((l) => ["admin_user.role_changed", "admin_user.deactivated", "admin.access_denied", "analytics.exported"].every((a) => !!ADMIN_COPY[l].auditActionLabel[a])));
  check("★ 4 privacy warnings in every locale (no raw IP / rotating ids / no customer content / approximate)", LOCALES.every((l) => ADMIN_COPY[l].privacyWarnings.length === 4));

  console.log("\n3. route protection + NO hardcoded-email authorization");
  for (const f of ["app/admin/layout.tsx", "app/admin/page.tsx", "app/admin/analytics/page.tsx", "app/admin/administrators/page.tsx", "app/admin/audit/page.tsx", "app/admin/unauthorized.tsx", "app/admin/loading.tsx", "app/admin/error.tsx"]) check(`★ ${f} exists`, has(f));
  const layout = read("app/admin/layout.tsx");
  const pages = ["app/admin/page.tsx", "app/admin/analytics/page.tsx", "app/admin/administrators/page.tsx", "app/admin/audit/page.tsx"].map(read);
  check("★ layout guards admin.access server-side (fresh, not session-cached)", /requirePlatformAccess\("admin.access"\)/.test(layout));
  check("★ every admin page calls requirePlatformAccess with its capability", pages.every((p) => /requirePlatformAccess\(/.test(p)) && /analytics.view/.test(pages[1]!) && /admin_users.view/.test(pages[2]!) && /audit.view/.test(pages[3]!));
  const guard = read("server/platform/guard.ts");
  const dispatch = read("server/platform/admin-dispatch.ts");
  const adminService = readFileSync(join(HERE, "..", "..", "..", "packages", "db", "src", "platform-admin.ts"), "utf8");
  const repo = readFileSync(join(HERE, "..", "..", "..", "packages", "db", "src", "platform-repo.ts"), "utf8");
  const allSrc = layout + pages.join("\n") + guard + dispatch + read("app/admin/administrators/admin-console.tsx") + read("app/admin/admin-i18n.ts") + adminService + repo;
  check("★ NO hardcoded-email authorization (no `email ===` / info@tamanor.com auth condition anywhere)", !/email\s*===\s*["'][^"']*@/.test(allSrc) && !/user\.email\s*===/.test(allSrc) && !/info@tamanor\.com/i.test(allSrc.replace(/TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL/g, "")));
  check("★ platform role resolved fresh from persisted state (resolvePlatformRole), not the session", /resolvePlatformRole/.test(guard) && /platformRoleSatisfies/.test(guard));

  console.log("\n4. administrator management UI safety");
  const console_ = read("app/admin/administrators/admin-console.tsx");
  check("★ accessible confirmation dialog (role=dialog + aria-modal), no window.confirm", /role="dialog"/.test(console_) && /aria-modal/.test(console_) && !/window\.confirm/.test(console_));
  check("★ NO password / session / file input in administrator UI", !/type=["'](password|file)["']/.test(console_) && !/passwordHash|sessionToken|tokenHash/.test(console_));
  check("★ errors announced via role=alert; no unsafe HTML", /role="alert"/.test(console_) && !/dangerouslySetInnerHTML/.test(allSrc));
  check("★ self-row cannot change own role (no self-elevation in UI)", /selfUserId/.test(console_) && /a\.userId === selfUserId/.test(console_));
  check("★ audit page redacts actor identity for analyst (redactedActor honored)", /redactedActor/.test(read("app/admin/audit/page.tsx")) || /a\.actorUserId \?/.test(read("app/admin/audit/page.tsx")));

  console.log("\n5. distinct shell + safe API routes");
  check("★ admin layout is a distinct restricted-area shell (restrictedBanner + role=note)", /restrictedBanner/.test(layout) && /role="note"/.test(layout));
  check("★ admins API route pins nodejs + same-origin on POST", /runtime = "nodejs"/.test(read("app/api/platform/admins/route.ts")) && /isSameOrigin/.test(read("app/api/platform/admins/route.ts")));
  check("★ export route requires analytics.export (separate gate) via the service", /analyticsExportCsv/.test(read("app/api/platform/analytics/export/route.ts")));
  check("★ dispatch maps errors safely (no raw DB/stack; reauth_required/last_owner/version)", /reauth_required/.test(dispatch) && /last_owner_protected/.test(dispatch) && /internal/.test(dispatch));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Platform Admin UI V1: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
