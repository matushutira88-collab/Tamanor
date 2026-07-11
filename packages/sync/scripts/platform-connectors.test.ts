/**
 * V1.31 Platform Connector Foundation. Verifies the capability model, normalized
 * action results, error mapping, and the safe connector registry — plus that the
 * product UI reads capabilities honestly and Facebook wording/state-truth are
 * unchanged. Facebook is the only implemented connector; other platforms are
 * reserved types that must degrade safely (never crash).
 *
 * Run via: pnpm platform-connectors:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  Platform, platformKeyFor, getPlatformConnector, getCapabilities, isPlatformSupported,
  normalizeFacebookReason, mapFacebookError, hiddenStateWordingKey, HIDDEN_FROM_PUBLIC_REASONS,
  FACEBOOK_CAPABILITIES, UNSUPPORTED_CAPABILITIES, type PlatformActionResult,
} from "@guardora/core";
import { facebookConnector, getPlatformActionAdapter } from "@guardora/sync";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const accounts = readSrc("apps/web/src/app/dashboard/accounts/page.tsx");
  const control = readSrc("apps/web/src/app/dashboard/control-center/page.tsx");
  const comments = readSrc("apps/web/src/app/dashboard/comments/page.tsx");
  const rep = readSrc("apps/web/src/app/dashboard/reputation/page.tsx");
  const aqDetail = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");

  const fb = getPlatformConnector("facebook");
  const ig = getPlatformConnector("linkedin"); // research/unimplemented (V1.35)

  // 1) Foundation types/functions exist and are usable.
  check("1) connector foundation exists", typeof getPlatformConnector === "function" && typeof getCapabilities === "function" && typeof normalizeFacebookReason === "function" && !!FACEBOOK_CAPABILITIES);

  // 2) Facebook connector is registered.
  check("2) Facebook connector registered", isPlatformSupported("facebook") === true && fb.supported === true && facebookConnector.platform === "facebook");

  // 3) getPlatformConnector("facebook") returns the Facebook connector.
  check("3) getPlatformConnector(facebook)", fb.platform === "facebook" && platformKeyFor(Platform.FacebookPage) === "facebook" && !!getPlatformActionAdapter("facebook"));

  // 4) Unsupported platform returns controlled behavior, never crashes.
  check("4) unsupported platform is safe", ig.supported === false && Object.values(ig.capabilities).every((v) => v === false) && ig.normalizeReason("live_hide_executed") === "missing_capability" && getPlatformActionAdapter("linkedin") === null && platformKeyFor(Platform.LinkedInCompany) === "linkedin");

  // 4b) Instagram is now a supported read-only connector (not the unsupported fallback).
  check("4b) Instagram supported read-only", getPlatformConnector("instagram").supported === true && getPlatformConnector("instagram").capabilities.canReadComments === true && getPlatformConnector("instagram").capabilities.canHideComment === false);

  // 5) Facebook capabilities include read + hide.
  check("5) FB caps: read + hide", fb.capabilities.canReadComments === true && fb.capabilities.canHideComment === true);

  // 6) Facebook supports a public-hidden state.
  check("6) FB caps: public-hidden state", fb.capabilities.supportsPublicHiddenState === true && fb.capabilities.canVerifyHiddenState === true);

  // 7) Facebook: hidden may still be visible to author/admin.
  check("7) FB caps: author/admin still see", fb.capabilities.publicHiddenStillVisibleToAuthorOrAdmin === true);

  // Honesty: Guardora exposes NO delete/reply/like/ban/report action.
  check("7b) FB caps expose no delete/reply/like/ban/report", [fb.capabilities.canDeleteComment, fb.capabilities.canReplyToComment, fb.capabilities.canLikeComment, fb.capabilities.canBanAuthor, fb.capabilities.canReportComment].every((v) => v === false));

  // 8) Hide result → normalized live_hide_executed.
  check("8) live_hide_executed normalized", fb.normalizeReason("live_hide_executed") === "live_hide_executed" && HIDDEN_FROM_PUBLIC_REASONS.includes("live_hide_executed"));

  // 9) already_hidden → resolved hidden-from-public.
  check("9) already_hidden = hidden-from-public", fb.normalizeReason("already_hidden") === "already_hidden" && HIDDEN_FROM_PUBLIC_REASONS.includes("already_hidden"));

  // 10) comment_deleted → unavailable, NOT hidden.
  check("10) comment_deleted = unavailable, not hidden", fb.normalizeReason("comment_deleted") === "comment_deleted_or_unavailable" && !HIDDEN_FROM_PUBLIC_REASONS.includes("comment_deleted_or_unavailable"));

  // 11) can_hide=false → platform limitation, NOT token error.
  check("11) can_hide=false = platform limitation", fb.normalizeReason("facebook_can_hide_false") === "platform_did_not_allow" && fb.normalizeReason("facebook_can_hide_false") !== "token_invalid");

  // 12) dry_run → test/history only, never live hidden.
  check("12) dry_run never live-hidden", fb.normalizeReason("live_hide_executed", "dry_run") === "dry_run" && !HIDDEN_FROM_PUBLIC_REASONS.includes("dry_run"));

  // 13) token invalid → reconnect / token_invalid.
  check("13) token invalid mapped", fb.normalizeReason("token_expired") === "token_invalid" && mapFacebookError({ code: "token_expired" }) === "token_invalid" && mapFacebookError({ reason: "OAuth session expired" }) === "token_invalid");

  // Error mapping coverage (K).
  check("13b) error mapping: perms/rate/deleted/unknown", mapFacebookError({ reason: "permission missing" }) === "missing_capability" && mapFacebookError({ code: "rate_limit" }) === "rate_limited" && mapFacebookError({ reason: "comment not found" }) === "comment_deleted_or_unavailable" && mapFacebookError({ code: "weird" }) === "unknown_error");

  // 14/18) Provider codes / raw ids are not rendered in the default product UI.
  for (const [name, src] of [["comments", comments], ["reputation", rep], ["control-center", control]] as const) {
    check(`14/18) ${name}: no provider codes / raw ids`, !src.includes("providerResponseCode") && !src.includes("providerErrorCode") && !src.includes("policyId") && !/>\{[^{}]*externalCommentId[^{}]*\}</.test(src));
  }
  // Accounts page keeps raw pageId/permissions behind Advanced only.
  check("18b) accounts: raw pageId/permissions behind Advanced", accounts.includes("<details") && /<details[\s\S]*?pageIdLabel[\s\S]*?grantedPermsLabel/.test(accounts) && !/<details open/.test(accounts));

  // 15) Accounts page shows a human capability summary.
  check("15) accounts capability summary (human language)", accounts.includes("getPlatformConnector(platformKeyFor(a.platform))") && accounts.includes("hdrT.cap.summaryTitle") && accounts.includes("hdrT.cap.commentsOn") && accounts.includes("hdrT.cap.visibilityNote") && sk.includes("Komentáre: sledovanie zapnuté") && sk.includes("Skrytie pre verejnosť: podporované"));

  // 16) Control Center is capability-aware (does not hardcode "every platform can hide").
  check("16) Control Center capability-aware", control.includes("anyHideUnsupported") && control.includes("getPlatformConnector(platformKeyFor(p.platform))") && control.includes("t.cc.hideUnsupportedNote") && sk.includes("Táto platforma nepodporuje automatické skrytie"));

  // 17) Facebook hidden wording is still "hidden from public"; wording is capability-driven.
  check("17) FB hidden wording = hidden-from-public (capability-driven)", fb.hiddenStateKey() === "hiddenFromPublic" && hiddenStateWordingKey(FACEBOOK_CAPABILITIES) === "hiddenFromPublic" && comments.includes("hiddenStateKey()") && comments.includes('hiddenFromPublic: "st_hidden"') && /st_hidden: "Skryté pre verejnosť"/.test(sk));

  // Capability-aware fallbacks exist for future platforms (flag / manual review).
  check("17b) capability wording fallbacks exist", comments.includes("st_flagged") && comments.includes("st_manualReview") && en.includes('st_flagged:') && de.includes("st_manualReview"));

  // 19/20/21) State truth unchanged: the hidden set is exactly the live-hide reasons.
  check("19/20/21) state truth: hidden set unchanged", HIDDEN_FROM_PUBLIC_REASONS.length === 2 && HIDDEN_FROM_PUBLIC_REASONS.includes("live_hide_executed") && HIDDEN_FROM_PUBLIC_REASONS.includes("already_hidden") && normalizeFacebookReason(null, "dry_run") === "dry_run");

  // 22) No fake/demo data: unimplemented platforms are honestly unsupported (all caps off).
  check("22) no fake connectors", Object.values(UNSUPPORTED_CAPABILITIES).every((v) => v === false) && Object.values(getCapabilities("tiktok")).every((v) => v === false) && Object.values(getCapabilities("linkedin")).every((v) => v === false));

  // 23) SK/EN/DE capability i18n keys present.
  check("23) i18n cap keys (SK/EN/DE)", [en, sk, de].every((d) => /\bcap: \{/.test(d) && d.includes("summaryTitle") && d.includes("visibilityNote")) && en.includes('hideSupported: "Hide from public: supported"') && de.includes("Öffentlich verbergen: unterstützt"));

  // Sanity: a normalized result object is well-formed.
  const sample: PlatformActionResult = { platform: "facebook", actionType: "hide_comment", status: "executed", reason: fb.normalizeReason("live_hide_executed") };
  check("N) normalized result shape", sample.platform === "facebook" && sample.reason === "live_hide_executed" && sample.status === "executed");

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Platform Connector Foundation`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
