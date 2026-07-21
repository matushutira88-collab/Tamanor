/**
 * V1.36 Google Business Profile connector — read-only review monitoring. Verifies
 * capability honesty (review read, no write actions), fail-closed config/OAuth,
 * account/location selection, verified-only sync, review normalization (rating-only,
 * anonymous, platform+location-scoped identity), deterministic review sentiment,
 * normalized errors, Reputation aggregation, and that no raw ids/tokens/errors leak.
 * Facebook + Instagram + state truth are unchanged. No write action exists.
 *
 * Run via: pnpm google-business-connector:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import { getGoogleBusinessConfig, GOOGLE_BUSINESS_SCOPE } from "@guardora/config";
import { getCapabilities, HIDDEN_FROM_PUBLIC_REASONS } from "@guardora/core";
import {
  normalizeGoogleAccount, normalizeGoogleLocation, normalizeGoogleReview, dedupeReviews,
  reviewSentiment, requiresAccountSelection, isLocationSyncEligible, buildGoogleAuthUrl,
  validateOAuthState, listGoogleBusinessReviews, mapGoogleBusinessError, googleBusinessDiagnostic,
  GOOGLE_BUSINESS_AUDIT, type GoogleBusinessLocation,
} from "@guardora/sync";
import { sentimentBucket } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const OFF = {}; // not configured
const CONFIGURED = { GOOGLE_BUSINESS_CLIENT_ID: "cid", GOOGLE_BUSINESS_CLIENT_SECRET: "sec", GOOGLE_BUSINESS_REDIRECT_URI: "http://localhost/cb" };
const ENABLED = { ...CONFIGURED, GOOGLE_BUSINESS_API_ENABLED: "true" };
const verifiedLoc: GoogleBusinessLocation = { providerLocationName: "locations/L1", providerLocationId: "L1", displayName: "Store A", verificationState: "verified", selected: true };
const unverifiedLoc: GoogleBusinessLocation = { ...verifiedLoc, providerLocationId: "L2", verificationState: "unverified", selected: false };

async function run() {
  const accounts = readSrc("apps/web/src/app/dashboard/accounts/page.tsx");
  const comments = readSrc("apps/web/src/app/dashboard/comments/page.tsx");
  const rep = readSrc("apps/web/src/app/dashboard/reputation/page.tsx");
  const connect = readSrc("apps/web/src/app/api/connectors/google-business/connect/route.ts");
  const callback = readSrc("apps/web/src/app/api/connectors/google-business/callback/route.ts");
  const disconnect = readSrc("apps/web/src/app/dashboard/accounts/google-business/actions.ts");
  const landing = readSrc("apps/web/src/components/landing-v2/landing-v2.tsx");
  const readme = readSrc("README.md");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");
  const gb = getCapabilities("google_business");

  // 1-5) Capability honesty.
  check("1) advertises review sync", gb.canReviewSync === true);
  check("2) no comment hide", gb.canHideComment === false);
  check("3) no delete", gb.canDeleteComment === false);
  check("4) no reply", gb.canReplyToComment === false);
  check("5) no auto-moderation", gb.canModerateAutomatically === false);

  // 6) Fails closed when API disabled.
  const disabled = await listGoogleBusinessReviews({ accountId: "A1", location: verifiedLoc }, { source: CONFIGURED, executor: async () => ({ reviews: [] }) });
  check("6) fails closed when API disabled", disabled.reason === "google_business_api_disabled" && disabled.ok === false);

  // 7) Missing OAuth config → not_configured.
  check("7) missing config → not_configured", getGoogleBusinessConfig(OFF).status === "not_configured" && (await listGoogleBusinessReviews({ accountId: "A1", location: verifiedLoc }, { source: OFF })).reason === "google_business_not_configured");

  // 8) OAuth scope is business.manage ONLY.
  const url = new URL(buildGoogleAuthUrl({ clientId: "cid", redirectUri: "http://cb", state: "s" }));
  check("8) scope limited to business.manage", GOOGLE_BUSINESS_SCOPE === "https://www.googleapis.com/auth/business.manage" && url.searchParams.get("scope") === GOOGLE_BUSINESS_SCOPE && !url.searchParams.get("scope")!.includes(" "));

  // 9) OAuth state validated.
  check("9) state validated", validateOAuthState("a", "a") === true && validateOAuthState("a", "b") === false && validateOAuthState(null, "a") === false && callback.includes("validateOAuthState"));

  // 10) Tokens never returned to UI (config exposes no secret/token).
  const cfg = getGoogleBusinessConfig(ENABLED);
  check("10) no token/secret exposed", !("clientSecret" in cfg) && !("accessToken" in cfg) && cfg.hasSecret === true && !accounts.includes("accessToken") && !accounts.includes("clientSecret"));

  // 11) Multiple accounts require explicit selection.
  const acc = (n: string) => normalizeGoogleAccount({ name: `accounts/${n}`, accountName: "Biz" });
  check("11) multiple accounts require selection", requiresAccountSelection([acc("1"), acc("2")]) === true && requiresAccountSelection([acc("1")]) === false);

  // 12) Locations support explicit selection (not auto-enabled; verified-gated).
  const locNorm = normalizeGoogleLocation({ name: "locations/L9", title: "Store", verificationState: "UNVERIFIED" });
  check("12) location explicit selection + verified gate", locNorm.selected === false && locNorm.verificationState === "unverified" && isLocationSyncEligible(verifiedLoc) === true && isLocationSyncEligible(unverifiedLoc) === false);

  // 13) Unverified locations cannot sync.
  const unverifiedResult = await listGoogleBusinessReviews({ accountId: "A1", location: unverifiedLoc }, { source: ENABLED, executor: async () => ({ reviews: [{ reviewId: "x" }] }) });
  check("13) unverified cannot sync", unverifiedResult.reason === "google_business_location_not_verified" && unverifiedResult.reviews.length === 0);

  // 14) Pagination supported.
  const paged = await listGoogleBusinessReviews({ accountId: "A1", location: verifiedLoc }, { source: ENABLED, executor: async () => ({ reviews: [{ reviewId: "r1", starRating: "FIVE" }], nextPageToken: "TOK2" }) });
  check("14) pagination supported", paged.nextPageToken === "TOK2" && paged.reviews.length === 1);

  // 15/16) Idempotent + dedupe by review id.
  const r1 = normalizeGoogleReview({ reviewId: "dup", starRating: "FOUR", comment: "ok" }, { accountId: "A1", locationId: "L1" });
  check("15/16) dedupe / idempotent", dedupeReviews([r1, { ...r1 }, r1]).length === 1 && normalizeGoogleReview({ reviewId: "dup" }, { accountId: "A1", locationId: "L1" }).externalReviewId === "dup");

  // 17) Rating-only reviews preserved (empty text, real rating).
  const ratingOnly = normalizeGoogleReview({ reviewId: "ro", starRating: "FIVE" }, { accountId: "A1", locationId: "L1" });
  check("17) rating-only preserved", ratingOnly.text === "" && ratingOnly.rating === 5);

  // 18) Anonymous reviewer supported.
  const anon = normalizeGoogleReview({ reviewId: "an", reviewer: { isAnonymous: true }, starRating: "THREE" }, { accountId: "A1", locationId: "L1" });
  check("18) anonymous supported", anon.reviewerAnonymous === true && anon.reviewerDisplayName === null);

  // 19) Reviewer identity is platform-scoped.
  const named = normalizeGoogleReview({ reviewId: "n1", reviewer: { displayName: "Bob" }, starRating: "FIVE" }, { accountId: "A1", locationId: "L1" });
  check("19) identity platform-scoped", named.actorKey!.startsWith("google_business:") && named.platform === "google_business");

  // 20) Display name alone is NOT globally unique (location-scoped).
  const bobA = normalizeGoogleReview({ reviewId: "b1", reviewer: { displayName: "Bob" } }, { accountId: "A1", locationId: "LA" });
  const bobB = normalizeGoogleReview({ reviewId: "b2", reviewer: { displayName: "Bob" } }, { accountId: "A1", locationId: "LB" });
  check("20) display name not globally unique", bobA.authorExternalId !== bobB.authorExternalId && bobA.authorExternalId.includes("LA") && bobB.authorExternalId.includes("LB"));

  // 21) 1-star review is negative, not automatically risky.
  check("21) 1-star negative, not risky", reviewSentiment(1, []) === "negative" && reviewSentiment(2, []) === "negative");

  // 22) Normal criticism / complaints not automatically risky.
  check("22) normal criticism not risky", reviewSentiment(2, ["normal_criticism"]) !== "risky" && reviewSentiment(1, ["refund_complaint"]) !== "risky" && reviewSentiment(1, ["delivery_issue"]) !== "risky");

  // 23) Scam/threat/phishing content may become risky.
  check("23) scam/threat may be risky", reviewSentiment(1, ["scam"]) === "risky" && reviewSentiment(5, ["threat"]) === "risky" && reviewSentiment(3, ["phishing"]) === "risky");

  // 24) Google reviews never count as hidden-from-public.
  check("24) reviews not hidden-from-public", HIDDEN_FROM_PUBLIC_REASONS.length === 2 && !(HIDDEN_FROM_PUBLIC_REASONS as string[]).some((r) => r.startsWith("google_business")));

  // 25) No hide/delete/reply UI for Google; capability-honest.
  check("25) no hide/delete/reply UI", accounts.includes("hdrT.gbp.protectionUnavailable") && accounts.includes("hdrT.cap.reviewsOn") && !accounts.includes("gbp.hide") && !accounts.includes("gbp.reply") && gb.canHideComment === false);

  // 26) Comments/Reputation render review type + Reputation aggregates all platforms.
  check("26) review UI + aggregation", comments.includes("isReview") && comments.includes("t.gbp.reviewType") && !rep.includes('platform: "facebook') && !comments.includes('platform: "facebook'));

  // 27) Location context (account/location name) + review badge shown, not raw ids.
  check("27) location context shown", comments.includes("r.platformLabel") && comments.includes("r.account") && comments.includes("r.isReview"));

  // 28) Raw provider identifiers hidden by default (resource names never rendered).
  check("28) raw provider ids hidden", !accounts.includes("providerLocationName") && !accounts.includes("providerAccountName") && !accounts.includes("providerLocationId"));

  // 29) Raw provider errors hidden — only normalized reasons surface.
  check("29) errors normalized", mapGoogleBusinessError({ message: "PERMISSION_DENIED scope" }) === "google_business_permission_missing" && mapGoogleBusinessError({ code: 403, message: "access denied" }) === "google_business_access_denied" && mapGoogleBusinessError({ message: "quota exceeded" }) === "google_business_quota_exceeded" && mapGoogleBusinessError({ code: 401 }) === "google_business_token_expired" && callback.includes("google=oauth_denied") && !callback.includes("providerError.message"));

  // 30/31) Facebook + Instagram unchanged.
  check("30/31) FB + IG unchanged", getCapabilities("facebook").canHideComment === true && getCapabilities("instagram").canReadComments === true && getCapabilities("instagram").canHideComment === false);

  // 32) Tenant isolation enforced in the connector paths (V1.37.4 — via the shared
  //     disconnect service, which is tenant-scoped/RLS and gated to google_business).
  check("32) tenant isolation", disconnect.includes("disconnectAccount(session.tenantId") && disconnect.includes('"google_business"'));

  // 33) Safe audit events (no tokens in metadata).
  check("33) safe audit events", GOOGLE_BUSINESS_AUDIT.connected === "google_business.connected" && GOOGLE_BUSINESS_AUDIT.disconnected === "google_business.disconnected" && connect.includes("GOOGLE_BUSINESS_AUDIT") && disconnect.includes("GOOGLE_BUSINESS_AUDIT.disconnected"));

  // 34) Disconnect removes local credentials + reports a truthful provider revoke
  //     (V1.37.4). The credential-clearing lives in the shared disconnect service.
  const disconnectSvc = readSrc("packages/sync/src/disconnect.ts");
  check("34) disconnect clears creds, no secrets, truthful revoke",
    disconnectSvc.includes("accessToken: null") && disconnectSvc.includes("refreshToken: null") && disconnectSvc.includes('status: "disconnected"')
    && disconnect.includes("localCredentialsRemoved") && disconnect.includes("providerRevoke")
    && !disconnect.includes("accessToken: account") && disconnect.includes("no token"));

  // 35) Public copy does not claim live sync before verification.
  // Landing V2 (the current landing) is data-driven: the honest Google state now lives in the
  // `landingV2` platforms copy ("Connector built — awaiting approved API access. Reviews stay
  // read-only by design."), rendered by the landing via `copy.platforms` — this replaces the old
  // landing-content.tsx `t.beta.googleConnectorNote` render, which the landing refactor removed.
  // The "not live" guard is per-line and exempts approval-caveated copy: an honest line may
  // legitimately pair "Google" + "live" when it explicitly gates live access on approval
  // (e.g. the `state_awaiting_approval` status), while a dishonest "Google is live" claim would not.
  const claimsGoogleLive = en.split("\n").some((ln) => /google[^\n]*\blive\b/i.test(ln) && !/(approv|pending|awaiting)/i.test(ln));
  check("35) public copy honest (not live)",
    en.includes("connector ready for approved API access")
    && en.includes("awaiting approved API access")
    && landing.includes("copy.platforms")
    && !claimsGoogleLive
    && /connector implementation is complete/i.test(readme));

  // Diagnostic sanity — never "ready" without verified locations.
  const diag = googleBusinessDiagnostic({ source: ENABLED, connected: true, tokenValid: true, accounts: [acc("1")], selectedAccountId: "1", locations: [unverifiedLoc] });
  check("D) diagnostic honest", diag.reviewReadCapability === true && diag.verifiedLocationCount === 0 && diag.reason === "google_business_location_not_verified");

  // ---- DB fixture: reviews aggregate into Reputation; none counted hidden ----
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (tenant) {
    const T = tenant.id;
    const brand = await prisma.brand.create({ data: { tenantId: T, name: "Google Reviews Test Brand" } });
    const acct = await prisma.connectedAccount.create({ data: { tenantId: T, brandId: brand.id, platform: "google_business", status: "active", mode: "read_only", externalId: "GB_LOC", pageId: "GB_LOC" } });
    const mkReview = async (ext: string, rating: number, cats: string[], text: string, sentiment: string) => {
      const ci = await prisma.contentItem.create({ data: { tenantId: T, brandId: brand.id, connectedAccountId: acct.id, platform: "google_business", kind: "review", externalId: ext, rating, authorDisplayName: "Reviewer", text, publishedAt: new Date() } });
      await prisma.reputationItem.create({ data: { tenantId: T, brandId: brand.id, platform: "google_business", contentItemId: ci.id, riskLevel: "none", riskCategories: cats, sentiment: sentiment as never } });
    };
    try {
      await mkReview("gr1", 5, ["positive_feedback"], "great!", "positive");
      await mkReview("gr2", 1, ["normal_criticism"], "slow service", "negative"); // negative, not risky
      await mkReview("gr3", 3, [], "", "neutral"); // rating-only, neutral
      await mkReview("gr4", 1, ["scam"], "buy followers http://x.co", "neutral"); // risky

      const reps = await prisma.reputationItem.findMany({ where: { brandId: brand.id }, select: { riskCategories: true, sentiment: true, riskLevel: true, contentItem: { select: { kind: true, rating: true } } } });
      const buckets = { positive: 0, neutral: 0, negative: 0, risky: 0 };
      for (const r of reps) buckets[sentimentBucket({ categories: r.riskCategories, sentiment: r.sentiment as string, riskLevel: r.riskLevel as string })]++;
      check("F26) reviews aggregate into Reputation", reps.length === 4 && reps.every((r) => r.contentItem.kind === "review") && buckets.risky === 1 && buckets.negative === 1);
      check("F17) rating-only review kept", reps.some((r) => r.contentItem.rating === 3));
      const hides = await prisma.platformActionExecution.count({ where: { brandId: brand.id, status: "executed", reason: { in: ["live_hide_executed", "already_hidden"] } } });
      check("F24) no google reviews hidden", hides === 0);
      const [mock, demo] = await Promise.all([
        prisma.connectedAccount.count({ where: { status: "mock_connected" } }),
        prisma.brand.count({ where: { name: { contains: "Northwind" } } }),
      ]);
      check("F) no demo/mock data", mock === 0 && demo === 0);
    } finally {
      await prisma.reputationItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.contentItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.connectedAccount.deleteMany({ where: { brandId: brand.id } });
      await prisma.brand.deleteMany({ where: { id: brand.id } });
    }
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Google Business Profile connector`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
