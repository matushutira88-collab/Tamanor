/**
 * V1.32A Instagram Business Connector — READ-ONLY comment sync. Verifies the
 * connector registration, read-only capabilities (no hide/auto-hide), account
 * discovery, comment normalization/dedupe, error mapping, and that Instagram
 * comments/actors flow through the existing pipeline WITHOUT cross-platform
 * identity merge and WITHOUT any fake hidden-from-public state.
 *
 * Run via: pnpm instagram-connector:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import {
  Platform, platformKeyFor, getPlatformConnector, INSTAGRAM_CAPABILITIES, actorIdentityKey,
  mapInstagramSyncError, HIDDEN_FROM_PUBLIC_REASONS,
} from "@guardora/core";
import {
  instagramConnector, getReadOnlySyncConnector, normalizeInstagramComment,
  dedupeNormalizedComments, findLinkedInstagramAccount,
} from "@guardora/sync";
import { buildActorSignals, actorRiskScore, actorRiskLevel, sentimentBucket, type ActorComment } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const bucket = (cats: string[], sentiment = "neutral", riskLevel = "none") => sentimentBucket({ categories: cats, sentiment, riskLevel });

async function run() {
  const comments = readSrc("apps/web/src/app/dashboard/comments/page.tsx");
  const actor = readSrc("apps/web/src/app/dashboard/actor-risk/page.tsx");
  const rep = readSrc("apps/web/src/app/dashboard/reputation/page.tsx");
  const accounts = readSrc("apps/web/src/app/dashboard/accounts/page.tsx");
  const control = readSrc("apps/web/src/app/dashboard/control-center/page.tsx");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");
  const ig = getPlatformConnector("instagram");

  // 1) Instagram platform key registered.
  check("1) Instagram platform key registered", platformKeyFor(Platform.InstagramBusiness) === "instagram" && ig.supported === true);

  // 2) getPlatformConnector("instagram") returns Instagram connector, not unsupported.
  check("2) Instagram connector returned", ig.capabilities === INSTAGRAM_CAPABILITIES && getReadOnlySyncConnector("instagram") === instagramConnector && getReadOnlySyncConnector("tiktok") === null);

  // 3) Instagram capabilities are read-only in V1.32A.
  check("3) Instagram read-only capabilities", ig.capabilities.canReadComments === true && ig.capabilities.canHideComment === false && ig.capabilities.canModerateAutomatically === false && [ig.capabilities.canDeleteComment, ig.capabilities.canReplyToComment, ig.capabilities.canLikeComment, ig.capabilities.canBanAuthor, ig.capabilities.canReportComment].every((v) => v === false));

  // 4) canReadComments=true.
  check("4) canReadComments=true", ig.capabilities.canReadComments === true && ig.capabilities.canReadPostComments === true);

  // 5) canHideComment=false.
  check("5) canHideComment=false", ig.capabilities.canHideComment === false && ig.capabilities.supportsPublicHiddenState === false);

  // 6) canModerateAutomatically=false.
  check("6) canModerateAutomatically=false", ig.capabilities.canModerateAutomatically === false);

  // 7) Instagram hideComment returns missing_capability.
  check("7) hide → missing_capability", ig.blockedReason("hide_comment") === "missing_capability" && ig.canPerform("hide_comment") === false && ig.blockedReason("reply") === "missing_capability");

  // 8) Account discovery handles a linked IG Business account.
  const disc = findLinkedInstagramAccount({ id: "PAGE1", name: "Acme", instagram_business_account: { id: "IG1", username: "acme" } });
  check("8) discovers linked IG account", disc?.externalId === "IG1" && disc?.linkedPageId === "PAGE1" && disc?.username === "acme");

  // 9) Missing IG account returns product-friendly state.
  check("9) missing IG account = null + friendly copy", findLinkedInstagramAccount({ id: "PAGE1" }) === null && en.includes("No connected Instagram Business account") && sk.includes("nebol nájdený pripojený Instagram Business účet"));

  // 10) Missing permission maps to missing_permission (a product-level reason, not raw error).
  check("10) missing permission mapped", mapInstagramSyncError({ reason: "instagram_manage_comments permission missing" }) === "missing_permission" && sk.includes("Chýba oprávnenie alebo pripojenie Instagram Business účtu"));

  // Error mapping coverage (O).
  check("10b) sync error mapping", mapInstagramSyncError({ reason: "OAuth token expired" }) === "token_invalid" && mapInstagramSyncError({ code: "no linked instagram" }) === "account_not_found" && mapInstagramSyncError({ reason: "media not found" }) === "media_not_found" && mapInstagramSyncError({ code: "rate limit" }) === "rate_limited" && mapInstagramSyncError({ code: "weird" }) === "provider_error");

  // 11) Instagram media/comment IDs normalize safely.
  const norm = normalizeInstagramComment({ id: "C1", text: "nice", from: { id: "A1", username: "bob" }, timestamp: "2026-01-01T00:00:00+0000", media: { id: "M1", caption: "post caption", permalink: "https://instagr.am/p/x" } }, "IG1");
  check("11) normalizes IG comment", norm.platform === "instagram" && norm.externalCommentId === "C1" && norm.externalPostId === "M1" && norm.authorExternalId === "A1" && norm.authorDisplayName === "bob" && norm.accountId === "IG1" && norm.permalink === "https://instagr.am/p/x");

  // 12) Dedupe by platform + externalCommentId.
  check("12) dedupe by platform+id", dedupeNormalizedComments([norm, { ...norm }, { ...norm, externalCommentId: "C2" }]).length === 2);

  // 13) Instagram comments store platform=instagram.
  check("13) normalized platform=instagram", norm.platform === "instagram" && instagramConnector.platform === "instagram");

  // 14) Comments page is platform-agnostic (shows IG alongside FB, labelled).
  check("14) Comments page shows any platform", !comments.includes('platform: "facebook') && comments.includes("PLATFORM_META[ci.platform") && comments.includes("platformKeyFor(ci.platform)"));

  // 15) Reputation aggregates all platforms (no platform filter).
  check("15) Reputation aggregates all platforms", !rep.includes('platform: "facebook') && !rep.includes("platform: Platform.FacebookPage"));

  // 16) Actor Risk keys are platform-scoped (no cross-platform merge).
  check("16) actor keys platform-scoped", actor.includes("actorIdentityKey(platformKeyFor(ci.platform)") && actorIdentityKey("instagram", "SHARED") !== actorIdentityKey("facebook", "SHARED"));

  // 17/23) No Instagram public-hidden state and no auto-hide UI.
  check("17/23) IG never hidden-from-public / no auto-hide", ig.capabilities.supportsPublicHiddenState === false && ig.capabilities.canHideComment === false && comments.includes("cantHide") && comments.includes("t.comments.cantHideNote"));

  // 20) Accounts page shows IG capability summary (not-yet-enabled wording).
  check("20) Accounts IG capability summary", accounts.includes("hdrT.cap.hideNotYet") && accounts.includes("hdrT.cap.actionsDepend") && accounts.includes("getPlatformConnector(platformKeyFor(a.platform))") && sk.includes("Skrytie pre verejnosť: zatiaľ nie je zapnuté"));

  // 21) Control Center says Instagram is monitoring/review-only.
  check("21) Control Center IG monitoring note", control.includes("hasInstagram") && control.includes("t.cc.instagramMonitorNote") && sk.includes("Instagram je zatiaľ v režime sledovania"));

  // 22) No raw IG ids / provider errors in the default UI.
  check("22) no raw ids / provider errors default", !comments.includes("providerResponseCode") && !/>\{[^{}]*externalCommentId[^{}]*\}</.test(comments) && accounts.includes("<details") && !/<details open/.test(accounts));

  // 24) Facebook connector unchanged.
  check("24) Facebook connector intact", getPlatformConnector("facebook").capabilities.canHideComment === true && getPlatformConnector("facebook").supported === true);

  // 27) State truth: IG has no hide reasons; the hidden set is unchanged.
  check("27) state truth intact", HIDDEN_FROM_PUBLIC_REASONS.length === 2 && !HIDDEN_FROM_PUBLIC_REASONS.includes("missing_capability" as never));

  // 29) i18n SK/EN/DE keys present.
  check("29) i18n cap/cc/comments IG keys", [en, sk, de].every((d) => d.includes("hideNotYet") && d.includes("instagramMonitorNote") && d.includes("cantHideNote") && d.includes("igNoAccount")));

  // ---- DB fixture: IG comments flow through; actors do NOT merge with Facebook ----
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (tenant) {
    const T = tenant.id;
    const brand = await prisma.brand.create({ data: { tenantId: T, name: "Instagram Sync Test Brand" } });
    const igAcct = await prisma.connectedAccount.create({ data: { tenantId: T, brandId: brand.id, platform: "instagram_business", status: "active", mode: "read_only", externalId: "IG_ACCT", pageId: "IG_ACCT" } });
    const fbAcct = await prisma.connectedAccount.create({ data: { tenantId: T, brandId: brand.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: "FB_ACCT", pageId: "FB_ACCT" } });
    const mk = async (acctId: string, platform: string, author: string, text: string, cats: string[], risk: string, sentiment: string, ext: string) => {
      const ci = await prisma.contentItem.create({ data: { tenantId: T, brandId: brand.id, connectedAccountId: acctId, platform: platform as never, kind: "comment", externalId: ext, externalParentId: "MEDIA1", authorExternalId: author, authorDisplayName: author, text, publishedAt: new Date() } });
      const ri = await prisma.reputationItem.create({ data: { tenantId: T, brandId: brand.id, platform: platform as never, contentItemId: ci.id, riskLevel: risk as never, riskCategories: cats, sentiment: sentiment as never } });
      return ri.id;
    };
    try {
      await mk(igAcct.id, "instagram_business", "IGFAN", "super!", ["positive_feedback"], "none", "positive", "ig_p1");
      const igRisky = await mk(igAcct.id, "instagram_business", "SHARED", "kúp http://x.co", ["scam"], "high", "neutral", "ig_s1");
      await mk(igAcct.id, "instagram_business", "SHARED", "kúp http://x.co", ["scam"], "high", "neutral", "ig_s2");
      await mk(fbAcct.id, "facebook_page", "SHARED", "spam odkaz", ["scam"], "high", "neutral", "fb_s1");
      // A risky IG comment routed to review (rules require approval) — pending, NOT hidden.
      await prisma.actionQueueItem.create({ data: { tenantId: T, brandId: brand.id, itemId: igRisky, category: "scam", proposedAction: "hide_comment", queueState: "approval_required" } });

      const reps = await prisma.reputationItem.findMany({ where: { brandId: brand.id }, select: { id: true, riskLevel: true, riskCategories: true, sentiment: true, contentItem: { select: { platform: true, authorExternalId: true, externalId: true, externalParentId: true, text: true } } } });
      const igReps = reps.filter((r) => r.contentItem.platform === "instagram_business");
      // 13/14) IG comments stored + present.
      check("F13/14) IG comments captured (platform=instagram_business)", igReps.length === 3 && reps.length === 4);

      // 16) Actor keys platform-scoped — SHARED on IG and FB are two different actors.
      const byAuthor = new Map<string, ActorComment[]>();
      for (const r of reps) {
        const k = actorIdentityKey(platformKeyFor(r.contentItem.platform), r.contentItem.authorExternalId, r.contentItem.authorDisplayName)!;
        (byAuthor.get(k) ?? byAuthor.set(k, []).get(k)!).push({ categories: r.riskCategories, riskLevel: r.riskLevel as string, sentiment: r.sentiment as string, postId: r.contentItem.externalParentId, text: r.contentItem.text, hidden: false });
      }
      check("F16) no cross-platform merge", byAuthor.has("instagram:id:SHARED") && byAuthor.has("facebook:id:SHARED") && byAuthor.get("instagram:id:SHARED")!.length === 2 && byAuthor.get("facebook:id:SHARED")!.length === 1);

      // 17) IG risky comments count as hidden = 0 (no executions exist).
      const hides = await prisma.platformActionExecution.count({ where: { brandId: brand.id, status: "executed", reason: { in: ["live_hide_executed", "already_hidden"] } } });
      check("F17) IG risky not hidden-from-public", hides === 0 && igReps.filter((r) => bucket(r.riskCategories, r.sentiment as string, r.riskLevel as string) === "risky").length === 2);

      // 18) IG risky can become pending/manual review.
      const pending = await prisma.actionQueueItem.count({ where: { brandId: brand.id, queueState: "approval_required" } });
      check("F18) IG risky can be pending", pending === 1);

      // 19) No fake IG hidden count — IG actor still flags on behavior, without hidden signal.
      const igShared = actorRiskLevel(actorRiskScore(buildActorSignals(byAuthor.get("instagram:id:SHARED")!)));
      check("F19/20) IG actor flags on behavior (no hidden signal)", ["medium", "high", "critical"].includes(igShared));

      // 28) No demo/mock data.
      const [mock, demo] = await Promise.all([
        prisma.connectedAccount.count({ where: { status: "mock_connected" } }),
        prisma.brand.count({ where: { name: { contains: "Northwind" } } }),
      ]);
      check("F28) no demo/mock data", mock === 0 && demo === 0);
    } finally {
      await prisma.actionQueueItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.reputationItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.contentItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.connectedAccount.deleteMany({ where: { brandId: brand.id } });
      await prisma.brand.deleteMany({ where: { id: brand.id } });
    }
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Instagram Business Connector (read-only)`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
