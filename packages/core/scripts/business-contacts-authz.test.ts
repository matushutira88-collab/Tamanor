/**
 * BUSINESS Connected Platforms & Contacts V1 — authorization mapping tests (pure). Asserts the additive
 * permissions map conservatively: Owner/Admin get read+manage; Analyst gets READ only; Reviewer/Viewer get
 * NEITHER. Also asserts the entitlement is growth+ (mirrors securitySuite) and the provider catalogue is truthful.
 */
import { Role, Permission, can } from "../src/index";
import { resolveEntitlements, hasEntitlement } from "../src/entitlements";
import {
  BUSINESS_PROVIDER_CATALOGUE, ALL_BUSINESS_PROVIDERS, BusinessConnectionStatus, isBusinessConnectionActive,
  canTransitionContactStatus, BusinessContactStatus, SOURCE_PROVIDER, BusinessContactSource, BusinessProvider,
} from "../src/business-contacts";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const CR = Permission.BusinessContactsRead, CM = Permission.BusinessContactsManage;
const PR = Permission.BusinessPlatformsRead, PM = Permission.BusinessPlatformsManage;

// ---- role → permission mapping (conservative) --------------------------------------------------------------
check("Owner: read + manage (contacts + platforms)", can(Role.Owner, CR) && can(Role.Owner, CM) && can(Role.Owner, PR) && can(Role.Owner, PM));
check("Admin: read + manage (contacts + platforms)", can(Role.Admin, CR) && can(Role.Admin, CM) && can(Role.Admin, PR) && can(Role.Admin, PM));
check("Analyst: READ yes, MANAGE no (contacts)", can(Role.Analyst, CR) && !can(Role.Analyst, CM));
check("Analyst: READ yes, MANAGE no (platforms)", can(Role.Analyst, PR) && !can(Role.Analyst, PM));
check("Reviewer: NEITHER read nor manage", !can(Role.Reviewer, CR) && !can(Role.Reviewer, CM) && !can(Role.Reviewer, PR) && !can(Role.Reviewer, PM));
check("Viewer: NEITHER read nor manage", !can(Role.Viewer, CR) && !can(Role.Viewer, CM) && !can(Role.Viewer, PR) && !can(Role.Viewer, PM));

// ---- entitlement: growth+ (business plan available; starter/trial locked) ----------------------------------
const ent = (plan: string) => resolveEntitlements(plan, "full_access" as never, {});
check("entitlement: free_trial LOCKED", !hasEntitlement(ent("free_trial"), "businessConnectedPlatforms"));
check("entitlement: starter LOCKED", !hasEntitlement(ent("starter"), "businessConnectedPlatforms"));
check("entitlement: growth UNLOCKED", hasEntitlement(ent("growth"), "businessConnectedPlatforms"));
check("entitlement: agency (Business) UNLOCKED", hasEntitlement(ent("agency"), "businessConnectedPlatforms"));
check("entitlement: enterprise UNLOCKED", hasEntitlement(ent("enterprise"), "businessConnectedPlatforms"));

// ---- provider catalogue truthfulness -----------------------------------------------------------------------
check("catalogue: all 4 providers present", ALL_BUSINESS_PROVIDERS.length === 4);
check("catalogue: NO provider has a live connect implemented in this checkpoint",
  ALL_BUSINESS_PROVIDERS.every((p) => BUSINESS_PROVIDER_CATALOGUE[p].connectImplemented === false));
check("catalogue: every default status is a non-active truthful state",
  ALL_BUSINESS_PROVIDERS.every((p) => !isBusinessConnectionActive(BUSINESS_PROVIDER_CATALOGUE[p].defaultStatus)));
check("catalogue: default status is awaiting_provider_approval",
  ALL_BUSINESS_PROVIDERS.every((p) => BUSINESS_PROVIDER_CATALOGUE[p].defaultStatus === BusinessConnectionStatus.AwaitingProviderApproval));
check("catalogue: only 'active' counts as connected", isBusinessConnectionActive(BusinessConnectionStatus.Active) && !isBusinessConnectionActive(BusinessConnectionStatus.Pending));

// ---- source → provider mapping (YouTube via Google Ads; web_form has none) ---------------------------------
check("source: YouTube maps to the Google provider (ads attribution)", SOURCE_PROVIDER[BusinessContactSource.YouTube] === BusinessProvider.Google);
check("source: GoogleAds maps to Google", SOURCE_PROVIDER[BusinessContactSource.GoogleAds] === BusinessProvider.Google);
check("source: Facebook/Instagram map to Meta", SOURCE_PROVIDER[BusinessContactSource.Facebook] === BusinessProvider.Meta && SOURCE_PROVIDER[BusinessContactSource.Instagram] === BusinessProvider.Meta);
check("source: web_form has NO external provider", SOURCE_PROVIDER[BusinessContactSource.WebForm] === null);

// ---- status transitions ------------------------------------------------------------------------------------
check("transition: new → customer allowed", canTransitionContactStatus(BusinessContactStatus.New, BusinessContactStatus.Customer));
check("transition: same → same allowed (idempotent)", canTransitionContactStatus(BusinessContactStatus.Handled, BusinessContactStatus.Handled));
check("transition: rejected → customer NOT allowed (must reopen first)", !canTransitionContactStatus(BusinessContactStatus.Rejected, BusinessContactStatus.Customer));

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — business contacts authz (V1): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
