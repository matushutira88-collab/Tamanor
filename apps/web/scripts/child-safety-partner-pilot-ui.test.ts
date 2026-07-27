/**
 * Child Safety Partner Pilot UI V1 — UI test (no DB/browser/network). Proves the pure view-model, EN/SK/DE
 * i18n parity + FULL enum coverage (no raw backend enum is ever rendered), the seven privacy warnings, and
 * SOURCE INVARIANTS: permission gating, NO raw-content field, NO private-key upload, accessible confirmation
 * dialog (no window.confirm), semantic tables, no unsafe HTML/eval, browser-safe core subpath imports in
 * client components, and safe API routes (session + same-origin). Run: pnpm child-safety-partner-pilot-ui:test
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pilotStatusTone, readinessTone, severityTone, checkStatusTone, testResultTone, assessmentTone, statusGlyph, fmtDate } from "../src/app/dashboard/child-safety/integrations/pilots/pilot-view";
import { PILOT_COPY } from "../src/app/dashboard/child-safety/integrations/pilots/pilot-i18n";
import {
  PILOT_STATUSES, PILOT_CHECK_TYPES, PILOT_CHECK_STATUSES, READINESS_STATES, READINESS_BLOCKING_CODES,
  PILOT_ALERT_TYPES, PILOT_ALERT_SEVERITIES, PILOT_CONTACT_ROLES, PILOT_TEST_TYPES, PILOT_TEST_RESULTS,
  PILOT_ASSESSMENT_STATUSES, PILOT_VOLUME_BANDS,
} from "@guardora/core";
import type { Locale } from "../src/i18n/config";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "src", "app", "dashboard", "child-safety", "integrations", "pilots");
const APIDIR = join(HERE, "..", "src", "app", "api", "v1", "child-safety", "integrations", "pilots");
const SRVDIR = join(HERE, "..", "src", "server", "child-safety");
const read = (base: string, rel: string): string => readFileSync(join(base, rel), "utf8");
const has = (base: string, rel: string): boolean => existsSync(join(base, rel));
const LOCALES: Locale[] = ["en", "sk", "de"];

function main() {
  console.log("\n1. view-model tones");
  check("★ pilotStatusTone: active→ok, suspended/terminated→danger, draft→neutral", pilotStatusTone("PILOT_ACTIVE") === "ok" && pilotStatusTone("SUSPENDED") === "danger" && pilotStatusTone("TERMINATED") === "danger" && pilotStatusTone("DRAFT") === "neutral");
  check("★ readinessTone: READY→ok, BLOCKED→danger, NOT_EVALUATED→neutral", readinessTone("READY") === "ok" && readinessTone("BLOCKED") === "danger" && readinessTone("NOT_EVALUATED") === "neutral");
  check("★ severityTone: CRITICAL→danger, WARNING→warn, INFO→brand", severityTone("CRITICAL") === "danger" && severityTone("WARNING") === "warn" && severityTone("INFO") === "brand" && severityTone(null) === "neutral");
  check("★ checkStatusTone: PASSED→ok, WAIVED→brand, FAILED→danger", checkStatusTone("PASSED") === "ok" && checkStatusTone("WAIVED") === "brand" && checkStatusTone("FAILED") === "danger");
  check("★ testResultTone: PASSED→ok, FAILED→danger, SKIPPED→neutral", testResultTone("PASSED") === "ok" && testResultTone("FAILED") === "danger" && testResultTone("SKIPPED") === "neutral");
  check("★ assessmentTone: APPROVED→ok, REJECTED→danger", assessmentTone("APPROVED") === "ok" && assessmentTone("REJECTED") === "danger");
  check("★ statusGlyph gives a non-color glyph per tone (a11y: not color-only)", new Set(["ok", "warn", "danger", "brand", "neutral"].map((tn) => statusGlyph(tn as never))).size === 5);
  check("★ fmtDate deterministic UTC + em-dash fallback", fmtDate("2026-07-27T09:35:00.000Z") === "2026-07-27" && fmtDate(null) === "—");

  console.log("\n2. i18n parity (en/sk/de)");
  const keyPaths = (o: unknown, p = ""): string[] => (o === null || typeof o !== "object") ? [p] : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keyPaths(v, p ? `${p}.${k}` : k));
  const en = keyPaths(PILOT_COPY.en).sort();
  check("★ sk structure == en", JSON.stringify(keyPaths(PILOT_COPY.sk).sort()) === JSON.stringify(en));
  check("★ de structure == en", JSON.stringify(keyPaths(PILOT_COPY.de).sort()) === JSON.stringify(en));

  console.log("\n3. full enum coverage (no raw backend enum rendered)");
  const cover = (name: string, arr: readonly string[], pick: (t: (typeof PILOT_COPY)[Locale]) => Record<string, string>) =>
    check(`★ every ${name} localized in all locales`, LOCALES.every((l) => arr.every((k) => { const v = pick(PILOT_COPY[l])[k]; return typeof v === "string" && v.length > 0; })));
  cover("pilot status", PILOT_STATUSES, (t) => t.statusLabel);
  cover("check type", PILOT_CHECK_TYPES, (t) => t.checkLabel);
  cover("check status", PILOT_CHECK_STATUSES, (t) => t.checkStatusLabel);
  cover("readiness state", READINESS_STATES, (t) => t.readinessLabel);
  cover("readiness blocking code", READINESS_BLOCKING_CODES, (t) => t.blockingLabel);
  cover("alert type", PILOT_ALERT_TYPES, (t) => t.alertTypeLabel);
  cover("severity", PILOT_ALERT_SEVERITIES, (t) => t.severityLabel);
  cover("contact role", PILOT_CONTACT_ROLES, (t) => t.contactRoleLabel);
  cover("test type", PILOT_TEST_TYPES, (t) => t.testTypeLabel);
  cover("test result", PILOT_TEST_RESULTS, (t) => t.testResultLabel);
  cover("assessment status", PILOT_ASSESSMENT_STATUSES, (t) => t.assessmentLabel);
  cover("scope band", PILOT_VOLUME_BANDS, (t) => t.bandLabel);
  check("★ all lifecycle actions localized in all locales", LOCALES.every((l) => ["submit", "begin_review", "request_changes", "approve_sandbox", "activate_sandbox", "start_readiness", "mark_ready", "activate", "pause", "resume", "suspend", "terminate", "evaluate", "run_test"].every((a) => !!PILOT_COPY[l].actionLabel[a])));

  console.log("\n4. privacy warnings + confirmations");
  check("★ 7 privacy warnings in every locale (raw-content + private-key + no-auto-contact + sandbox/prod)", LOCALES.every((l) => PILOT_COPY[l].privacyWarnings.length === 7));
  check("★ raw-content + private-key + no-auto-contact warnings present (EN)", /raw communications/i.test(PILOT_COPY.en.privacyWarnings.join(" ")) && /private key/i.test(PILOT_COPY.en.privacyWarnings.join(" ")) && /contacted automatically/i.test(PILOT_COPY.en.privacyWarnings.join(" ")));
  check("★ activate/suspend/terminate/waive confirmations localized", LOCALES.every((l) => PILOT_COPY[l].confirm.activate && PILOT_COPY[l].confirm.suspend && PILOT_COPY[l].confirm.terminate && PILOT_COPY[l].confirm.waive));

  console.log("\n5. source invariants (UI)");
  for (const f of ["page.tsx", "pilot-list-console.tsx", "pilot-i18n.ts", "pilot-view.ts", "loading.tsx", "error.tsx", "unauthorized.tsx", "[pilotId]/page.tsx", "[pilotId]/pilot-detail-controls.tsx"]) check(`★ ${f} exists`, has(DIR, f));
  const list = read(DIR, "page.tsx");
  const detail = read(DIR, "[pilotId]/page.tsx");
  const controls = read(DIR, "[pilotId]/pilot-detail-controls.tsx");
  const listConsole = read(DIR, "pilot-list-console.tsx");
  const allUi = list + detail + controls + listConsole + read(DIR, "pilot-i18n.ts");
  check("★ permission gating present (canViewChildSafetyPilot on both pages)", /canViewChildSafetyPilot/.test(list) && /canViewChildSafetyPilot/.test(detail));
  check("★ detail computes caps for manage/review/activate/suspend/audit", /canManageChildSafetyPilot/.test(detail) && /canActivateChildSafetyPilot/.test(detail) && /canSuspendChildSafetyPilot/.test(detail) && /canViewChildSafetyPilotAudit/.test(detail));
  check("★ NO raw-content / message / transcript input field", !/name=["'](message|content|transcript|body)["']/i.test(allUi) && !/placeholder=["'][^"']*message/i.test(allUi));
  // The i18n copy WARNS against uploading a private key (good); assert there is no actual key-material INPUT
  // field or file upload anywhere in the interactive UI.
  const interactive = list + detail + controls + listConsole;
  check("★ NO private-key / key-material input field or file upload in the pilot UI (warning prose is allowed)", !/type=["']file["']/.test(interactive) && !/privateKey|publicKeyBase64|keyMaterial|PRIVATE KEY/i.test(interactive));
  check("★ accessible confirmation dialog (role=dialog + aria-modal), NOT window.confirm", /role="dialog"/.test(controls) && /aria-modal/.test(controls) && !/window\.confirm/.test(controls));
  check("★ errors announced via role=alert", /role="alert"/.test(controls) && /role="alert"/.test(listConsole));
  check("★ no unsafe HTML / eval (dangerouslySetInnerHTML / eval absent)", !/dangerouslySetInnerHTML|(^|[^.])\beval\(/.test(allUi));
  check("★ client components import the browser-safe core subpath (not the @guardora/core barrel)", /@guardora\/core\/child-safety-partner-pilot/.test(controls) && !/from ["']@guardora\/core["']/.test(controls) && !/from ["']@guardora\/core["']/.test(listConsole));
  check("★ semantic tables: scope=col headers + <caption> on data tables", (detail.match(/scope="col"/g)?.length ?? 0) >= 3 && /<caption/.test(detail) && /<caption/.test(list));
  check("★ status not conveyed by color alone (statusGlyph rendered with aria-hidden)", /statusGlyph/.test(list) && /aria-hidden/.test(list));
  check("★ loading uses aria-busy/aria-live", /aria-busy/.test(read(DIR, "loading.tsx")));

  console.log("\n6. source invariants (API + boundary)");
  for (const f of ["route.ts", "[pilotId]/route.ts", "[pilotId]/events/route.ts", "alerts/route.ts", "contacts/[partnerId]/route.ts"]) check(`★ API ${f} exists`, has(APIDIR, f));
  const routes = ["route.ts", "[pilotId]/route.ts", "[pilotId]/events/route.ts", "alerts/route.ts", "contacts/[partnerId]/route.ts"].map((f) => read(APIDIR, f)).join("\n");
  check("★ every pilot route pins the nodejs runtime + force-dynamic", (routes.match(/runtime = "nodejs"/g)?.length ?? 0) === 5 && (routes.match(/force-dynamic/g)?.length ?? 0) === 5);
  const boundary = read(SRVDIR, "partner-pilot.ts");
  const dispatch = read(SRVDIR, "partner-pilot-dispatch.ts");
  check("★ boundary enforces same-origin on mutations + resolves a session actor", /isSameOrigin/.test(boundary) && /getSession/.test(boundary));
  check("★ dispatch rejects prohibited body keys (privateKey/message/etc.) + never selects a client tenant", /FORBIDDEN_BODY_KEYS/.test(dispatch) && /prohibited_field/.test(dispatch) && !/tenantId:\s*(b|body)\./.test(dispatch));
  check("★ dispatch maps errors safely (no raw DB/stack leakage)", /mapError/.test(dispatch) && /return err\(500, "internal"\)/.test(dispatch));
  check("★ dispatch NEVER exposes a status field for client selection (transitions go through the service)", /transitionPartnerPilot/.test(dispatch) && !/status:\s*b\.status/.test(dispatch));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Partner Pilot UI V1: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
