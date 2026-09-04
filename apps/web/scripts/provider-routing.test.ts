/**
 * M9 (P0) — PROVIDER ROUTING for manual read-only sync.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS PINS DOWN
 *
 * The web "Sync now" / first-sync-retry actions resolved only the CONNECTION state
 * and then called `runReadOnlySync` unconditionally. That function resolves a META
 * access token first, and for anything Meta does not own `createRawConnector` falls
 * back SILENTLY to a placeholder connector. So a real Google Business location — a
 * genuine `ConnectedAccount` row created by `importGoogleBusinessLocation` — was
 * dragged onto the Meta transport and could only end in a false "reconnect
 * required", or in placeholder content written against a real account.
 *
 * Mobile already refused this correctly. The two surfaces disagreed. These tests
 * pin ONE answer for both, and the property that matters most:
 *
 *   NO non-Meta account may reach the Meta token path or the Meta transport, and
 *   there is NO default that routes an unknown platform to Meta.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Run: pnpm provider-routing:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  ALL_PLATFORMS, Platform,
  resolveManualSyncCapability, syncProviderFor,
  type ConnectionState, type SyncProvider,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");
/** Source with comments stripped — a "never does X" check must inspect CODE, not prose. */
const codeOf = (rel: string) =>
  readSrc(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const cap = (platform: string, connectionState: ConnectionState = "CONNECTED_HEALTHY") =>
  resolveManualSyncCapability({ platform, connectionState });

function run() {
  /* ===================== PROVIDER MAPPING ===================== */
  console.log("\nPROVIDER MAPPING");

  check("1) Platform.FacebookPage → meta", syncProviderFor(Platform.FacebookPage) === "meta");
  check("2) Platform.InstagramBusiness → meta", syncProviderFor(Platform.InstagramBusiness) === "meta");
  check("3) Platform.GoogleBusiness → google_business (named truthfully, not 'unknown')",
    syncProviderFor(Platform.GoogleBusiness) === "google_business");
  check("4) Platform.GoogleBusiness is NEVER meta", syncProviderFor(Platform.GoogleBusiness) !== "meta");

  for (const p of [Platform.YouTube, Platform.LinkedInCompany, Platform.TikTok]) {
    check(`5-${p}) a platform with no ingestion owner is not meta`, syncProviderFor(p) !== "meta");
  }

  const NONSENSE = ["", "facebook", "meta", "instagram", "google", "__proto__", "constructor", "FACEBOOK_PAGE", "facebook_page "];
  for (const bad of NONSENSE) {
    check(`6-${JSON.stringify(bad)}) unrecognized platform → unknown (NO meta fallback)`,
      syncProviderFor(bad) === "unknown");
  }

  check("7) every canonical Platform resolves to a known provider bucket",
    ALL_PLATFORMS.every((p) => (["meta", "google_business", "unknown"] as SyncProvider[]).includes(syncProviderFor(p))));

  /* ===================== CAPABILITY ===================== */
  console.log("\nMANUAL SYNC CAPABILITY");

  check("8) FB healthy → supported via meta",
    cap(Platform.FacebookPage).supported && cap(Platform.FacebookPage).provider === "meta");
  check("9) IG healthy → supported via meta",
    cap(Platform.InstagramBusiness).supported && cap(Platform.InstagramBusiness).provider === "meta");

  const gb = cap(Platform.GoogleBusiness);
  check("10) Google Business → NOT supported (no ingestion wired)", !gb.supported);
  check("11) Google Business refusal is not_supported", gb.reason === "not_supported");
  check("12) Google Business still reports its own provider, not meta", gb.provider === "google_business");

  const unknown = cap("something_new");
  check("13) unknown platform → not supported", !unknown.supported);
  check("14) unknown platform → provider unknown", unknown.provider === "unknown");
  check("15) unknown platform → not_supported", unknown.reason === "not_supported");

  /* ---- routing is decided BEFORE health, so health can never unblock it ---- */
  const HEALTHS: ConnectionState[] = [
    "CONNECTED_HEALTHY", "WAITING_FIRST_SYNC", "DEGRADED", "REAUTH_REQUIRED", "SYNC_FAILED", "DISCONNECTED",
  ];
  check("16) Google Business is unsupported in EVERY connection state",
    HEALTHS.every((h) => !cap(Platform.GoogleBusiness, h).supported));
  check("17) an unknown platform is unsupported in EVERY connection state",
    HEALTHS.every((h) => !cap("mystery", h).supported));
  check("18) a healthy-looking Google account never becomes 'meta'",
    HEALTHS.every((h) => cap(Platform.GoogleBusiness, h).provider !== "meta"));

  /* ---- connection gating still applies to supported providers ---- */
  check("19) REAUTH_REQUIRED blocks a Meta account BEFORE any provider call",
    !cap(Platform.FacebookPage, "REAUTH_REQUIRED").supported &&
    cap(Platform.FacebookPage, "REAUTH_REQUIRED").reason === "reauth_required");
  check("20) DISCONNECTED blocks a Meta account",
    !cap(Platform.FacebookPage, "DISCONNECTED").supported &&
    cap(Platform.FacebookPage, "DISCONNECTED").reason === "disconnected");
  check("21) WAITING_FIRST_SYNC is allowed (that is what a first-sync retry is for)",
    cap(Platform.FacebookPage, "WAITING_FIRST_SYNC").supported);
  check("22) DEGRADED and SYNC_FAILED are still retryable",
    cap(Platform.FacebookPage, "DEGRADED").supported && cap(Platform.FacebookPage, "SYNC_FAILED").supported);
  check("23) a blocked Meta account is never mislabelled not_supported",
    cap(Platform.FacebookPage, "REAUTH_REQUIRED").reason !== "not_supported");

  /* ===================== ENGINE GATE ===================== */
  console.log("\nSYNC ENGINE GATE (packages/sync)");

  {
    const engine = codeOf("packages/sync/src/index.ts");
    const gate = engine.indexOf("syncProviderFor(String(account.platform))");
    check("24) the engine itself resolves the provider — callers are not the only gate", gate > 0);
    check("25) the engine refuses a non-meta provider", /syncProvider !== "meta"/.test(engine));
    // Anchor on the CALL SITE, not the import at the top of the file.
    check("26) the gate runs BEFORE the Meta access token is resolved",
      gate > 0 && gate < engine.indexOf("await resolveMetaAccessTokenSafe("));
    check("27) the gate runs BEFORE createConnectorRuntime (the placeholder fallback)",
      gate > 0 && gate < engine.indexOf("createConnectorRuntime("));
    check("28) the engine still has no platform-conditional Meta fallback",
      !/else\s*\{[^}]*MetaReadOnlyConnector/.test(engine));
  }

  {
    // The placeholder fallback that made this defect possible must stay explicit and
    // Meta-only, so this test fails loudly if another platform is ever added to it.
    const registry = codeOf("packages/connectors/src/registry.ts");
    const real = registry.slice(registry.indexOf("export function createRawConnector"));
    check("29) createRawConnector gives the REAL adapter to Meta only",
      /Platform\.FacebookPage/.test(real) && /Platform\.InstagramBusiness/.test(real) &&
      !/Platform\.GoogleBusiness/.test(real.slice(0, real.indexOf("createConnector(platform)"))));
  }

  /* ===================== WEB CONSUMER ===================== */
  console.log("\nWEB CONSUMER (dashboard accounts actions)");

  {
    const actions = codeOf("apps/web/src/app/dashboard/accounts/actions.ts");
    check("30) the web actions import the canonical resolver",
      /resolveManualSyncCapability/.test(actions));
    check("31) the web actions now SELECT platform (they could not route without it)",
      (actions.match(/platform: true/g) ?? []).length >= 2);

    // Both manual-sync entry points must gate before scheduling the sync.
    const parts = actions.split("export async function").filter((p) => /runSyncAction|retryFirstSync/.test(p.slice(0, 40)));
    check("32) both manual-sync entry points exist for inspection", parts.length === 2);
    for (const part of parts) {
      const name = part.slice(0, part.indexOf("(")).trim();
      const gate = part.indexOf("resolveManualSyncCapability");
      const call = part.indexOf("runReadOnlySync");
      check(`33-${name}) gates on the resolver`, gate > 0);
      check(`34-${name}) the gate precedes runReadOnlySync`, gate > 0 && call > 0 && gate < call);
      check(`35-${name}) refuses when unsupported`, /if \(!capability\.supported\)/.test(part));
    }
    check("36) the web CTA copy stays truthful — no promise of a sync it will not run",
      /not available for this platform/i.test(actions) || /sync=not_supported/.test(actions));
    check("37) no surface-local platform branching was reintroduced here",
      !/platform === "instagram_business"/.test(actions) && !/platform === "facebook_page"/.test(actions));
  }

  /* ===================== MOBILE CONSUMER ===================== */
  console.log("\nMOBILE CONSUMER (M6 accounts service)");

  {
    const mobile = codeOf("apps/web/src/server/mobile-accounts.ts");
    check("38) mobile refuses an unimplemented platform at the sync endpoint",
      /if \(!syncIsImplemented\(platform\)\)/.test(mobile) && /"not_supported"/.test(mobile));
    check("39) mobile reports requires_web rather than claiming the capability",
      /!syncImplemented \? "requires_web"/.test(mobile));
    check("40) mobile remains a PURE service (M6 invariant): no runtime import added",
      !/^import (?!type )/m.test(mobile));

    /* The mobile predicate is RESTATED rather than imported (purity invariant), so it is
       pinned to the canonical resolver here for every platform — they cannot drift. */
    const mobileSaysImplemented = (p: string) =>
      p === "facebook_page" || p === "instagram_business";
    const ALL = [...ALL_PLATFORMS.map(String), "unknown", "", "__proto__", "youtube"];
    check("41) mobile's local predicate matches the canonical resolver for EVERY platform",
      ALL.every((p) => mobileSaysImplemented(p) === (syncProviderFor(p) === "meta")));
    check("42) that mirrored predicate is the one actually in the mobile source",
      /platform === "facebook_page" \|\| platform === "instagram_business"/.test(mobile));
  }

  /* ===================== THE PROPERTY THAT MATTERS ===================== */
  console.log("\nNO CROSS-PROVIDER LEAK");

  check("43) NO Google Business account can be reported as meta-syncable",
    !cap(Platform.GoogleBusiness).supported && cap(Platform.GoogleBusiness).provider !== "meta");
  check("44) NO unknown platform can become Facebook/Meta",
    ["", "x", "facebook", "meta", "google_business_x"].every((p) => syncProviderFor(p) !== "meta"));
  check("45) the ONLY platforms that reach the Meta transport are FB and IG",
    ALL_PLATFORMS.filter((p) => syncProviderFor(p) === "meta").sort().join(",") ===
      [Platform.FacebookPage, Platform.InstagramBusiness].sort().join(","));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — provider routing for manual sync (M9): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
