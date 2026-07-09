/**
 * Controlled Facebook hide — safety-gate + connector + data tests.
 * Run via: pnpm fbhide:test
 * Default env keeps live actions OFF: everything blocks or dry-runs, and the
 * transport is only ever called on an explicit live path with a MOCK transport.
 */
import { prisma } from "@guardora/db";
import { hideComment, unhideComment, MockFacebookHideTransport } from "@guardora/connectors";
import { attemptFacebookHide, type HideContext } from "../src/live-actions";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

let T = "test_tenant_v121b"; // replaced with a real tenant id at runtime (audit FK)
const CFG = {
  default: { liveEnabled: false, facebookHideEnabled: false, dryRun: true, canExecuteLive: false },
  fbOff: { liveEnabled: true, facebookHideEnabled: false, dryRun: true, canExecuteLive: false },
  dryRun: { liveEnabled: true, facebookHideEnabled: true, dryRun: true, canExecuteLive: false },
  live: { liveEnabled: true, facebookHideEnabled: true, dryRun: false, canExecuteLive: true },
};
const baseCtx = (over: Partial<HideContext> = {}): HideContext => ({
  tenantId: T, brandId: "B1", itemId: "I1", connectedAccountId: "A1", platform: "facebook_page",
  externalCommentId: "C1", externalPostId: "P_post", decision: "would_auto_hide",
  matchedCategory: "profanity", confidence: 0.9, riskLevel: "critical", policyMode: "auto_hide_live_reserved",
  account: { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: "SECRET_TOKEN", pageId: "P1", externalId: "P1" },
  requestedBy: "system", trigger: "auto_protect", ...over,
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

  // --- Safety gates ---
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
  check("7) normal_criticism → blocked/safety_normal_criticism", g7.status === "blocked" && g7.reason === "safety_normal_criticism", `${g7.status}/${g7.reason}`);

  const g8 = await attemptFacebookHide(baseCtx({ confidence: 0.6 }), { config: CFG.live, transport: new MockFacebookHideTransport() });
  check("8) low confidence → blocked/low_confidence", g8.status === "blocked" && g8.reason === "low_confidence", `${g8.status}/${g8.reason}`);

  const g9 = await attemptFacebookHide(baseCtx({ matchedCategory: "competitor_promo" }), { config: CFG.live, transport: new MockFacebookHideTransport() });
  check("9) competitor_promo → blocked/category_not_live_eligible", g9.status === "blocked" && g9.reason === "category_not_live_eligible", `${g9.status}/${g9.reason}`);

  const t10 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const g10 = await attemptFacebookHide(baseCtx(), { config: CFG.live, transport: t10 });
  check("10) all gates + live → transport called once, executed", g10.status === "executed" && t10.calls.length === 1 && t10.calls[0]!.op === "hide", `${g10.status}/calls=${t10.calls.length}`);

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

  // rollback seam dry-run only
  const ru = await unhideComment({ pageId: "P1", commentId: "C1", connectedAccountId: "A1", itemId: "I1", pageAccessToken: "x" }, { transport: new MockFacebookHideTransport() });
  check("rollback unhide is dry-run only", ru.status === "dry_run");

  // --- Data ---
  const rows = await prisma.platformActionExecution.findMany({ where: { tenantId: T } });
  check("15) PlatformActionExecution persists", rows.length >= 10);
  const rowStr = JSON.stringify(rows);
  check("16) no tokens/secrets in execution rows", !rowStr.includes("SECRET_TOKEN") && !rowStr.includes("pageAccessToken"));
  const audits = await prisma.auditLog.count({ where: { tenantId: T, targetType: "platform_action_execution" } });
  check("17) audit events written", audits >= 10);
  const executed = await prisma.platformActionExecution.count({ where: { tenantId: T, status: "executed" } });
  const dryRunCount = await prisma.platformActionExecution.count({ where: { tenantId: T, status: "dry_run" } });
  const blocked = await prisma.platformActionExecution.count({ where: { tenantId: T, status: "blocked" } });
  check("18) default/blocked env produced 0 executed except explicit live-mock test", executed === 1, String(executed));
  check("19) dry-run counted separately from executed (distinct status buckets)", dryRunCount >= 1 && executed >= 1 && blocked >= 1, `dry=${dryRunCount} exec=${executed} blocked=${blocked}`);

  await cleanup();
  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — controlled Facebook hide gates`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
