/**
 * V1.28A — Automatic Facebook comment hide.
 * The autonomous runtime path (sync/webhook → persistItem → attemptFacebookHide with
 * trigger=autonomous + safety context) hides clearly harmful comments with no human
 * click — with live comment preflight, POST + verification GET, decrypted Page token,
 * and terminal-block queue routing. Mocks only; no token is ever logged.
 *
 * Run via: pnpm auto-hide:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma, encryptToken, decryptToken } from "@guardora/db";
import { MockFacebookHideTransport, type FacebookHideTransport, type HideTransportResult, type CommentState, type PageTokenState } from "@guardora/connectors";
import { attemptFacebookHide, type HideContext } from "../src/live-actions";
import { DEFAULT_SAFETY_SETTINGS, type ProductionSafetyContext } from "../src/production-safety";
import { queueTabStates } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

// Transport whose hide POST returns 200 but the verify GET still says visible.
class VerifyFailTransport implements FacebookHideTransport {
  readonly name = "verify-fail";
  readonly calls: { op: "hide" | "unhide"; commentId: string }[] = [];
  async hide(commentId: string): Promise<HideTransportResult> { this.calls.push({ op: "hide", commentId }); return { ok: true, responseCode: "200" }; }
  async unhide(commentId: string): Promise<HideTransportResult> { this.calls.push({ op: "unhide", commentId }); return { ok: true, responseCode: "200" }; }
  async getCommentState(): Promise<CommentState> { return { ok: true, canHide: true, isHidden: false }; } // never flips
  async getPageTokenState(pageId: string): Promise<PageTokenState> { return { ok: true, pageId }; }
}

// Captures the token to prove the autonomous path sends the DECRYPTED value.
class TokenCapture extends MockFacebookHideTransport {
  seen: string[] = [];
  override async hide(commentId: string, token?: string): Promise<HideTransportResult> { this.seen.push(token ?? ""); return super.hide(commentId); }
}

const RAW = "EAAautotoken_raw_123";
// Production opt-in (no LIVE_HIDE_TEST_CONFIRM): productionSafeMode unlocks autonomous.
const CFG = { liveEnabled: true, facebookHideEnabled: true, dryRun: false, canExecuteLive: true, liveConfirmed: false, productionSafeMode: true, globalKillSwitch: false };
const ELIGIBLE = ["scam", "phishing", "spam", "profanity", "personal_attack", "hate_speech", "racism", "terrorism_extremism", "threat"];
const mkSafety = (over: Partial<ProductionSafetyContext> = {}): ProductionSafetyContext => ({
  flags: { productionSafeMode: true, globalKillSwitch: false },
  brandKillSwitch: false, accountKillSwitch: false,
  settings: { ...DEFAULT_SAFETY_SETTINGS, liveModeEnabled: true, autonomousHideEnabled: true, approvedAutoHideCategories: ELIGIBLE, ...(over.settings ?? {}) },
  counts: { dayCount: 0, hourCount: 0, categoryDayCount: 0, consecutiveWithoutReview: 0, ...(over.counts ?? {}) },
  categoryApprovedBefore: true, rollbackAvailable: true, ...over,
});

let T = "test_tenant_v128a";
let seq = 0;

async function run() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) { console.error("no tenant found — seed first"); process.exit(1); }
  T = tenant.id;

  const brand = await prisma.brand.create({ data: { tenantId: T, name: "AutoHide Test Brand" } });
  const acct = await prisma.connectedAccount.create({
    data: { tenantId: T, brandId: brand.id, platform: "facebook_page", status: "active", health: "healthy", mode: "read_only", externalId: "AH_PAGE", pageId: "AH_PAGE", grantedPermissions: ["pages_manage_engagement"], accessToken: encryptToken(RAW), connectionStatus: "connected", tokenHealth: "ok" },
  });
  const mkQueue = async (id: string) => prisma.actionQueueItem.create({ data: { id, tenantId: T, brandId: brand.id, itemId: id + "_item", category: "profanity", confidence: 0.92, proposedAction: "hide_comment", queueState: "approval_required" } });
  const ctx = (queueItemId: string, over: Partial<HideContext> = {}): HideContext => {
    const n = ++seq;
    return {
      tenantId: T, brandId: brand.id, itemId: `AH_I${n}`, queueItemId, policyId: "P_pol", connectedAccountId: acct.id, platform: "facebook_page",
      externalCommentId: "C1", externalPostId: "P_post", matchedCategory: "profanity", confidence: 0.92, riskLevel: "critical",
      mode: "autonomous", trigger: "autonomous",
      account: { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: decryptToken(encryptToken(RAW)), pageId: "AH_PAGE", externalId: "AH_PAGE", connectionStatus: "connected", tokenHealth: "ok" },
      requestedBy: "system", ...over,
    };
  };
  const cleanup = async () => {
    await prisma.platformActionExecution.deleteMany({ where: { connectedAccountId: acct.id } });
    await prisma.auditLog.deleteMany({ where: { brandId: brand.id } });
    await prisma.actionQueueItem.deleteMany({ where: { brandId: brand.id } });
    await prisma.connectedAccount.deleteMany({ where: { id: acct.id } });
    await prisma.brand.deleteMany({ where: { id: brand.id } });
  };

  try {
    // 1) profanity + autonomous + can_hide=true → executed/live_hide_executed, trigger=autonomous, verified.
    const q1 = await mkQueue("AH_Q1");
    const t1 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
    const r1 = await attemptFacebookHide(ctx(q1.id), { config: CFG, transport: t1, safety: mkSafety() });
    const row1 = await prisma.platformActionExecution.findFirst({ where: { queueItemId: q1.id }, orderBy: { createdAt: "desc" } });
    const q1row = await prisma.actionQueueItem.findUnique({ where: { id: q1.id }, select: { queueState: true } });
    check("1) profanity autonomous → executed/live_hide_executed, trigger=autonomous, executedAt set", r1.status === "executed" && r1.reason === "live_hide_executed" && row1?.trigger === "autonomous" && row1?.executedAt != null && row1?.providerResponseCode === "200", `${r1.status}/${r1.reason}`);
    check("1b) hide POST + verification GET performed, exactly one hide op", t1.calls.filter((c) => c.op === "hide").length === 1);
    check("1c) queue item resolved to executed (not active approval)", q1row?.queueState === "executed", q1row?.queueState);
    check("1d) executed autonomous hide excluded from default Active queue", !queueTabStates("active")!.includes("executed" as never));

    // 2) Graph receives the DECRYPTED raw token — never a plain:/encrypted tag.
    const q2 = await mkQueue("AH_Q2");
    const t2 = new TokenCapture({ ok: true, responseCode: "200" });
    const r2 = await attemptFacebookHide(ctx(q2.id), { config: CFG, transport: t2, safety: mkSafety() });
    check("2) autonomous hide sends decrypted raw token", r2.status === "executed" && t2.seen.length > 0 && t2.seen.every((tk) => tk === RAW && !tk.startsWith("plain:")), JSON.stringify(t2.seen.map((s) => s.slice(0, 6))));

    // 3) post-hide verification failure does NOT claim success.
    const q3 = await mkQueue("AH_Q3");
    const t3 = new VerifyFailTransport();
    const r3 = await attemptFacebookHide(ctx(q3.id), { config: CFG, transport: t3, safety: mkSafety() });
    check("3) POST 200 but verify says visible → failed/verification_failed (no fake success)", r3.status === "failed" && r3.reason === "verification_failed", `${r3.status}/${r3.reason}`);

    // 4) can_hide=false → blocked, no POST, queue resolved to no_action.
    const q4 = await mkQueue("AH_Q4");
    const t4 = new MockFacebookHideTransport({ ok: true }, { comment: { ok: true, canHide: false, isHidden: false } });
    const r4 = await attemptFacebookHide(ctx(q4.id), { config: CFG, transport: t4, safety: mkSafety() });
    const q4row = await prisma.actionQueueItem.findUnique({ where: { id: q4.id }, select: { queueState: true } });
    check("4) can_hide=false → blocked, no POST, queue resolved no_action", r4.status === "blocked" && r4.reason === "facebook_can_hide_false" && t4.calls.length === 0 && q4row?.queueState === "no_action", `${r4.reason}/${q4row?.queueState}`);

    // 5) deleted comment → comment_deleted_or_unavailable, queue no_action.
    const q5 = await mkQueue("AH_Q5");
    const t5 = new MockFacebookHideTransport({ ok: true }, { comment: { ok: false, errorCode: "not_found" } });
    const r5 = await attemptFacebookHide(ctx(q5.id), { config: CFG, transport: t5, safety: mkSafety() });
    const q5row = await prisma.actionQueueItem.findUnique({ where: { id: q5.id }, select: { queueState: true } });
    check("5) deleted comment → comment_deleted_or_unavailable, queue no_action", r5.status === "blocked" && r5.reason === "comment_deleted_or_unavailable" && q5row?.queueState === "no_action");

    // 6) token invalid at live preflight → reconnect_required, no POST.
    const q6 = await mkQueue("AH_Q6");
    const t6 = new MockFacebookHideTransport({ ok: true }, { comment: { ok: false, errorCode: "token_expired" } });
    const r6 = await attemptFacebookHide(ctx(q6.id), { config: CFG, transport: t6, safety: mkSafety() });
    check("6) token invalid → reconnect_required, no POST", r6.status === "blocked" && r6.reason === "reconnect_required" && t6.calls.length === 0);

    // 7) stale token self-heals before an autonomous hide (fresh page check OK → executes).
    await prisma.connectedAccount.update({ where: { id: acct.id }, data: { connectionStatus: "connected", tokenHealth: "ok" } });
    const q7 = await mkQueue("AH_Q7");
    const t7 = new MockFacebookHideTransport({ ok: true, responseCode: "200" }, { pageToken: { ok: true, pageId: "AH_PAGE" } });
    const r7 = await attemptFacebookHide(ctx(q7.id, { account: { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: RAW, pageId: "AH_PAGE", externalId: "AH_PAGE", connectionStatus: "needs_reconnect", tokenHealth: "expired" } }), { config: CFG, transport: t7, safety: mkSafety() });
    check("7) stale token self-heals → autonomous hide executes", r7.status === "executed", `${r7.status}/${r7.reason}`);

    // 8) never-autonomous categories.
    for (const cat of ["normal_criticism", "customer_question"]) {
      const t = new MockFacebookHideTransport({ ok: true });
      const r = await attemptFacebookHide(ctx(`no-${cat}` as never, { queueItemId: null, matchedCategory: cat }), { config: CFG, transport: t, safety: mkSafety() });
      check(`8) ${cat} never autonomous hides`, r.status === "blocked" && r.reason === "safety_never_live" && t.calls.length === 0, `${r.reason}`);
    }

    // 9) hourly cap + kill switch block.
    const t9 = new MockFacebookHideTransport({ ok: true });
    const r9 = await attemptFacebookHide(ctx("cap" as never, { queueItemId: null }), { config: CFG, transport: t9, safety: mkSafety({ counts: { dayCount: 0, hourCount: 3, categoryDayCount: 0, consecutiveWithoutReview: 0 } }) });
    check("9) hourly cap blocks", r9.status === "blocked" && r9.reason === "hourly_limit" && t9.calls.length === 0);
    const t9b = new MockFacebookHideTransport({ ok: true });
    const r9b = await attemptFacebookHide(ctx("kill" as never, { queueItemId: null }), { config: CFG, transport: t9b, safety: mkSafety({ accountKillSwitch: true }) });
    check("9b) kill switch blocks", r9b.status === "blocked" && r9b.reason === "account_kill_switch" && t9b.calls.length === 0);

    // 10) no token leak; only hide ops (no delete/reply/ban).
    const rows = JSON.stringify(await prisma.platformActionExecution.findMany({ where: { connectedAccountId: acct.id } }));
    check("10) no token logs", !rows.includes(RAW) && !rows.includes("plain:"));
    check("10b) only hide ops issued (no delete/reply/ban)", [t1, t4, t5, t6, t7].flatMap((tr) => tr.calls.map((c) => c.op)).every((op) => op === "hide"));

    // Source wiring: sync + webhook use the same path; terminal routing; Command Center.
    const syncSrc = readSrc("packages/sync/src/index.ts");
    check("W1) webhook uses runReadOnlySync (same path, no duplicated hide logic)", /processPendingWebhookEvents[\s\S]*?runReadOnlySync\(a\.id\)/.test(syncSrc));
    check("W2) autonomous trigger + safety context in persistItem", /trigger: "autonomous"[\s\S]*?\}, \{ safety \}\)/.test(syncSrc) && syncSrc.includes("loadProductionSafetyContext"));
    check("W3) persistItem terminal blocks do not route to approval", syncSrc.includes("facebook_can_hide_false") && syncSrc.includes("comment_deleted_or_unavailable"));
    const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
    check("W4) Command Center shows automatic protection + can_hide blocked count", cc.includes("autoProtectionOn") && cc.includes("blockedByCanHide"));
    const aq = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
    check("W5) auto-hidden detail shows public-hidden copy + gated Restore", aq.includes("t.cc.autoHiddenPublic") && /canApprove && ROLLBACK_AVAILABLE/.test(aq));
  } finally {
    await cleanup();
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Automatic Facebook hide`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
