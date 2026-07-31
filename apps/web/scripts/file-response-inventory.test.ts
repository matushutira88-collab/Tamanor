/**
 * FILE-RESPONSE SECURITY INVENTORY + GATE. Enumerates every API route that emits a file body (Content-
 * Disposition attachment/inline or a raw byte/CSV response), and asserts each is (a) in the reviewed inventory,
 * (b) authenticated/authorization-guarded, (c) sets a controlled Content-Type + Content-Disposition, and (d)
 * uses `nosniff` where it serves raw bytes/inline. Fails when a NEW file-emitting route appears outside the
 * inventory (a new public/automatic download path must be reviewed, not silently shipped).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const WEB = resolve(process.cwd()); // run under @guardora/web → apps/web
const API = join(WEB, "src/app/api");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.next/.test(e.name)) out.push(...walk(p)); }
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

const routeFiles = walk(API).map((f) => ({ f, rel: relative(WEB, f), s: readFileSync(f, "utf8") }));
// A route "emits a file" if it sets a content-disposition OR returns a CSV/octet body.
const emitsFile = (s: string) => /content-disposition/i.test(s) || /text\/csv|application\/octet-stream/i.test(s);
const fileRoutes = routeFiles.filter((r) => emitsFile(r.s)).map((r) => r.rel).sort();

// The REVIEWED inventory of legitimate authenticated file responses (route → required user action + auth owner).
const INVENTORY = [
  "src/app/api/export/route.ts",                                                             // tenant CSV export (session + ReportView)
  "src/app/api/platform/analytics/export/route.ts",                                          // platform CSV (session + platform role)
  "src/app/api/v1/child-safety/reviewer/analytics/export/route.ts",                          // reviewer analytics CSV
  "src/app/api/v1/child-safety/reviewer/incidents/[incidentId]/evidence/export/route.ts",     // reviewer evidence export
  "src/app/api/v1/child-safety/reviewer/evidence/[evidenceId]/download/route.ts",             // reviewer evidence download
  "src/app/api/v1/child-safety/reviewer/evidence/[evidenceId]/preview/route.ts",             // reviewer evidence preview (inline)
].sort();

// GATE: the set of file-emitting routes must EQUAL the reviewed inventory (no new/unknown download path).
const unknown = fileRoutes.filter((r) => !INVENTORY.includes(r));
const missing = INVENTORY.filter((r) => !fileRoutes.includes(r));
check("no NEW/unknown file-emitting route outside the reviewed inventory", unknown.length === 0, `unknown: ${unknown.join(", ")}`);
check("every inventory route still exists (update inventory if intentionally removed)", missing.length === 0, `missing: ${missing.join(", ")}`);

// Per-route guarantees.
// Auth may be inline OR delegated to a guarded service whose result status gates the response. `analyticsCsv`
// resolves a verified session + role in @/server/child-safety/analytics (401 unauthenticated / 403 forbidden).
const AUTH = /requireSession|getSession|resolveEvidenceActor|requirePlatform|actor\(|requireFamily|analyticsCsv|canManageChildSafetyEvidence/;
for (const rel of INVENTORY.filter((r) => fileRoutes.includes(r))) {
  const s = routeFiles.find((r) => r.rel === rel)!.s;
  check(`${rel}: authenticated/authorized (inline or delegated-service guard)`, AUTH.test(s));
  check(`${rel}: fails closed (401/403 or delegated r.status)`, /401|403|forbidden|unauthenticated|unauthorized/i.test(s) || /status:\s*r\.status/.test(s));
  check(`${rel}: sets Content-Type`, /content-type/i.test(s));
  const attachment = /content-disposition["'\s:]+[^\n]*attachment/i.test(s);
  const inline = /content-disposition["'\s:]+[^\n]*inline/i.test(s);
  check(`${rel}: explicit Content-Disposition (attachment or inline)`, attachment || inline);
  // Raw-byte / inline responses must carry nosniff; CSV attachments are inherently non-executable.
  const rawBytes = /application\/octet-stream|arrayBuffer\(|Buffer\.from|Uint8Array/.test(s);
  if (rawBytes || inline) check(`${rel}: nosniff on raw/inline byte response`, /x-content-type-options["'\s:]+[^\n]*nosniff/i.test(s));
  check(`${rel}: no active-content inline HTML/SVG served as text/html`, !/content-type["'\s:]+[^\n]*text\/html/i.test(s));
}

console.log(`\nfile-emitting routes found: ${fileRoutes.length}`);
console.log(`${failures === 0 ? "PASS" : `FAIL (${failures})`} — file-response inventory & gate`);
process.exit(failures === 0 ? 0 : 1);
