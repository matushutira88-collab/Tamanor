/**
 * Controlled Facebook hide — ControlPolicy-driven gates + connector + data tests.
 * Run via: pnpm fbhide:test
 * Default env keeps live actions OFF: everything blocks or dry-runs, and the
 * transport is only ever called on an explicit live path with a MOCK transport.
 */
import { prisma } from "@guardora/db";
import { hideComment, unhideComment, MockFacebookHideTransport } from "@guardora/connectors";
import { attemptFacebookHide, predictHideOutcome, type HideContext } from "../src/live-actions";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

let T = "test_tenant_v121b";
const CFG = {
  default: { liveEnabled: false, facebookHideEnabled: false, dryRun: true, canExecuteLive: false, liveConfirmed: false },
  fbOff: { liveEnabled: true, facebookHideEnabled: false, dryRun: true, canExecuteLive: false, liveConfirmed: false },
  dryRun: { liveEnabled: true, facebookHideEnabled: true, dryRun: true, canExecuteLive: false, liveConfirmed: false },
  // Env allows live but NOT confirmed → still blocked (second lock).
  live: { liveEnabled: true, facebookHideEnabled: true, dryRun: false, canExecuteLive: true, liveConfirmed: false },
  // Env allows live AND confirmed → real execution possible (mock transport in tests).
  liveConfirmed: { liveEnabled: true, facebookHideEnabled: true, dryRun: false, canExecuteLive: true, liveConfirmed: true },
};
const baseCtx = (over: Partial<HideContext> = {}): HideContext => ({
  tenantId: T, brandId: "B1", itemId: "I1", queueItemId: "Q1", policyId: "P_pol", connectedAccountId: "A1", platform: "facebook_page",
  externalCommentId: "C1", externalPostId: "P_post", matchedCategory: "scam", confidence: 0.9, riskLevel: "critical",
  mode: "autonomous", trigger: "autonomous",
  account: { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: "SECRET_TOKEN", pageId: "P1", externalId: "P1" },
  requestedBy: "system", ...over,
});

async function cleanup() {
  await prisma.platformActionExecution.deleteMany({ where: { tenantId: T } });
  await prisma.auditLog.deleteMany({ where: { tenantId: T, targetType: "platform_action_execution" } });
}

async function run() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) { console.error("no tenant found — seed first"); process.exit(1); }
  T = tenant.id;
  await cleanup();

  const g1 = await attemptFacebookHide(baseCtx(), { config: CFG.default, transport: new MockFacebookHideTransport() });
  check("1) LIVE_ACTIONS_ENABLED=false → blocked/global_disabled", g1.status === "blocked" && g1.reason === "global_disabled", `${g1.status}/${g1.reason}`);

  const g2 = await attemptFacebookHide(baseCtx(), { config: CFG.fbOff, transport: new MockFacebookHideTransport() });
  check("2) FACEBOOK_HIDE_ENABLED=false → blocked/facebook_hide_disabled", g2.status === "blocked" && g2.reason === "facebook_hide_disabled", `${g2.status}/${g2.reason}`);

  const t3 = new MockFacebookHideTransport();
  const g3 = await attemptFacebookHide(baseCtx(), { config: CFG.dryRun, transport: t3 });
  check("3) DRY_RUN=true → dry_run, transport NOT called", g3.status === "dry_run" && t3.calls.length === 0, `${g3.status}/calls=${t3.calls.length}`);

  const g4 = await attemptFacebookHide(baseCtx({ account: { status: "active", health: "healthy", grantedPermissions: ["pages_read_engagement"], externalId: "P1" } }), { config: CFG.live, transport: new MockFacebookHideTransport() });
  check("4) missing permission → blocked/missing_permission", g4.status === "blocked" && g4.reason === "missing_permission", `${g4.status}/${g4.reason}`);

  const g5 = await attemptFacebookHide(baseCtx({ account: { status: "mock_connected", health: "healthy", grantedPermissions: ["pages_manage_engagement"], externalId: "P1" } }), { config: CFG.live, transport: new MockFacebookHideTransport() });
  check("5) mock account → blocked/account_is_demo", g5.status === "blocked" && g5.reason === "account_is_demo", `${g5.status}/${g5.reason}`);

  const g6 = await attemptFacebookHide(baseCtx({ platform: "instagram_business" }), { config: CFG.live, transport: new MockFacebookHideTransport() });
  check("6) unsupported platform → blocked/unsupported_platform", g6.status === "blocked" && g6.reason === "unsupported_platform", `${g6.status}/${g6.reason}`);

  const g7 = await attemptFacebookHide(baseCtx({ matchedCategory: "normal_criticism" }), { config: CFG.live, transport: new MockFacebookHideTransport() });
  check("7) normal_criticism → blocked/safety_never_autonomous", g7.status === "blocked" && g7.reason === "safety_never_autonomous", `${g7.status}/${g7.reason}`);

  // 8) legal/refund/safety → never autonomous.
  for (const cat of ["legal_complaint", "refund_complaint", "safety_claim"]) {
    const g = await attemptFacebookHide(baseCtx({ matchedCategory: cat }), { config: CFG.live, transport: new MockFacebookHideTransport() });
    check(`8) ${cat} → blocked/safety_never_autonomous`, g.status === "blocked" && g.reason === "safety_never_autonomous", `${g.status}/${g.reason}`);
  }

  const g9 = await attemptFacebookHide(baseCtx({ confidence: 0.6 }), { config: CFG.live, transport: new MockFacebookHideTransport() });
  check("9) low confidence → blocked/low_confidence", g9.status === "blocked" && g9.reason === "low_confidence", `${g9.status}/${g9.reason}`);

  // autonomous trigger requires policy mode=autonomous.
  const gna = await attemptFacebookHide(baseCtx({ mode: "approval", trigger: "autonomous" }), { config: CFG.live, transport: new MockFacebookHideTransport() });
  check("autonomous trigger + mode!=autonomous → blocked/policy_not_autonomous", gna.status === "blocked" && gna.reason === "policy_not_autonomous", `${gna.status}/${gna.reason}`);

  // V1.25 second lock: live env WITHOUT LIVE_HIDE_TEST_CONFIRM=YES → still blocked.
  const tlock = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const glock = await attemptFacebookHide(baseCtx(), { config: CFG.live, transport: tlock });
  check("live env unconfirmed → blocked/live_confirm_required, transport NOT called", glock.status === "blocked" && glock.reason === "live_confirm_required" && tlock.calls.length === 0, `${glock.status}/${glock.reason}/calls=${tlock.calls.length}`);

  // 10) all gates + live + confirmed → transport called once, executed.
  const t10 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const g10 = await attemptFacebookHide(baseCtx(), { config: CFG.liveConfirmed, transport: t10 });
  check("10) all gates + live + confirmed → transport called once, executed", g10.status === "executed" && t10.calls.length === 1 && t10.calls[0]!.op === "hide", `${g10.status}/calls=${t10.calls.length}`);

  // approval trigger works with mode=approval + all gates + confirmed.
  const gap = await attemptFacebookHide(baseCtx({ mode: "approval", trigger: "approval" }), { config: CFG.liveConfirmed, transport: new MockFacebookHideTransport({ ok: true, responseCode: "200" }) });
  check("approval trigger + gates + confirmed → executed", gap.status === "executed", gap.status);

  // --- Connector ---
  const t11 = new MockFacebookHideTransport();
  const r11 = await hideComment({ pageId: "P1", commentId: "C1", connectedAccountId: "A1", itemId: "I1", pageAccessToken: "x" }, { dryRun: true, transport: t11 });
  check("11) hideComment dry-run never calls transport", r11.status === "dry_run" && t11.calls.length === 0);

  const r12 = await hideComment({ pageId: "P1", commentId: "C1", connectedAccountId: "A1", itemId: "I1", pageAccessToken: "x" }, { dryRun: false, transport: new MockFacebookHideTransport({ ok: true, responseCode: "200" }) });
  check("12) hideComment live success → executed", r12.status === "executed" && r12.providerResponseCode === "200");

  const r13 = await hideComment({ pageId: "P1", commentId: "C1", connectedAccountId: "A1", itemId: "I1", pageAccessToken: "x" }, { dryRun: false, transport: new MockFacebookHideTransport({ ok: false, errorCode: "generic", errorMessage: "nope" }) });
  check("13) hideComment live error → failed, no fake success", r13.status === "failed" && r13.providerErrorCode === "generic");

  const r14 = await hideComment({ pageId: "P1", commentId: "C1", connectedAccountId: "A1", itemId: "I1", pageAccessToken: "x" }, { dryRun: false, transport: new MockFacebookHideTransport({ ok: false, responseCode: "429", errorCode: "rate_limit", errorMessage: "slow down" }) });
  check("14) rate limit → failed/rate_limit", r14.status === "failed" && r14.providerErrorCode === "rate_limit");

  const ru = await unhideComment({ pageId: "P1", commentId: "C1", connectedAccountId: "A1", itemId: "I1", pageAccessToken: "x" }, { transport: new MockFacebookHideTransport() });
  check("rollback unhide is dry-run only", ru.status === "dry_run");

  // --- Data ---
  const rows = await prisma.platformActionExecution.findMany({ where: { tenantId: T } });
  check("15) PlatformActionExecution persists", rows.length >= 10);
  const rowStr = JSON.stringify(rows);
  check("16) no tokens/secrets in execution rows", !rowStr.includes("SECRET_TOKEN") && !rowStr.includes("pageAccessToken"));
  check("17) execution rows carry policyId + queueItemId + trigger", rows.every((r) => r.trigger === "autonomous" || r.trigger === "approval") && rows.some((r) => r.policyId === "P_pol") && rows.some((r) => r.queueItemId === "Q1"));
  const executed = await prisma.platformActionExecution.count({ where: { tenantId: T, status: "executed" } });
  const dryRunCount = await prisma.platformActionExecution.count({ where: { tenantId: T, status: "dry_run" } });
  const blocked = await prisma.platformActionExecution.count({ where: { tenantId: T, status: "blocked" } });
  check("18) only explicit live-mock tests executed (2)", executed === 2, String(executed));
  check("19) dry-run/blocked counted separately from executed", dryRunCount >= 1 && blocked >= 1, `dry=${dryRunCount} exec=${executed} blocked=${blocked}`);

  // --- V1.25 dry-run flow + prediction ---
  // Dry-run creates a dry_run execution + audit event, transport NOT called, executed stays 0.
  await cleanup();
  const tdry = new MockFacebookHideTransport();
  const gdry = await attemptFacebookHide(baseCtx(), { config: CFG.dryRun, transport: tdry });
  const dryAudit = await prisma.auditLog.count({ where: { tenantId: T, event: "platform_action.dry_run", targetType: "platform_action_execution" } });
  check("dry-run creates dry_run execution + audit, no transport, live=0", gdry.status === "dry_run" && tdry.calls.length === 0 && dryAudit >= 1 && (await prisma.platformActionExecution.count({ where: { tenantId: T, status: "executed" } })) === 0);

  // predictHideOutcome mirrors the gate without executing.
  check("predict: default env (all off) → blocked/global_disabled", (() => { const p = predictHideOutcome(baseCtx(), CFG.default); return p.expected === "blocked" && p.reason === "global_disabled"; })());
  check("predict: dry-run env → dry_run", predictHideOutcome(baseCtx(), CFG.dryRun).expected === "dry_run");
  check("predict: normal_criticism → blocked", predictHideOutcome(baseCtx({ matchedCategory: "normal_criticism" }), CFG.dryRun).expected === "blocked");
  check("predict: live unconfirmed → blocked/live_confirm_required", (() => { const p = predictHideOutcome(baseCtx(), CFG.live); return p.expected === "blocked" && p.reason === "live_confirm_required"; })());
  check("predict: live confirmed + gates → live_possible", predictHideOutcome(baseCtx(), CFG.liveConfirmed).expected === "live_possible");

  await cleanup();
  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — controlled Facebook hide gates`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
