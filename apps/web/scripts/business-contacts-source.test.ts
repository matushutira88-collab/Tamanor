/**
 * BUSINESS Connected Platforms & Contacts V1 — UI/source invariants (static). Asserts the new routes sit inside
 * the authenticated Business boundary, never import Prisma / touch the DB directly, never render a token/secret
 * or raw provider metadata, keep the existing navigation intact while adding exactly two entries, and that the
 * server actions' audit metadata carries NO PII.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const web = (p: string) => join(HERE, "..", p);
const read = (p: string) => (existsSync(web(p)) ? readFileSync(web(p), "utf8") : "");

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const contactsPage = read("src/app/dashboard/contacts/page.tsx");
const contactDetail = read("src/app/dashboard/contacts/[id]/page.tsx");
const platformsPage = read("src/app/dashboard/platforms/page.tsx");
const contactsActions = read("src/app/dashboard/contacts/actions.ts");
const platformsActions = read("src/app/dashboard/platforms/actions.ts");
const nav = read("src/lib/nav.ts");
const uiFiles = { contactsPage, contactDetail, platformsPage };

// 1) Authenticated Business boundary on every page (entitlement + RBAC).
for (const [name, src] of Object.entries(uiFiles)) {
  check(`${name}: enforces the Business entitlement gate`, /requireDashboardCapability\("businessConnectedPlatforms"\)/.test(src));
  check(`${name}: enforces an RBAC permission (can(...))`, /can\(session\.role, Permission\.Business/.test(src));
  check(`${name}: renders AccessDeniedState + CapabilityLockedState fallbacks`, /AccessDeniedState/.test(src) && /CapabilityLockedState/.test(src));
}

// 2) No direct DB / Prisma in UI (must go through @guardora/db repo services).
for (const [name, src] of Object.entries({ ...uiFiles, contactsActions, platformsActions })) {
  check(`${name}: no @prisma/client import`, !/@prisma\/client/.test(src));
  check(`${name}: no PrismaClient / systemDb / appDb / withTenant in UI`, !/new PrismaClient|systemDb|appDb|withTenant/.test(src));
}

// 3) No token/secret field ever referenced in the UI.
for (const [name, src] of Object.entries(uiFiles)) {
  check(`${name}: no token/secret field`, !/accessToken|refreshToken|clientSecret|webhookSecret|longLivedToken|"secret"/.test(src));
}
// 4) No raw provider metadata dump rendered (no JSON.stringify of a provider object into the page).
check("platforms page: no raw metadata JSON dumped", !/JSON\.stringify/.test(platformsPage));
check("platforms page: derives truthful status (uses the catalogue + isBusinessConnectionActive)", /BUSINESS_PROVIDER_CATALOGUE/.test(platformsPage) && /isBusinessConnectionActive/.test(platformsPage));
check("platforms page: no fake hardcoded 'Connected' status", !/>Connected</.test(platformsPage));

// 5) Navigation: existing entries preserved + exactly the two new additive entries.
const EXISTING_NAV = ["/dashboard/comments", "/dashboard/incidents", "/dashboard/security", "/dashboard/team", "/dashboard/audit", "/dashboard/control-center"];
check("nav: existing entries preserved", EXISTING_NAV.every((h) => nav.includes(`"${h}"`)), EXISTING_NAV.filter((h) => !nav.includes(`"${h}"`)).join(","));
check("nav: adds the Contacts entry", /href:\s*"\/dashboard\/contacts"/.test(nav));
check("nav: adds the Connected Platforms entry", /href:\s*"\/dashboard\/platforms"/.test(nav));
const newBiz = (nav.match(/href:\s*"\/dashboard\/(contacts|platforms)"/g) ?? []).length;
check("nav: introduces EXACTLY two new Business entries", newBiz === 2, `found ${newBiz}`);
check("nav: new entries are RBAC-gated", /"business\.contacts\.read" as Permission/.test(nav) && /"business\.platforms\.read" as Permission/.test(nav));

// 6) Audit metadata carries NO PII.
for (const [name, src] of Object.entries({ contactsActions, platformsActions })) {
  const auditBlocks = src.match(/writeAudit\(\{[\s\S]*?\}\)/g) ?? [];
  const pii = auditBlocks.filter((b) => /email|phone|fullName|\bname\b|message|company|firstName|lastName/.test(b));
  check(`${name}: writeAudit metadata has NO PII`, pii.length === 0, pii.slice(0, 1).join(""));
  check(`${name}: audit events are business.* namespaced`, /event:\s*"business_(contact|connection)\./.test(src));
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — business contacts source invariants (V1): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
