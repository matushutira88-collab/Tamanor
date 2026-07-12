/**
 * V1.37 Unified Brand Inbox V2 — provider-neutral. Verifies the provider
 * capability registry, capability-driven action gating (no provider-specific UI
 * logic), bulk-action eligibility, Google read-only enforcement, honest connector
 * health, provider + content-type filters, and that Facebook/Instagram behavior
 * and state truth are unchanged.
 *
 * Run via: pnpm unified-inbox:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  providerCapabilities, inboxAvailableActions, isInboxActionAvailable, bulkEligibleActions,
  connectorHealthStatus, TAMANOR_SIDE_ACTIONS, getCapabilities, type PlatformKey, type InboxAction,
} from "@guardora/core";
import { sentimentBucket } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const WRITE: InboxAction[] = ["hide", "reply", "delete", "ban"];
const ALL: PlatformKey[] = ["facebook", "instagram", "youtube", "google_business", "linkedin", "tiktok"];

async function run() {
  const comments = readSrc("apps/web/src/app/dashboard/comments/page.tsx");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");

  // 1) Registry: every provider exposes capability flags derived from its profile.
  check("1) provider capability registry", ALL.every((p) => {
    const f = providerCapabilities(p), c = getCapabilities(p);
    return f.canHideComment === c.canHideComment && f.canReply === c.canReplyToComment && f.canDeleteComment === c.canDeleteComment
      && f.canBanUser === c.canBanAuthor && f.supportsReviews === c.canReviewSync && f.canReadContent === (c.canReadComments || c.canReviewSync)
      && f.supportsDM === false && f.supportsMedia === false && f.supportsRealtime === false;
  }));

  // 2) Facebook flags.
  const fb = providerCapabilities("facebook");
  check("2) Facebook flags", fb.canReadContent && fb.canHideComment && !fb.canReply && !fb.canDeleteComment && !fb.canBanUser && !fb.supportsReviews);

  // 3) Instagram flags (read, no write, no reviews).
  const ig = providerCapabilities("instagram");
  check("3) Instagram flags", ig.canReadContent && !ig.canHideComment && !ig.canReply && !ig.supportsReviews);

  // 4) Google Business flags (reviews + ratings, NO write).
  const gb = providerCapabilities("google_business");
  check("4) Google Business flags", gb.canReadContent && gb.supportsReviews && gb.supportsRatings && !gb.canHideComment && !gb.canReply && !gb.canDeleteComment && !gb.canBanUser);

  // 5) YouTube flags (read comments, no write, no reviews).
  const yt = providerCapabilities("youtube");
  check("5) YouTube flags", yt.canReadContent && !yt.canHideComment && !yt.canReply && !yt.supportsReviews);

  // 6) Action engine: Tamanor-side actions always available; write actions capability-gated.
  check("6) capability-driven actions", ALL.every((p) => TAMANOR_SIDE_ACTIONS.every((a) => inboxAvailableActions(p).includes(a)))
    && inboxAvailableActions("facebook").includes("hide")
    && WRITE.every((a) => !inboxAvailableActions("google_business").includes(a)));

  // 7) Unhealthy connector → no platform write actions (fail-closed).
  check("7) unhealthy → no write actions", !inboxAvailableActions("facebook", { connectorHealthy: false }).includes("hide") && inboxAvailableActions("facebook", { connectorHealthy: false }).includes("read"));

  // 8) isInboxActionAvailable is capability-truthful.
  check("8) action availability truthful", isInboxActionAvailable("hide", "facebook") === true && isInboxActionAvailable("hide", "instagram") === false && isInboxActionAvailable("hide", "google_business") === false && isInboxActionAvailable("read", "google_business") === true);

  // 9) Bulk eligibility: ONLY Tamanor-side actions are bulk-safe (write is never bulk).
  check("9) bulk eligibility", JSON.stringify(bulkEligibleActions("google_business")) === JSON.stringify(["read", "archive", "label", "approve_ai"]) && WRITE.every((a) => !bulkEligibleActions("facebook").includes(a)));

  // 10) Google read-only enforcement — no write capability or action, anywhere.
  check("10) Google read-only", [gb.canHideComment, gb.canReply, gb.canDeleteComment, gb.canBanUser].every((v) => v === false) && inboxAvailableActions("google_business").filter((a) => WRITE.includes(a)).length === 0);

  // 11) Connector health is honest (no fake green).
  check("11) honest connector health",
    connectorHealthStatus({ platform: "tiktok", supported: false }) === "api_unavailable"
    && connectorHealthStatus({ platform: "facebook", supported: true, status: "disconnected" }) === "disconnected"
    && connectorHealthStatus({ platform: "facebook", supported: true, status: "active", lastError: "permission scope missing" }) === "permission_missing"
    && connectorHealthStatus({ platform: "facebook", supported: true, status: "active", lastError: "rate limit" }) === "rate_limited"
    && connectorHealthStatus({ platform: "google_business", supported: true, status: "active", reviewPlatform: true, verifiedLocationCount: 0 }) === "verification_pending"
    && connectorHealthStatus({ platform: "facebook", supported: true, status: "active", health: "healthy" }) === "healthy");

  // 12) Comments page has provider + content-type filters (identical across providers).
  check("12) provider + type filters", comments.includes("sp.provider") && comments.includes("typeFilter") && comments.includes("r.providerKey !== provider") && comments.includes("allProviders") && comments.includes("typeReviews"));

  // 13) No provider-specific `if` for actions in the shared page — it is capability-driven.
  check("13) capability-driven UI (no hardcoded provider branch)", comments.includes("platformKeyFor(ci.platform)") && comments.includes("getPlatformConnector(platformKeyFor(ci.platform)).capabilities") && !/ci\.platform === "facebook_page"/.test(comments) && !/=== Platform\.FacebookPage/.test(comments));

  // 14) Search spans provider + location(account) too.
  check("14) search across provider/location", comments.includes("r.platformLabel.toLowerCase().includes(ql)") && comments.includes("r.account.toLowerCase().includes(ql)"));

  // 15) Review stats present (H).
  check("15) review stats", comments.includes("avgRating") && comments.includes("reviewRows") && en.includes("mReviews"));

  // 16) Facebook + Instagram regression (capabilities unchanged).
  check("16) FB/IG unchanged", getCapabilities("facebook").canHideComment === true && getCapabilities("instagram").canReadComments === true && getCapabilities("instagram").canHideComment === false);

  // 17) State truth unchanged.
  check("17) state truth unchanged", sentimentBucket({ categories: ["normal_criticism"], sentiment: "negative", riskLevel: "critical" }) !== "risky" && sentimentBucket({ categories: ["scam"], sentiment: "neutral", riskLevel: "none" }) === "risky");

  // 18) i18n keys present (SK/EN/DE).
  check("18) i18n keys", [en, sk, de].every((d) => d.includes("mReviews") && d.includes("allProviders") && d.includes("typeReviews") && d.includes("avgRating")));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Unified Brand Inbox V2`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
