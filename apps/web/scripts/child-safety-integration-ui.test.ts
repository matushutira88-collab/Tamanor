/**
 * Child Safety Integration UI V1 — UI test (no DB/browser/network). Proves the pure view-model, EN/SK/DE
 * i18n parity, and SOURCE INVARIANTS: permission gating, LOCAL/SANDBOX labelling, NO raw-message field, NO
 * private-key upload (public key only), no window.confirm / unsafe HTML / eval, safe boundaries, and safe
 * API/server (gateway is signature-auth, management is session + same-origin). Run: pnpm child-safety-integration-ui:test
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installationStatusTone, keyStatusTone, resultCodeTone, isAcceptedResult, shortFingerprint, fmtDateTime } from "../src/app/dashboard/child-safety/integrations/integration-view";
import { INTEGRATION_COPY } from "../src/app/dashboard/child-safety/integrations/integration-i18n";
import { INTEGRATION_ERROR_CODES } from "@guardora/core";
import type { Locale } from "../src/i18n/config";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "src", "app", "dashboard", "child-safety", "integrations");
const read = (rel: string): string => readFileSync(join(DIR, rel), "utf8");
const has = (rel: string): boolean => existsSync(join(DIR, rel));
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const LOCALES: Locale[] = ["en", "sk", "de"];

function main() {
  console.log("\n1. view-model");
  check("★ installationStatusTone: active→ok, suspended→warn, revoked→danger", installationStatusTone("active") === "ok" && installationStatusTone("suspended") === "warn" && installationStatusTone("revoked") === "danger");
  check("★ keyStatusTone: active→ok, rotating→warn, revoked→danger", keyStatusTone("active") === "ok" && keyStatusTone("rotating") === "warn" && keyStatusTone("revoked") === "danger");
  check("★ resultCodeTone: accepted→ok, duplicate→neutral, rate_limited→warn, errors→danger", resultCodeTone("SIGNAL_ACCEPTED") === "ok" && resultCodeTone("SIGNAL_DUPLICATE") === "neutral" && resultCodeTone("RATE_LIMITED") === "warn" && resultCodeTone("SIGNATURE_INVALID") === "danger");
  check("★ isAcceptedResult: accepted+duplicate true, errors false", isAcceptedResult("SIGNAL_ACCEPTED") && isAcceptedResult("SIGNAL_DUPLICATE") && !isAcceptedResult("SIGNATURE_INVALID"));
  check("★ shortFingerprint truncates", shortFingerprint("a".repeat(64)).includes("…") && shortFingerprint("short") === "short");
  check("★ fmtDateTime deterministic UTC", fmtDateTime("2026-07-27T09:35:00.000Z") === "2026-07-27 09:35" && fmtDateTime(null) === "—");

  console.log("\n2. i18n parity (en/sk/de)");
  const keyPaths = (o: unknown, p = ""): string[] => (o === null || typeof o !== "object") ? [p] : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keyPaths(v, p ? `${p}.${k}` : k));
  const en = keyPaths(INTEGRATION_COPY.en).sort();
  check("★ sk structure == en", JSON.stringify(keyPaths(INTEGRATION_COPY.sk).sort()) === JSON.stringify(en));
  check("★ de structure == en", JSON.stringify(keyPaths(INTEGRATION_COPY.de).sort()) === JSON.stringify(en));
  check("★ SIGNAL_ACCEPTED + key error codes localized in all locales", LOCALES.every((l) => ["SIGNAL_ACCEPTED", "SIGNATURE_INVALID", "NONCE_REPLAYED", "RATE_LIMITED"].every((c) => !!INTEGRATION_COPY[l].resultLabel[c])));
  check("★ every privacy/no-surveillance notice present in all locales", LOCALES.every((l) => { const n = INTEGRATION_COPY[l].notices; return n.privacy && n.noRawContent && n.noCredentials && n.noBypass && n.notSurveillance && n.noPrivateKey && n.riskNotGuilt && n.noAutoContact; }));
  check("★ sandbox banner present in all locales", LOCALES.every((l) => INTEGRATION_COPY[l].sandboxBanner.length > 0));

  console.log("\n3. permission gating + sandbox labelling");
  const page = read("page.tsx");
  check("★ page gates on canViewChildSafetyIntegration → <Unauthorized>", /canViewChildSafetyIntegration\(session\.role\)/.test(page) && /<Unauthorized/.test(page));
  check("★ LOCAL/SANDBOX indicator is rendered", /sandboxBanner/.test(page) && /🧪/.test(page));
  check("★ key management gated by keys permission; sandbox by sandbox permission", /canManageChildSafetyIntegrationKeys/.test(page) && /canUseChildSafetyIntegrationSandbox/.test(page));

  console.log("\n4. no raw content, no private-key upload, no unsafe/executable content");
  const console_ = read("integration-console.tsx");
  const allClient = [console_, read("integration-view.ts")].map(strip).join("\n");
  check("★ NO message/content/transcript field anywhere in the console", !/message|transcript|rawContent|messageBody|attachment|screenshot/i.test(strip(console_).replace(/no.?raw|Raw|content-free/gi, "")));
  check("★ the ONLY key input is a PUBLIC key (base64 SPKI) — never a private key", /publicKeyBase64/.test(console_) && !/privateKey|private_key|privateKeyPem/i.test(console_));
  check("★ NO window.confirm", ["page.tsx", "integration-console.tsx", "integration-view.ts"].every((f) => !/window\.confirm/.test(strip(read(f)))));
  check("★ NO dangerouslySetInnerHTML", ["page.tsx", "integration-console.tsx"].every((f) => !/dangerouslySetInnerHTML/.test(read(f))));
  check("★ NO eval / new Function", !/\beval\s*\(|new\s+Function\s*\(/.test(allClient));
  check("★ synthetic signal builder uses bounded SELECTS (risk/confidence), not a free-text content box", /<select/.test(console_) && /PARTNER_RISK_TYPES/.test(console_));
  check("★ loading + error boundaries exist; error never renders raw error", has("loading.tsx") && has("error.tsx") && !/error\.message|\{error\}|error\.stack/.test(strip(read("error.tsx"))));

  console.log("\n5. API + server safety (source)");
  const server = readFileSync(join(HERE, "..", "src", "server", "child-safety", "integration.ts"), "utf8");
  const gatewayRoute = readFileSync(join(HERE, "..", "src", "app", "api", "v1", "child-safety", "integrations", "signals", "route.ts"), "utf8");
  const mgmtRoute = readFileSync(join(HERE, "..", "src", "app", "api", "v1", "child-safety", "integrations", "route.ts"), "utf8");
  check("★ GATEWAY route is signature-authenticated (reads x-cs-signature header; NO getSession)", /x-cs-signature/.test(gatewayRoute) && !/getSession/.test(gatewayRoute));
  check("★ management uses session + membership + view permission", /getSession\(\)/.test(server) && /membership\.findFirst/.test(server) && /canViewChildSafetyIntegration/.test(server));
  check("★ management mutations require same-origin", /isSameOrigin\(\)/.test(server));
  check("★ server returns SAFE codes, never raw message/stack", /"forbidden"/.test(server) && !/e\.message/.test(strip(server)) && !/\.stack/.test(strip(server)));
  check("★ sandbox NEVER persists the private key (in-memory, out of scope)", /never persisted/.test(server) && !/persist.*privateKey|store.*privateKey/i.test(server));
  check("★ gateway route wired to gatewayHandle", /gatewayHandle/.test(gatewayRoute) && /integrationAction/.test(mgmtRoute));

  console.log("\n6. error-code reference completeness");
  check("★ every stable error code is a known result label OR error-ref in EN", (INTEGRATION_ERROR_CODES as readonly string[]).every((c) => !!INTEGRATION_COPY.en.resultLabel[c] || !!INTEGRATION_COPY.en.errorRef[c]));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Integration UI V1: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
