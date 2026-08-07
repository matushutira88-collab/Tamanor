/**
 * GOOGLE BUSINESS CONNECTOR — SLICE 2 (pagination, selection projection, security structure).
 *
 * Fully deterministic: no network, no database, no clock. Covers exhaustive pagination and every one of
 * its safety bounds, the browser-safe projection of discovery, the server-side re-resolution that is the
 * import's security boundary, and the structure of the selection page / import action asserted against
 * their SOURCE with comments stripped — so no test can pass by matching its own prose.
 *
 * The DB-backed half (real ConnectedAccount rows, idempotency, concurrency, tenant isolation, capability)
 * lives in packages/db/scripts/google-business-import-repo.test.ts.
 *
 * Run via: pnpm google-business-slice2:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  discoverGoogleBusinessScope, normalizeGoogleAccount, normalizeGoogleLocation, isLocationSyncEligible,
  GOOGLE_DISCOVERY_MAX_PAGES, GOOGLE_DISCOVERY_MAX_ITEMS,
} from "@guardora/sync";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");
/** Strip line + block comments so assertions match REAL code, never documentation. */
const code = (rel: string) => readSrc(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

const acct = (id: string, name = `Account ${id}`) => ({ name: `accounts/${id}`, accountName: name, type: "LOCATION_GROUP", role: "OWNER", verificationState: "VERIFIED" });
const loc = (id: string, verified = true, over: Record<string, unknown> = {}) => ({
  name: `accounts/1/locations/${id}`, title: `Location ${id}`, storeCode: `SC-${id}`,
  storefrontAddress: { addressLines: ["Ulice 1"], locality: "Praha" },
  metadata: { hasVoiceOfMerchant: verified }, ...over,
});

/** A paging client driven by explicit page arrays. Records every pageToken it was given. */
function pagedClient(accountPages: unknown[][], locationPages: Record<string, unknown[][]>, opts: { loopToken?: boolean; badToken?: unknown } = {}) {
  const seenAccountTokens: Array<string | undefined> = [];
  const seenLocationTokens: Array<string | undefined> = [];
  let accountCalls = 0, locationCalls = 0;
  const tokenFor = (pages: unknown[][], i: number) => {
    if (opts.loopToken) return "LOOP";                       // always the same token → provider loop
    if (i >= pages.length - 1) return opts.badToken !== undefined ? (opts.badToken as string) : undefined;
    return `page-${i + 1}`;
  };
  const indexOf = (t: string | undefined) => (t && t.startsWith("page-") ? Number(t.slice(5)) : 0);
  return {
    stats: () => ({ accountCalls, locationCalls, seenAccountTokens, seenLocationTokens }),
    async listAccounts(pageToken?: string) {
      accountCalls++; seenAccountTokens.push(pageToken);
      const i = opts.loopToken ? Math.min(accountCalls - 1, accountPages.length - 1) : indexOf(pageToken);
      return { accounts: accountPages[Math.min(i, accountPages.length - 1)] ?? [], nextPageToken: tokenFor(accountPages, i) };
    },
    async listLocations(accountResourceName: string, pageToken?: string) {
      locationCalls++; seenLocationTokens.push(pageToken);
      const pages = locationPages[accountResourceName] ?? [[]];
      const i = opts.loopToken ? Math.min(locationCalls - 1, pages.length - 1) : indexOf(pageToken);
      return { locations: pages[Math.min(i, pages.length - 1)] ?? [], nextPageToken: tokenFor(pages, i) };
    },
  };
}

async function main() {
  console.log("\nGoogle Business — Slice 2 (pagination, selection, import security)\n");

  // =========================================================================================
  console.log("A) Pagination — accounts");
  {
    const c = pagedClient([[acct("1")], [acct("2")], [acct("3")]], { "accounts/1": [[loc("a")]], "accounts/2": [[]], "accounts/3": [[]] });
    const d = await discoverGoogleBusinessScope(c);
    check("A1) follows nextPageToken across MULTIPLE account pages", d.ok === true && d.accounts.length === 3);
    check("A2) account order is preserved across pages",
      d.accounts.map((a) => a.providerAccountId).join(",") === "1,2,3");
    check("A3) the first request sends NO page token, later ones send the provider's",
      c.stats().seenAccountTokens[0] === undefined && c.stats().seenAccountTokens[1] === "page-1");
    check("A4) stops when the provider stops (no extra call)", c.stats().accountCalls === 3);
    check("A5) a complete listing is not marked truncated", d.truncated === false);
  }
  {
    // A customer must never be shown only page 1 of their locations.
    const c = pagedClient([[acct("1")]], { "accounts/1": [[loc("a"), loc("b")], [loc("c")], [loc("d", false)]] });
    const d = await discoverGoogleBusinessScope(c);
    const locs = d.locationsByAccount["1"] ?? [];
    check("A6) follows nextPageToken across MULTIPLE location pages", locs.length === 4);
    check("A7) location order preserved across pages", locs.map((l) => l.providerLocationId).join(",") === "a,b,c,d");
    check("A8) eligibility counted across ALL pages, not just the first", d.eligibleLocationCount === 3);
  }

  console.log("\nB) Pagination — safety bounds");
  {
    // Accounts resolve normally; the LOCATION listing is the one that loops, so the call count is
    // attributable to exactly one listing.
    let locCalls = 0;
    const looping = {
      async listAccounts() { return { accounts: [acct("1")], nextPageToken: undefined }; },
      async listLocations() { locCalls++; return { locations: [loc(`x${locCalls}`)], nextPageToken: "SAME-TOKEN" }; },
    };
    const d = await discoverGoogleBusinessScope(looping);
    check("B1) a REPEATED page token stops the listing (no infinite loop)", d.ok === true);
    check("B2) the loop stops on the SECOND sight of the token, far under the page cap",
      locCalls === 2, `calls=${locCalls}`);
    check("B3) a repeated-token stop is reported as truncated, never as complete", d.truncated === true);
  }
  {
    // Every page hands back a fresh token forever — only the hard page cap can stop this.
    let calls = 0;
    const endless = {
      async listAccounts() { return { accounts: [acct("1")], nextPageToken: undefined }; },
      async listLocations() { calls++; return { locations: [loc(`L${calls}`)], nextPageToken: `t-${calls}` }; },
    };
    const d = await discoverGoogleBusinessScope(endless);
    check("B4) an endless cursor is stopped by the maximum-page bound", calls === GOOGLE_DISCOVERY_MAX_PAGES, `calls=${calls}`);
    check("B5) hitting the page bound reports truncated", d.truncated === true);
    check("B6) the page bound is a small, explicit constant", GOOGLE_DISCOVERY_MAX_PAGES > 0 && GOOGLE_DISCOVERY_MAX_PAGES <= 50);
  }
  {
    // A single page larger than the item cap must not blow past it.
    const huge = Array.from({ length: GOOGLE_DISCOVERY_MAX_ITEMS + 25 }, (_, i) => loc(`h${i}`));
    const d = await discoverGoogleBusinessScope({
      async listAccounts() { return { accounts: [acct("1")] }; },
      async listLocations() { return { locations: huge, nextPageToken: undefined }; },
    });
    check("B7) the item bound caps a single oversized page", (d.locationsByAccount["1"] ?? []).length === GOOGLE_DISCOVERY_MAX_ITEMS);
    check("B8) hitting the item bound reports truncated", d.truncated === true);
  }
  {
    const c = pagedClient([[acct("1")]], { "accounts/1": [[loc("a")]] }, { badToken: 42 });
    const d = await discoverGoogleBusinessScope(c);
    check("B9) a non-string nextPageToken ends the listing instead of being echoed back",
      d.ok === true && c.stats().locationCalls === 1 && d.truncated === false);
  }
  {
    const c = pagedClient([[acct("1")]], { "accounts/1": [[loc("a")]] }, { badToken: "   " });
    const d = await discoverGoogleBusinessScope(c);
    check("B10) a blank nextPageToken ends the listing", c.stats().locationCalls === 1 && d.truncated === false);
  }

  console.log("\nC) Pagination — normalization + dedupe");
  {
    const c = pagedClient([[acct("1")]], { "accounts/1": [[loc("a"), loc("b", false)], [loc("c")]] });
    const d = await discoverGoogleBusinessScope(c);
    const locs = d.locationsByAccount["1"] ?? [];
    check("C1) normalization is identical to the EXISTING normalizer on every page",
      JSON.stringify(locs[0]) === JSON.stringify(normalizeGoogleLocation(loc("a")))
      && JSON.stringify(locs[2]) === JSON.stringify(normalizeGoogleLocation(loc("c"))));
    check("C2) accounts normalized by the EXISTING normalizer across pages",
      JSON.stringify(d.accounts[0]) === JSON.stringify(normalizeGoogleAccount(acct("1"))));
    check("C3) verification semantics preserved on later pages",
      locs[1].verificationState === "unverified" && isLocationSyncEligible(locs[1]) === false);
  }
  {
    // Overlapping page boundaries — the same location returned twice must yield ONE row.
    const c = pagedClient([[acct("1")]], { "accounts/1": [[loc("a"), loc("b")], [loc("b"), loc("c")]] });
    const d = await discoverGoogleBusinessScope(c);
    const locs = d.locationsByAccount["1"] ?? [];
    check("C4) duplicate provider locations are deduped across pages", locs.length === 3);
    check("C5) dedupe is deterministic — first occurrence wins, order stable",
      locs.map((l) => l.providerLocationId).join(",") === "a,b,c");
    check("C6) eligibility is counted once per real location", d.eligibleLocationCount === 3);
  }

  // =========================================================================================
  console.log("\nD) Selection projection + server-side re-resolution");
  const SEL = "apps/web/src/server/google-business-selection.ts";
  const sel = code(SEL);
  {
    // toSelectable / matchSelection are pure; import them through the compiled web alias is not possible
    // from this package, so the rules are asserted against the source AND re-derived from the primitives.
    check("D1) only VERIFIED locations are marked eligible, via the existing helper",
      /eligible: isLocationSyncEligible\(l\)/.test(sel));
    const toSelectableBody = sel.slice(sel.indexOf("export function toSelectable"), sel.indexOf("export type ResolvedLocation"));
    check("D2) the browser-facing projection exposes no token field",
      !/accessToken|refreshToken|plaintext|token/i.test(toSelectableBody));
    check("D3) the access token is read from the vault, and no exported type carries it",
      /resolveProviderCredentialOutcome/.test(sel)
      && !/export (interface|type) [A-Za-z]+[^{]*\{[^}]*token/.test(sel));
    check("D4) an EXPIRED access token fails closed rather than being silently refreshed",
      /outcome\.expired\) return \{ ok: false, reason: "reconnect_required" \}/.test(sel) && !/refreshAccessToken/.test(sel));
    check("D5) a vault decrypt failure never falls back", /VaultDecryptError/.test(sel));
    const discoverCallAt = sel.indexOf("discoverGoogleBusinessScope(");
    check("D6) both feature axes are enforced before any network call",
      discoverCallAt > 0 && sel.indexOf("!cfg.apiEnabled") < discoverCallAt && sel.indexOf("!cfg.apiApproved") < discoverCallAt);
    check("D7) the two axes are not collapsed",
      !/apiEnabled\s*&&\s*apiApproved/.test(sel) && !/apiApproved\s*&&\s*apiEnabled/.test(sel));
    check("D8) selection requires an ACTIVE connection — a pending one shows nothing",
      /status !== BusinessConnectionStatus\.active/.test(sel));
    check("D9) every read is tenant-scoped through withTenantDb", /withTenantDb\(session\.tenantId/.test(sel));
    check("D10) no Google provider payload is persisted anywhere in the handoff",
      !/\.create\(|\.upsert\(|\.update\(/.test(sel));
    check("D11) import re-runs discovery rather than trusting the rendered page",
      (sel.match(/discoverGoogleBusinessScope\(/g) ?? []).length === 2);
    check("D12) submitted ids are intersected with the server list, never unioned",
      /wanted\.has\(loc\.providerLocationId\)/.test(sel));
    check("D13) ineligible submissions are rejected at resolve time too",
      /!isLocationSyncEligible\(loc\)\) \{ rejectedIneligible\+\+; continue; \}/.test(sel));
    check("D14) unknown/forged ids are counted, never acted on", /rejectedUnknown: wanted\.size - matched\.size/.test(sel));
    check("D15) submitted ids are de-duplicated before use", /new Set\(submittedIds/.test(sel));
    check("D16) no logging of any kind in the handoff", !/console\.(log|error|warn|info)/.test(sel));
  }

  // =========================================================================================
  console.log("\nE) Import action — authorization, CSRF, truthfulness");
  const ACT = "apps/web/src/app/dashboard/accounts/google-business/actions.ts";
  const actFile = code(ACT);
  // Scope to the confirm action — the file also holds the pre-existing disconnect action, whose own
  // `formData.get("accountId")` is not part of this slice's input surface.
  const act = actFile.slice(actFile.indexOf("export async function confirmGoogleBusinessSelection"));
  {
    check("E1) it is a Server Action — the framework's CSRF-protected mutation primitive",
      /^"use server";/m.test(readSrc(ACT)));
    check("E2) the session is re-derived server-side, never taken from the form", /await requireSession\(\)/.test(act));
    check("E3) ConnectorManage is enforced", /assertCan\(session\.role, Permission\.ConnectorManage\)/.test(act));
    check("E4) a deleting tenant is refused", /assertTenantActive\(session\.tenantId\)/.test(act));
    check("E5) tenantId comes from the session, never the form",
      /tenantId: session\.tenantId/.test(act) && !/formData\.get\("tenantId"\)/.test(act));
    const formReads = act.match(/formData\.get(?:All)?\("[^"]+"\)/g) ?? [];
    check("E6) ONLY location ids and a brand id are read from the form",
      formReads.length === 2 && /formData\.getAll\("location"\)/.test(act) && /formData\.get\("brandId"\)/.test(act),
      formReads.join("|"));
    check("E7) selections are re-resolved server-side before any write",
      act.indexOf("resolveSelectedLocations(session") < act.indexOf("importGoogleBusinessLocation({")
      && act.indexOf("resolveSelectedLocations(session") > 0);
    check("E8) NO browser-supplied display metadata is persisted",
      !/formData\.get\("(displayName|address|verification|eligible)"/.test(act));
    check("E9) the persisted location fields all come from the server-resolved object",
      /displayName: loc\.displayName/.test(act) && /addressSummary: loc\.addressSummary/.test(act));
    check("E10) a per-brand limit skips ONE location instead of aborting the batch",
      /brand_platform_limit_reached"\) \{ limited\+\+/.test(act) && /continue;/.test(act));
    check("E11) capability is asserted ONLY after something actually landed",
      /if \(imported \+ reconnected > 0\) \{[\s\S]{0,200}assertGoogleBusinessCapabilities/.test(act));
    check("E12) zero successful imports does NOT redirect to a connected-looking state",
      /if \(imported \+ reconnected === 0\) redirect\(`\$\{SELECT_PATH\}/.test(act));
    check("E13) the redirect carries COUNTS only — no id, name or token",
      !/q\.set\([^)]*(locationId|displayName|token|externalId)/.test(act));
    check("E14) every rejection category is reported, not hidden",
      /gbpLimited/.test(act) && /gbpIneligible/.test(act) && /gbpUnknown/.test(act) && /gbpFailed/.test(act));
    check("E15) a rejected submission is counted, never echoed",
      /reason: "unknown_asset"/.test(act) && !/emitOpsEvent\([^)]*submitted/.test(act));
    check("E16) no logging of any kind", !/console\.(log|error|warn|info)/.test(act));
    check("E17) no token is read, written or referenced by the action",
      !/accessToken|refreshToken|clientSecret/.test(act));
  }

  // =========================================================================================
  console.log("\nF) Selection page — truthful, no auto-import, no leakage");
  const PAGE = "apps/web/src/app/dashboard/accounts/google-business/select/page.tsx";
  const page = code(PAGE);
  {
    check("F1) the page requires ConnectorManage", /requirePermission\(Permission\.ConnectorManage\)/.test(page));
    check("F2) data comes from the server module, not from search params",
      /loadGoogleBusinessSelection\(session\)/.test(page) && !/sp\.(locations|accounts)/.test(page));
    check("F3) NOTHING is preselected — no defaultChecked anywhere", !/defaultChecked/.test(page));
    check("F4) only eligible locations get a submittable checkbox",
      /loc\.eligible \? \([\s\S]{0,200}name="location"/.test(page));
    check("F5) an ineligible location's checkbox is disabled and carries no name",
      /<input type="checkbox" disabled/.test(page));
    check("F6) ineligible rows are visually distinguished", /cursor-not-allowed/.test(page));
    check("F7) the reason a location cannot be connected is stated in words",
      /notEligible/.test(page) && /not verified by Google/.test(readSrc(PAGE)));
    check("F8) verification state is displayed", /verificationState/.test(page));
    check("F9) address summary + store code are displayed where present",
      /addressSummary/.test(page) && /storeCode/.test(page));
    check("F10) truncated discovery is disclosed, never silently hidden", /view\.truncated/.test(page));
    check("F11) an unavailable state renders a bounded translated sentence, not the slug",
      /c\.unavailable\[view\.reason\]/.test(page) && !/view\.reason\.replace/.test(page));
    check("F12) no token or raw provider field is rendered",
      !/accessToken|refreshToken|providerLocationName|plaintext/.test(page));
    check("F13) the submit target is the Server Action, not a hand-rolled fetch",
      /action=\{confirmGoogleBusinessSelection\}/.test(page) && !/fetch\(/.test(page));
    check("F14) no location identifier is placed in the page URL", !/searchParams.*location/i.test(page));
  }

  // =========================================================================================
  console.log("\nG) Import repository — existing model, no parallel identity store");
  const REPO = "packages/db/src/google-business-import-repo.ts";
  const repo = code(REPO);
  {
    check("G1) imports into the EXISTING ConnectedAccount model", /db\.connectedAccount\.upsert/.test(repo));
    check("G2) uses the existing platform enum value", /"google_business"/.test(repo));
    check("G3) idempotency rides the EXISTING unique key",
      /brandId_platform_externalId/.test(repo));
    check("G4) concurrency is serialised with the EXISTING brand/platform advisory lock",
      /acquireBrandPlatformLock\(db, brandId, PLATFORM\)/.test(repo));
    check("G5) the lock is taken BEFORE the capacity check and the upsert",
      repo.indexOf("acquireBrandPlatformLock") < repo.indexOf("assertBrandPlatformCapacity")
      && repo.indexOf("acquireBrandPlatformLock") < repo.indexOf("connectedAccount.upsert"));
    check("G6) per-brand capacity uses the EXISTING entitlement helper", /assertBrandPlatformCapacity/.test(repo));
    check("G7) tenant scoping via withTenantDb", /withTenantDb\(tenantId/.test(repo));
    check("G8) the brand is re-validated against the tenant before any write",
      repo.indexOf("db.brand.findFirst") < repo.indexOf("connectedAccount.upsert"));
    check("G9) NO parallel Google account/location table is touched — only existing models",
      !/db\.(googleLocation|googleBusinessAccount|gbpLocation|googleAccount)\b/i.test(repo)
      && (repo.match(/db\.[a-zA-Z]+\./g) ?? []).every((m) => ["db.brand.", "db.connectedAccount.", "db.auditLog.", "db.businessPlatformConnection."].includes(m)));
    check("G10) legacy plaintext token columns are never written",
      !/accessToken:|refreshToken:|longLivedToken:/.test(repo));
    check("G11) read-only connector mode is asserted", /ConnectorMode\.read_only/.test(repo));
    check("G12) connect is not monitor — background sync stays Slice 3",
      /monitoringEnabled: false/.test(repo));
    check("G13) reconnect updates the SAME row and preserves monitoring choices",
      /update: fields/.test(repo) && !/update: \{[^}]*monitoringEnabled/.test(repo));
    check("G14) the capability set is exactly brand_monitoring",
      /GOOGLE_BUSINESS_EARNED_CAPABILITIES[^=]*=\s*\[\s*BusinessConnectionCapability\.brand_monitoring,?\s*\]/.test(repo));
    check("G15) no unimplemented capability is claimed",
      !/BusinessConnectionCapability\.comment_moderation/.test(repo) && !/BusinessConnectionCapability\.lead_ingestion/.test(repo));
    check("G16) capability assertion is additive and deduped",
      /new Set\(\[\.\.\.conn\.capabilities/.test(repo));
    check("G17) the audit record carries bounded, non-secret metadata only",
      /auditLog\.create/.test(repo) && !/metadata: \{[^}]*(token|secret)/.test(repo));
    check("G18) no logging of any kind", !/console\.(log|error|warn|info)/.test(repo));
    check("G19) no schema or migration statement is introduced", !/CREATE TABLE|ALTER TABLE|prisma\.schema/.test(repo));
  }

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — Google Business Slice 2  [${pass} passed, ${fail} failed]`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
