/**
 * V1.35 Multi-Platform Connector Rollout (read-first). Verifies every platform
 * advertises TRUTHFUL, capability-derived support (no guessing, no overclaim):
 * Facebook = protection, Instagram = monitoring (moderation research/test),
 * YouTube = comment monitoring, Google Business = review monitoring, LinkedIn +
 * TikTok = research/unsupported. Unsupported actions are always gated. Facebook +
 * Instagram behavior, actor-identity scoping and state truth are unchanged.
 *
 * Run via: pnpm platform-rollout:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  getPlatformConnector, getCapabilities, isPlatformSupported, platformSupportLevel,
  platformCapabilityMatrix, actorIdentityKey, HIDDEN_FROM_PUBLIC_REASONS,
  FACEBOOK_CAPABILITIES, INSTAGRAM_CAPABILITIES, type PlatformKey,
} from "@guardora/core";
import { sentimentBucket } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const ALL: PlatformKey[] = ["facebook", "instagram", "youtube", "google_business", "linkedin", "tiktok"];
const NO_ACTION: ("hide_comment" | "delete_comment" | "reply" | "like" | "ban_author" | "report")[] = ["hide_comment", "delete_comment", "reply", "like", "ban_author", "report"];

async function run() {
  const accounts = readSrc("apps/web/src/app/dashboard/accounts/page.tsx");
  const comments = readSrc("apps/web/src/app/dashboard/comments/page.tsx");
  const actor = readSrc("apps/web/src/app/dashboard/actor-risk/page.tsx");
  const rep = readSrc("apps/web/src/app/dashboard/reputation/page.tsx");
  const aqDetail = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
  const readme = readSrc("README.md");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");

  // 1) Every platform has a capability profile + matrix (no crash, no undefined).
  check("1) all platforms have a truthful profile", ALL.every((p) => { const m = platformCapabilityMatrix(p); const c = getCapabilities(p); return typeof c.canHideComment === "boolean" && typeof m.supportsHide === "boolean"; }));

  // 2) Capability MATRIX is derived from real capabilities (never overclaims).
  check("2) matrix matches capabilities exactly", ALL.every((p) => {
    const c = getCapabilities(p), m = platformCapabilityMatrix(p);
    return m.supportsHide === c.canHideComment && m.supportsDelete === c.canDeleteComment && m.supportsReply === c.canReplyToComment
      && m.supportsLike === c.canLikeComment && m.supportsVerification === c.canVerifyHiddenState && m.supportsCommentSync === c.canReadComments
      && m.supportsReviewSync === c.canReviewSync && m.supportsAuthor === c.canFetchAuthor && m.supportsPost === c.canFetchPost;
  }));

  // 3) Facebook UNCHANGED (protection).
  const fb = getCapabilities("facebook");
  check("3) Facebook unchanged", fb === FACEBOOK_CAPABILITIES && fb.canReadComments && fb.canHideComment && fb.canVerifyHiddenState && fb.canModerateAutomatically && fb.supportsPublicHiddenState && fb.publicHiddenStillVisibleToAuthorOrAdmin && !fb.canReviewSync && [fb.canDeleteComment, fb.canReplyToComment, fb.canLikeComment, fb.canBanAuthor, fb.canReportComment].every((v) => !v) && platformSupportLevel("facebook") === "protection");

  // 4) Instagram UNCHANGED (monitoring; moderation research/test only).
  const ig = getCapabilities("instagram");
  check("4) Instagram unchanged", ig === INSTAGRAM_CAPABILITIES && ig.canReadComments && !ig.canHideComment && !ig.canModerateAutomatically && !ig.supportsPublicHiddenState && !ig.canReviewSync && platformSupportLevel("instagram") === "monitoring");

  // 5) YouTube = read-only comment monitoring (author + video ref), no moderation.
  const yt = getCapabilities("youtube");
  check("5) YouTube read-only monitoring", isPlatformSupported("youtube") && yt.canReadComments && yt.canFetchAuthor && yt.canFetchPost && !yt.canHideComment && !yt.canModerateAutomatically && !yt.canReviewSync && [yt.canDeleteComment, yt.canReplyToComment, yt.canLikeComment].every((v) => !v) && platformSupportLevel("youtube") === "monitoring");

  // 6) Google Business = read-only review sync (reviewer), no comments, no auto-reply.
  const gb = getCapabilities("google_business");
  check("6) Google Business review monitoring", isPlatformSupported("google_business") && gb.canReviewSync && gb.canFetchAuthor && !gb.canReadComments && !gb.canReplyToComment && !gb.canHideComment && platformSupportLevel("google_business") === "reviews");

  // 7) LinkedIn + TikTok = RESEARCH (unsupported, all caps off).
  for (const p of ["linkedin", "tiktok"] as const) {
    const c = getCapabilities(p);
    check(`7) ${p} research/unsupported`, !isPlatformSupported(p) && Object.values(c).every((v) => v === false) && platformSupportLevel(p) === "research" && getPlatformConnector(p).supported === false);
  }

  // 8) NO overclaim: ONLY Facebook can hide / moderate automatically.
  check("8) only Facebook can hide/moderate", ALL.filter((p) => getCapabilities(p).canHideComment).join() === "facebook" && ALL.filter((p) => getCapabilities(p).canModerateAutomatically).join() === "facebook");

  // 9) No platform (except Facebook hide) advertises destructive actions.
  check("9) no delete/reply/like/ban/report anywhere", ALL.every((p) => { const c = getCapabilities(p); return [c.canDeleteComment, c.canReplyToComment, c.canLikeComment, c.canBanAuthor, c.canReportComment].every((v) => v === false); }));

  // 10) Unsupported actions are gated to `missing_capability` (never silently allowed).
  check("10) unsupported actions gated", ALL.every((p) => {
    const conn = getPlatformConnector(p);
    // Hide is allowed only on Facebook; every other platform → missing_capability.
    const hideOk = p === "facebook" ? conn.blockedReason("hide_comment") === null : conn.blockedReason("hide_comment") === "missing_capability";
    // reply/delete/like/ban/report are gated on ALL platforms (Tamanor never does them).
    const restGated = NO_ACTION.filter((a) => a !== "hide_comment").every((a) => conn.blockedReason(a) === "missing_capability");
    return hideOk && restGated;
  }));

  // 11) Actor identity remains PLATFORM-SCOPED (never merged across platforms).
  const keys = ["facebook", "instagram", "youtube"].map((p) => actorIdentityKey(p as PlatformKey, "user123"));
  check("11) actor identity platform-scoped", new Set(keys).size === 3 && keys[0] === "facebook:id:user123" && keys[2] === "youtube:id:user123" && actor.includes("actorIdentityKey(platformKeyFor(ci.platform)") && comments.includes("actorIdentityKey(platformKeyFor(ci.platform)"));

  // 12) State truth UNCHANGED.
  check("12) state truth unchanged", HIDDEN_FROM_PUBLIC_REASONS.length === 2 && HIDDEN_FROM_PUBLIC_REASONS.includes("live_hide_executed") && HIDDEN_FROM_PUBLIC_REASONS.includes("already_hidden") && !HIDDEN_FROM_PUBLIC_REASONS.includes("instagram_hide_executed" as never) && sentimentBucket({ categories: ["normal_criticism"], sentiment: "negative", riskLevel: "critical" }) !== "risky");

  // 13) Accounts UI is capability-driven + honest (reviews / research labels).
  check("13) Accounts capability-driven UI", accounts.includes("platformSupportLevel") && accounts.includes("hdrT.cap.reviewsOn") && accounts.includes("hdrT.cap.researchBeta") && sk.includes("Recenzie: sledovanie zapnuté") && sk.includes("Výskum / beta"));

  // 14) No unsupported action buttons: production live-hide is Facebook-only; Comments/Reputation have no hide/reply/delete controls.
  check("14) unsupported actions never appear", /liveMode = [^\n]*isFacebook/.test(aqDetail) && !comments.includes("hideComment(") && !comments.includes("Reply") && !rep.includes("hideComment("));

  // 15) Comments/Reputation aggregate all platforms (platform-agnostic, labelled).
  check("15) Comments/Reputation aggregate all platforms", comments.includes("PLATFORM_META[ci.platform") && !comments.includes('platform: "facebook') && !rep.includes('platform: "facebook'));

  // 16) README platform matrix present + honest.
  check("16) README platform matrix", /Platform matrix/i.test(readme) && readme.includes("YouTube") && /Google Business/i.test(readme) && /research/i.test(readme) && readme.includes("platform-scoped"));

  // 17) i18n SK/EN/DE keys present.
  check("17) i18n keys (SK/EN/DE)", [en, sk, de].every((d) => d.includes("reviewsOn") && d.includes("researchBeta") && d.includes("limited")));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Multi-Platform Connector Rollout`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
