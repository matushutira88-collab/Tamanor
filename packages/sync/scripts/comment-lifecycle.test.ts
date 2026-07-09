/**
 * V1.27E — comment lifecycle after manual Facebook deletion.
 * A deleted/unavailable comment is a NEUTRAL resolved state — not a token error, not
 * reconnect, not live-possible. A completed hide (or already-hidden) resolves the
 * queue item out of approval_required. Mocks only; no token is ever logged.
 *
 * Run via: pnpm comment-lifecycle:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma, encryptToken } from "@guardora/db";
import { MockFacebookHideTransport } from "@guardora/connectors";
import { attemptFacebookHide, getCommentLifecycle, type HideContext } from "../src/live-actions";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const CFG = { liveEnabled: true, facebookHideEnabled: true, dryRun: false, canExecuteLive: true, liveConfirmed: true, productionSafeMode: false, globalKillSwitch: false };
let T = "test_tenant_v127e";

let seq = 0;
const ctx = (accountId: string, queueItemId: string, over: Partial<HideContext> = {}): HideContext => {
  const n = ++seq;
  return {
    tenantId: T, brandId: "LCB", itemId: `LC_I${n}`, queueItemId, policyId: "P_pol", connectedAccountId: accountId, platform: "facebook_page",
    externalCommentId: "C1", externalPostId: "P_post", matchedCategory: "scam", confidence: 0.95, riskLevel: "critical",
    mode: "approval", trigger: "approval",
    account: { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: "RAWTOK", pageId: "TOK_PAGE", externalId: "TOK_PAGE", connectionStatus: "connected", tokenHealth: "ok" },
    requestedBy: "user", ...over,
  };
};

async function run() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) { console.error("no tenant found — seed first"); process.exit(1); }
  T = tenant.id;

  const brand = await prisma.brand.create({ data: { tenantId: T, name: "Comment Lifecycle Test Brand" } });
  const acct = await prisma.connectedAccount.create({
    data: { tenantId: T, brandId: brand.id, platform: "facebook_page", status: "active", health: "healthy", mode: "read_only", externalId: "TOK_PAGE", pageId: "TOK_PAGE", grantedPermissions: ["pages_manage_engagement"], accessToken: encryptToken("RAWTOK"), connectionStatus: "connected", tokenHealth: "ok" },
  });
  const mkQueue = async (id: string) => prisma.actionQueueItem.create({ data: { id, tenantId: T, brandId: brand.id, itemId: id + "_item", category: "scam", confidence: 0.95, proposedAction: "hide_comment", queueState: "approval_required" } });
  const cleanup = async () => {
    await prisma.platformActionExecution.deleteMany({ where: { connectedAccountId: acct.id } });
    await prisma.auditLog.deleteMany({ where: { brandId: brand.id } });
    await prisma.actionQueueItem.deleteMany({ where: { brandId: brand.id } });
    await prisma.connectedAccount.deleteMany({ where: { id: acct.id } });
    await prisma.brand.deleteMany({ where: { id: brand.id } });
  };

  try {
    // 1) Graph comment not found → comment_deleted_or_unavailable (+ no reconnect / no token error).
    const qDel = await mkQueue("LC_DEL");
    const tDel = new MockFacebookHideTransport({ ok: true }, { comment: { ok: false, errorCode: "not_found" }, pageToken: { ok: true, pageId: "TOK_PAGE" } });
    const rDel = await attemptFacebookHide(ctx(acct.id, qDel.id), { config: CFG, transport: tDel, liveAttempt: true });
    const acctDel = await prisma.connectedAccount.findUnique({ where: { id: acct.id }, select: { connectionStatus: true } });
    check("1) comment not found → blocked/comment_deleted_or_unavailable", rDel.status === "blocked" && rDel.reason === "comment_deleted_or_unavailable", `${rDel.status}/${rDel.reason}`);
    check("2) deleted comment does not allow hide (no POST)", tDel.calls.length === 0);
    check("3) deleted comment does not mark reconnect / token error", rDel.reason !== "reconnect_required" && acctDel?.connectionStatus === "connected");

    // getCommentLifecycle mapping.
    const lcDeleted = await getCommentLifecycle({ accountId: acct.id, commentId: "C1" }, { transport: new MockFacebookHideTransport({ ok: true }, { comment: { ok: false, errorCode: "not_found" } }) });
    check("1b) getCommentLifecycle → deleted", lcDeleted.status === "deleted", lcDeleted.status);
    const lcHidden = await getCommentLifecycle({ accountId: acct.id, commentId: "C1" }, { transport: new MockFacebookHideTransport({ ok: true }, { comment: { ok: true, canHide: true, isHidden: true } }) });
    check("1c) getCommentLifecycle → hidden", lcHidden.status === "hidden");
    const lcVisible = await getCommentLifecycle({ accountId: acct.id, commentId: "C1" }, { transport: new MockFacebookHideTransport({ ok: true }, { comment: { ok: true, canHide: true, isHidden: false } }) });
    check("1d) getCommentLifecycle → visible", lcVisible.status === "visible");
    const lcCannot = await getCommentLifecycle({ accountId: acct.id, commentId: "C1" }, { transport: new MockFacebookHideTransport({ ok: true }, { comment: { ok: true, canHide: false, isHidden: false } }) });
    check("1e) getCommentLifecycle → cannot_hide", lcCannot.status === "cannot_hide");

    // deleted resolves the queue item out of approval_required.
    const qDelRow = await prisma.actionQueueItem.findUnique({ where: { id: qDel.id }, select: { queueState: true } });
    check("3b) deleted comment resolves queue item (out of approval_required)", qDelRow?.queueState === "no_action", qDelRow?.queueState);

    // 4) successful live hide updates queue state out of approval_required.
    const qHide = await mkQueue("LC_HIDE");
    const tHide = new MockFacebookHideTransport({ ok: true, responseCode: "200" }, { comment: { ok: true, canHide: true, isHidden: false }, pageToken: { ok: true, pageId: "TOK_PAGE" } });
    const rHide = await attemptFacebookHide(ctx(acct.id, qHide.id), { config: CFG, transport: tHide, liveAttempt: true });
    const qHideRow = await prisma.actionQueueItem.findUnique({ where: { id: qHide.id }, select: { queueState: true } });
    check("4) successful live hide → executed + queue leaves approval_required", rHide.status === "executed" && tHide.calls.some((c) => c.op === "hide") && qHideRow?.queueState === "executed", `${rHide.status}/${qHideRow?.queueState}`);

    // 5) already_hidden (is_hidden=true) → executed/already_hidden + queue resolved, no POST.
    const qAlready = await mkQueue("LC_ALREADY");
    const tAlready = new MockFacebookHideTransport({ ok: true }, { comment: { ok: true, canHide: true, isHidden: true }, pageToken: { ok: true, pageId: "TOK_PAGE" } });
    const rAlready = await attemptFacebookHide(ctx(acct.id, qAlready.id), { config: CFG, transport: tAlready, liveAttempt: true });
    const qAlreadyRow = await prisma.actionQueueItem.findUnique({ where: { id: qAlready.id }, select: { queueState: true } });
    check("5) already_hidden → executed/already_hidden + queue resolved, no POST", rAlready.status === "executed" && rAlready.reason === "already_hidden" && tAlready.calls.length === 0 && qAlreadyRow?.queueState === "executed", `${rAlready.reason}/${qAlreadyRow?.queueState}`);

    // no token leak.
    const rows = JSON.stringify(await prisma.platformActionExecution.findMany({ where: { connectedAccountId: acct.id } }));
    check("no token leak", !rows.includes("RAWTOK") && !rows.includes("plain:"));

    // Source: diagnose + UI wiring.
    const diag = readSrc("packages/sync/scripts/facebook-hide-diagnose.ts");
    check("4b) diagnose maps not_found → comment_deleted_or_unavailable", diag.includes("comment_deleted_or_unavailable") && /errorCode === "not_found"/.test(diag));
    const aq = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
    check("UI) Action Queue shows deleted state, hides live/rollback, allows mark handled", aq.includes("commentDeleted") && aq.includes("markHandledQueueItem") && aq.includes("t.cc.commentDeleted"));

    // --- V1.27F post-hide workflow ---
    const actionsSrc = readSrc("apps/web/src/app/dashboard/action-queue/[id]/actions.ts");
    check("PH1) web action resolves executed item + sets approvedByUserId", /res\.status === "executed"[\s\S]*?queueState: "executed", approvedByUserId: session\.userId/.test(actionsSrc));
    check("PH2) diagnose loads latest execution FIRST (executed prioritized)", diag.includes("latest_execution") && /platformActionExecution\.findFirst/.test(diag) && diag.includes("executedOk"));
    check("PH3) diagnose → hidden_or_unavailable_after_execution (not blocked/generic) after a 200 execution", diag.includes("hidden_or_unavailable_after_execution") && /executedOk/.test(diag));
    check("PH4) restore button gated on ROLLBACK_AVAILABLE", aq.includes("ROLLBACK_AVAILABLE"));
  } finally {
    await cleanup();
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Comment lifecycle`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
