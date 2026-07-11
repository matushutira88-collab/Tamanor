/**
 * V1.32B Instagram moderation — research/test-gated hide & unhide. Verifies the
 * gated action path, normalized result mapping, permission diagnostics, and that
 * the default UI stays conservative (no production IG hide, no auto-hide, no raw
 * provider errors). Facebook behavior and state truth are unchanged. Pure — no DB.
 *
 * Run via: pnpm instagram-moderation:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { HIDDEN_FROM_PUBLIC_REASONS, hideCapabilityState, getPlatformConnector } from "@guardora/core";
import { getInstagramActionsConfig } from "@guardora/config";
import {
  runInstagramModerationTest, mapInstagramActionResult, mapInstagramActionError,
  instagramModerationStatus, instagramModerationDiagnostics,
} from "@guardora/sync";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const INPUT = { accountId: "IG1", externalCommentId: "C1", externalPostId: "M1" };
const OFF = {}; // no env → gates fail-closed
const ON = { INSTAGRAM_HIDE_TEST_ENABLED: "true", INSTAGRAM_HIDE_TEST_CONFIRM: "YES" };
const ENABLED_NOT_CONFIRMED = { INSTAGRAM_HIDE_TEST_ENABLED: "true" };

async function run() {
  const comments = readSrc("apps/web/src/app/dashboard/comments/page.tsx");
  const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
  const control = readSrc("apps/web/src/app/dashboard/control-center/page.tsx");
  const accounts = readSrc("apps/web/src/app/dashboard/accounts/page.tsx");
  const aqDetail = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");
  const ig = getPlatformConnector("instagram");

  // 1) Moderation action methods exist behind the connector.
  check("1) IG moderation methods exist", [runInstagramModerationTest, mapInstagramActionResult, mapInstagramActionError, instagramModerationDiagnostics].every((f) => typeof f === "function"));

  // 2) Hide blocked by default safety gates.
  const hideOff = await runInstagramModerationTest("hide", INPUT, { source: OFF });
  check("2) hide blocked by default", hideOff.status === "blocked" && hideOff.reason === "blocked_by_safety_gate");

  // 3) Unhide blocked by default safety gates.
  const unhideOff = await runInstagramModerationTest("unhide", INPUT, { source: OFF });
  check("3) unhide blocked by default", unhideOff.status === "blocked" && unhideOff.reason === "blocked_by_safety_gate");

  // 4) Auto-hide remains disabled — even with the auto-hide env set, nothing runs.
  const autoCfg = getInstagramActionsConfig({ INSTAGRAM_AUTO_HIDE_ENABLED: "true" });
  const viaAuto = await runInstagramModerationTest("hide", INPUT, { source: ON, viaAutomation: true });
  check("4) auto-hide disabled", autoCfg.canExecuteTest === false && viaAuto.reason === "blocked_by_safety_gate" && ig.capabilities.canModerateAutomatically === false);

  // 5-9) Error mapping.
  check("5) missing permission mapped", mapInstagramActionError({ reason: "instagram_manage_comments permission missing" }) === "missing_permission");
  check("6) token invalid mapped", mapInstagramActionError({ reason: "OAuth token expired" }) === "token_invalid");
  check("7) comment unavailable mapped", mapInstagramActionError({ reason: "comment not found" }) === "comment_unavailable");
  check("8) media not found mapped", mapInstagramActionError({ reason: "media not found" }) === "media_not_found");
  check("9) rate limit mapped", mapInstagramActionError({ code: "rate limit exceeded" }) === "rate_limited");

  // 10) Unknown provider error stays provider_error (and is an Advanced-only field).
  const provErr = mapInstagramActionResult("hide", { error: { code: "weird_graph_thing" }, providerResponseCode: "#999" }, INPUT);
  check("10) provider_error + advanced-only fields", mapInstagramActionError({ code: "weird_graph_thing" }) === "provider_error" && provErr.reason === "provider_error" && provErr.providerResponseCode === "#999");

  // 11) With gates enabled+confirmed and an executor, a normalized hide request runs.
  const executed = await runInstagramModerationTest("hide", INPUT, { source: ON, executor: async () => ({ ok: true }) });
  check("11) gated hide builds normalized request", executed.status === "executed" && executed.reason === "instagram_hide_executed" && executed.platform === "instagram" && executed.externalCommentId === "C1");

  // 12/13) Success mapping.
  check("12) hide success → instagram_hide_executed", mapInstagramActionResult("hide", { ok: true }, INPUT).reason === "instagram_hide_executed");
  check("13) unhide success → instagram_unhide_executed", mapInstagramActionResult("unhide", { ok: true }, INPUT).reason === "instagram_unhide_executed");

  // 14/15) already_* mapping.
  check("14) already_hidden mapped", mapInstagramActionResult("hide", { alreadyHidden: true }, INPUT).reason === "already_hidden");
  check("15) already_visible mapped", mapInstagramActionResult("unhide", { alreadyVisible: true }, INPUT).reason === "already_visible");

  // 16) Dry-run/test mode never counts as live hidden.
  const dry = await runInstagramModerationTest("hide", INPUT, { source: ENABLED_NOT_CONFIRMED, executor: async () => ({ ok: true }) });
  check("16) enabled-but-unconfirmed → dry_run (nothing sent)", dry.status === "no_action" && dry.reason === "dry_run");

  // 17) Instagram hidden is NOT part of the Facebook/production hidden set.
  check("17) IG hidden not in FB hidden set", HIDDEN_FROM_PUBLIC_REASONS.length === 2 && !HIDDEN_FROM_PUBLIC_REASONS.includes("instagram_hide_executed" as never) && !HIDDEN_FROM_PUBLIC_REASONS.includes("instagram_unhide_executed" as never));

  // 18) Hidden-from-public UI is driven by the FB hide set only (no IG state truth yet).
  check("18) Comments hidden uses FB hide set only", comments.includes('HIDE_REASONS = ["live_hide_executed", "already_hidden"]') && !comments.includes("instagram_hide_executed"));

  // 19) Command Center does not claim IG auto-hide is enabled.
  check("19) CC no IG auto-hide claim", !cc.includes("instagram_hide_executed") && ig.capabilities.canHideComment === false && ig.capabilities.canModerateAutomatically === false);

  // 20) Control Center says IG moderation is research/test gated.
  check("20) Control Center IG research/test gated", control.includes("t.cc.instagramMonitorNote") && sk.includes("je možné zapnúť až po overení oprávnení a testovaní"));

  // 21) Accounts says IG hide is test-only / not enabled.
  check("21) Accounts IG hide test-only", accounts.includes("hideCapabilityState") && accounts.includes("hdrT.cap.hideTestOnly") && sk.includes("dostupné na testovanie, nie je zapnuté") && hideCapabilityState("instagram") === "test_only");

  // 22) Action Queue shows no production approve-hide for IG (live UI gated off).
  check("22) Action Queue no production IG hide", aqDetail.includes("isInstagram") && /liveMode = [^\n]*isFacebook/.test(aqDetail) && aqDetail.includes("t.cc.instagramQueueNote"));

  // 23) No delete/reply/like/ban/report actions enabled.
  check("23) no delete/reply/like/ban/report", ["delete_comment", "reply", "like", "ban_author", "report"].every((a) => ig.blockedReason(a as never) === "missing_capability") && [ig.capabilities.canDeleteComment, ig.capabilities.canReplyToComment, ig.capabilities.canLikeComment, ig.capabilities.canBanAuthor, ig.capabilities.canReportComment].every((v) => v === false));

  // 24) No raw Graph/provider errors in the default UI.
  for (const [name, src] of [["comments", comments], ["command-center", cc], ["control-center", control]] as const) {
    check(`24) ${name}: no raw provider errors`, !src.includes("providerResponseCode") && !src.includes("providerErrorCode") && !src.includes("providerErrorMessage"));
  }

  // Permission diagnostics (B).
  check("B) permission diagnostics", instagramModerationStatus({ grantedPermissions: [], accountFound: true, tokenValid: true }) === "moderation_permission_missing"
    && instagramModerationStatus({ grantedPermissions: ["instagram_manage_comments"], accountFound: true, tokenValid: true }) === "read_ok"
    && instagramModerationStatus({ grantedPermissions: [], accountFound: false }) === "account_not_found"
    && instagramModerationStatus({ grantedPermissions: [], tokenValid: false }) === "token_invalid"
    && instagramModerationStatus({ grantedPermissions: ["instagram_manage_comments"], appReviewApproved: false }) === "app_review_required");

  // Diagnostics object is gate-aware and never "ready" without confirmed gates.
  const diag = instagramModerationDiagnostics({ accountId: "IG1", grantedPermissions: ["instagram_basic", "instagram_manage_comments"], accountFound: true, tokenValid: true, source: OFF });
  check("I) diagnostics gate-aware", diag.status === "read_ok" && diag.hasReadPermission && diag.hasModerationPermission && diag.canHideTest === false);

  // 25/26/27) State truth unchanged: FB hide set intact; FB connector unchanged.
  check("25/26/27) FB unchanged", getPlatformConnector("facebook").capabilities.canHideComment === true && getPlatformConnector("facebook").blockedReason("hide_comment") === null && HIDDEN_FROM_PUBLIC_REASONS.includes("live_hide_executed"));

  // 28) No fabricated success — default path never invents a hidden result.
  check("28) no fabricated IG success", hideOff.status !== "executed" && unhideOff.status !== "executed");

  // 29) SK/EN/DE i18n keys present.
  check("29) i18n keys (SK/EN/DE)", [en, sk, de].every((d) => d.includes("hideTestOnly") && d.includes("instagramMonitorNote") && d.includes("instagramQueueNote")));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Instagram moderation (research/test-gated)`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
