/**
 * Child Safety Evidence Management V1 — UI/source test (no DB / browser / network).
 *
 *   1. PURE view-model — integrity tone + byte formatting.
 *   2. i18n parity — the evidence copy block is localized in en/sk/de (types, sources, integrity, custody).
 *   3. SOURCE INVARIANTS — the evidence panel hides upload/verify/seal behind canManage and has NO edit/
 *      delete affordance; server actions are same-origin + manage-checked + return safe codes + revalidate;
 *      the binary routes gate on resolveEvidenceActor; storage keys/paths are never exposed anywhere; the
 *      ZIP writer is deterministic (no wall clock); no raw content leaks.
 *
 * Run: pnpm child-safety-evidence-ui:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { integrityTone, formatBytes } from "../src/app/dashboard/child-safety/reviewer/reviewer-view";
import { REVIEWER_COPY } from "../src/app/dashboard/child-safety/reviewer/reviewer-i18n";
import { ChildSafetyEvidenceType, ChildSafetyEvidenceSource, EvidenceIntegrityStatus, ChildSafetyEvidenceCustodyEventType } from "@guardora/core";
import type { Locale } from "../src/i18n/config";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "src");
const read = (rel: string): string => readFileSync(join(WEB, rel), "utf8");
const readDb = (rel: string): string => readFileSync(join(HERE, "..", "..", "..", "packages", "db", "src", rel), "utf8");
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const LOCALES: Locale[] = ["en", "sk", "de"];

function main() {
  console.log("\n1. view-model");
  check("★ integrityTone: verified→ok, failed→danger, unverified→neutral", integrityTone("verified") === "ok" && integrityTone("failed") === "danger" && integrityTone("unverified") === "neutral");
  check("★ formatBytes: B / KB / MB / null", formatBytes(500) === "500 B" && formatBytes(2048) === "2.0 KB" && formatBytes(5 * 1024 * 1024) === "5.0 MB" && formatBytes(null) === "—");

  console.log("\n2. i18n parity (evidence block)");
  check("★ every evidence type is localized in all locales", LOCALES.every((l) => Object.values(ChildSafetyEvidenceType).every((tp) => tp === "system" || !!REVIEWER_COPY[l].evidence.typeLabel[tp])));
  check("★ every evidence source is localized", LOCALES.every((l) => Object.values(ChildSafetyEvidenceSource).every((sc) => !!REVIEWER_COPY[l].evidence.sourceLabel[sc])));
  check("★ every integrity status is localized", LOCALES.every((l) => Object.values(EvidenceIntegrityStatus).every((st) => !!REVIEWER_COPY[l].evidence.integrityLabel[st])));
  check("★ every custody event type is localized", LOCALES.every((l) => Object.values(ChildSafetyEvidenceCustodyEventType).every((ev) => !!REVIEWER_COPY[l].evidence.custodyLabel[ev])));

  console.log("\n3. evidence panel — gating + no edit/delete");
  const panel = read("app/dashboard/child-safety/reviewer/[incidentId]/evidence-panel.tsx");
  const detail = read("app/dashboard/child-safety/reviewer/[incidentId]/page.tsx");
  check("★ detail wires the Evidence tab, gated by canManageEvidence", /<EvidencePanel[\s\S]*canManage=\{canManageEvidence\}/.test(detail) && /canManageChildSafetyEvidence\(session\.role\)/.test(detail));
  check("★ upload form is rendered ONLY when canManage", /canManage\s*\?\s*\(\s*<form action=\{upload\}/.test(panel));
  check("★ verify + seal actions are manager-gated", /canManage\s*\?\s*\(/.test(panel) && /action=\{verify\}/.test(panel) && /action=\{seal\}/.test(panel));
  check("★ NO edit / delete affordance in the panel", !/editEvidence|deleteEvidence|removeEvidence|"Delete"|"Edit"/i.test(strip(panel)));
  check("★ preview + download use authorized API routes", /\/evidence\/\$\{it\.id\}\/preview/.test(panel) && /\/evidence\/\$\{it\.id\}\/download/.test(panel));
  check("★ export uses the export route (manager area)", /\/evidence\/export/.test(panel));

  console.log("\n4. server actions fail-closed + safe");
  const actions = strip(read("app/dashboard/child-safety/reviewer/[incidentId]/evidence-actions.ts"));
  check("★ evidence-actions is a server module", /^\s*"use server"/.test(read("app/dashboard/child-safety/reviewer/[incidentId]/evidence-actions.ts")));
  check("★ mutations require same-origin + manage permission", /isSameOrigin\(\)/.test(actions) && /canManageChildSafetyEvidence\(s\.role\)/.test(actions));
  check("★ actions return safe codes + revalidate; no raw message/stack", /error: "forbidden"/.test(actions) && /revalidatePath/.test(actions) && !/error:\s*e\.message/.test(actions) && !/\.stack/.test(actions));

  console.log("\n5. routes gate + never expose storage keys");
  const dl = strip(read("app/api/v1/child-safety/reviewer/evidence/[evidenceId]/download/route.ts"));
  const pv = strip(read("app/api/v1/child-safety/reviewer/evidence/[evidenceId]/preview/route.ts"));
  const ex = strip(read("app/api/v1/child-safety/reviewer/incidents/[incidentId]/evidence/export/route.ts"));
  check("★ download/preview/export all gate on resolveEvidenceActor", /resolveEvidenceActor\(\)/.test(dl) && /resolveEvidenceActor\(\)/.test(pv) && /resolveEvidenceActor\(\)/.test(ex));
  check("★ export additionally requires evidence MANAGE", /canManageChildSafetyEvidence\(actor\.role\)/.test(ex));
  check("★ download sets nosniff + attachment (safe filename)", /x-content-type-options.*nosniff/.test(dl) && /attachment; filename/.test(dl));

  console.log("\n6. no storage-key/path leakage + deterministic zip");
  const svc = strip(readDb("child-safety-evidence.ts"));
  check("★ evidence service PUBLIC_SELECT excludes storageKey", /PUBLIC_SELECT/.test(svc) && !/PUBLIC_SELECT[\s\S]*storageKey:\s*true/.test(svc));
  check("★ panel + routes never reference storageKey / storage path", !/storageKey|storagePath|storeRoot/.test(strip(panel)) && !/storageKey/.test(dl) && !/storageKey/.test(pv));
  const zip = strip(readDb("deterministic-zip.ts"));
  check("★ ZIP writer is DETERMINISTIC (fixed DOS time, no Date.now/new Date)", /DOS_TIME/.test(zip) && !/Date\.now\(\)/.test(zip) && !/new Date\(/.test(zip));
  check("★ no raw-content markers in the evidence UI", !/transcript|messageBody|rawContent|detectorPayload/.test(strip(panel)));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Evidence Management UI V1: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
