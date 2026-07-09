/**
 * Controlled Facebook hide — ControlPolicy-driven gates + connector + data tests.
 * Run via: pnpm fbhide:test
 * Default env keeps live actions OFF: everything blocks or dry-runs, and the
 * transport is only ever called on an explicit live path with a MOCK transport.
 */
import { prisma } from "@guardora/db";
import { hideComment, unhideComment, MockFacebookHideTransport } from "@guardora/connectors";
import { attemptFacebookHide, predictHideOutcome, findPreflightDryRun, type HideContext } from "../src/live-actions";

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
// Each baseCtx() mints a UNIQUE action key by default so independent gate tests
// never collide with V1.25B idempotency. Idempotency tests pass explicit fixed ids.
let seq = 0;
const baseCtx = (over: Partial<HideContext> = {}): HideContext => {
  const n = ++seq;
  return {
    tenantId: T, brandId: "B1", itemId: `I${n}`, queueItemId: `Q${n}`, policyId: "P_pol", connectedAccountId: "A1", platform: "facebook_page",
    externalCommentId: "C1", externalPostId: "P_post", matchedCategory: "scam", confidence: 0.9, riskLevel: "critical",
    mode: "autonomous", trigger: "autonomous",
    account: { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: "SECRET_TOKEN", pageId: "P1", externalId: "P1" },
    requestedBy: "system", ...over,
  };
};

async function cleanup() {
  await prisma.platformActionExecution.deleteMany({ where: { tenantId: T, connectedAccountId: "A1" } });
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

  // V1.26: a plain approval (no liveAttempt) NEVER goes live — it caps at dry_run.
  const gapDry = await attemptFacebookHide(baseCtx({ mode: "approval", trigger: "approval" }), { config: CFG.liveConfirmed, transport: new MockFacebookHideTransport({ ok: true, responseCode: "200" }) });
  check("plain approval never goes live → dry_run", gapDry.status === "dry_run", gapDry.status);
  // The dedicated live button (liveAttempt) executes the approval live.
  const gapT = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const gap = await attemptFacebookHide(baseCtx({ mode: "approval", trigger: "approval" }), { config: CFG.liveConfirmed, transport: gapT, liveAttempt: true });
  check("approval + liveAttempt + gates + confirmed → executed", gap.status === "executed" && gapT.calls.length === 1, `${gap.status}/calls=${gapT.calls.length}`);

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

  const ru = await unhideComment({ pageId: "P1", commentId: "C1", connectedAccountId: "A1", itemId: "I1", pageAccessToken: "x" }, { dryRun: true, transport: new MockFacebookHideTransport() });
  check("rollback unhide dry-run does not call transport", ru.status === "dry_run");
  const ruLiveT = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const ruLive = await unhideComment({ pageId: "P1", commentId: "C1", connectedAccountId: "A1", itemId: "I1", pageAccessToken: "x" }, { dryRun: false, transport: ruLiveT });
  check("rollback unhide live calls transport (unhide op)", ruLive.status === "executed" && ruLiveT.calls.length === 1 && ruLiveT.calls[0]!.op === "unhide");

  // --- Data ---
  const rows = await prisma.platformActionExecution.findMany({ where: { tenantId: T, connectedAccountId: "A1" } });
  check("15) PlatformActionExecution persists", rows.length >= 10);
  const rowStr = JSON.stringify(rows);
  check("16) no tokens/secrets in execution rows", !rowStr.includes("SECRET_TOKEN") && !rowStr.includes("pageAccessToken"));
  check("17) execution rows carry policyId + queueItemId + trigger", rows.every((r) => r.trigger === "autonomous" || r.trigger === "approval") && rows.some((r) => r.policyId === "P_pol") && rows.every((r) => r.queueItemId != null));
  const executed = await prisma.platformActionExecution.count({ where: { tenantId: T, connectedAccountId: "A1", status: "executed" } });
  const dryRunCount = await prisma.platformActionExecution.count({ where: { tenantId: T, connectedAccountId: "A1", status: "dry_run" } });
  const blocked = await prisma.platformActionExecution.count({ where: { tenantId: T, connectedAccountId: "A1", status: "blocked" } });
  check("18) only explicit live-mock tests executed (2)", executed === 2, String(executed));
  check("19) dry-run/blocked counted separately from executed", dryRunCount >= 1 && blocked >= 1, `dry=${dryRunCount} exec=${executed} blocked=${blocked}`);

  // --- V1.25 dry-run flow + prediction ---
  // Dry-run creates a dry_run execution + audit event, transport NOT called, executed stays 0.
  await cleanup();
  const tdry = new MockFacebookHideTransport();
  const gdry = await attemptFacebookHide(baseCtx(), { config: CFG.dryRun, transport: tdry });
  const dryAudit = await prisma.auditLog.count({ where: { tenantId: T, event: "platform_action.dry_run", targetType: "platform_action_execution" } });
  check("dry-run creates dry_run execution + audit, no transport, live=0", gdry.status === "dry_run" && tdry.calls.length === 0 && dryAudit >= 1 && (await prisma.platformActionExecution.count({ where: { tenantId: T, connectedAccountId: "A1", status: "executed" } })) === 0);

  // predictHideOutcome mirrors the gate without executing.
  check("predict: default env (all off) → blocked/global_disabled", (() => { const p = predictHideOutcome(baseCtx(), CFG.default); return p.expected === "blocked" && p.reason === "global_disabled"; })());
  check("predict: dry-run env → dry_run", predictHideOutcome(baseCtx(), CFG.dryRun).expected === "dry_run");
  check("predict: normal_criticism → blocked", predictHideOutcome(baseCtx({ matchedCategory: "normal_criticism" }), CFG.dryRun).expected === "blocked");
  check("predict: live unconfirmed → blocked/live_confirm_required", (() => { const p = predictHideOutcome(baseCtx(), CFG.live); return p.expected === "blocked" && p.reason === "live_confirm_required"; })());
  check("predict: live confirmed + gates → live_possible", predictHideOutcome(baseCtx(), CFG.liveConfirmed).expected === "live_possible");

  // --- V1.25B idempotency ---
  await cleanup();

  // Double Approve → only ONE dry_run row; repeated approve returns the existing one.
  const idemCtx = baseCtx({ itemId: "IDEM_I", queueItemId: "IDEM_Q", trigger: "approval", mode: "approval" });
  const ti1 = new MockFacebookHideTransport();
  const ti2 = new MockFacebookHideTransport();
  const i1 = await attemptFacebookHide(idemCtx, { config: CFG.dryRun, transport: ti1 });
  const i2 = await attemptFacebookHide(idemCtx, { config: CFG.dryRun, transport: ti2 });
  const dryRows = await prisma.platformActionExecution.count({ where: { tenantId: T, queueItemId: "IDEM_Q", status: "dry_run" } });
  check("double approve creates only one dry_run execution", dryRows === 1, `rows=${dryRows}`);
  check("repeated approve returns existing dry_run", i1.id === i2.id && i2.status === "dry_run" && i2.idempotent === true && ti2.calls.length === 0);

  // Executed action never re-executes — returns already_executed, transport untouched.
  // (Live execution goes through the dedicated liveAttempt path — V1.26.)
  const exCtx = baseCtx({ itemId: "IDEM_EX", queueItemId: "IDEM_EXQ", trigger: "approval", mode: "approval" });
  const e1 = await attemptFacebookHide(exCtx, { config: CFG.liveConfirmed, transport: new MockFacebookHideTransport({ ok: true, responseCode: "200" }), liveAttempt: true });
  const tex2 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const e2 = await attemptFacebookHide(exCtx, { config: CFG.liveConfirmed, transport: tex2, liveAttempt: true });
  const exRows = await prisma.platformActionExecution.count({ where: { tenantId: T, queueItemId: "IDEM_EXQ", status: "executed" } });
  check("executed action cannot be executed again", e1.status === "executed" && e2.status === "executed" && e2.reason === "already_executed" && e2.idempotent === true && e1.id === e2.id && tex2.calls.length === 0 && exRows === 1, `${e2.status}/${e2.reason}/rows=${exRows}/calls=${tex2.calls.length}`);

  // Failed action does NOT retry on a repeated live click; only an explicit retry re-attempts.
  const failCtx = baseCtx({ itemId: "IDEM_F", queueItemId: "IDEM_FQ", trigger: "approval", mode: "approval" });
  const f1 = await attemptFacebookHide(failCtx, { config: CFG.liveConfirmed, transport: new MockFacebookHideTransport({ ok: false, errorCode: "generic", errorMessage: "nope" }), liveAttempt: true });
  const tf2 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const f2 = await attemptFacebookHide(failCtx, { config: CFG.liveConfirmed, transport: tf2, liveAttempt: true });
  check("failed action does not retry without explicit retry", f1.status === "failed" && f2.status === "failed" && f2.idempotent === true && f2.id === f1.id && tf2.calls.length === 0, `${f2.status}/idem=${f2.idempotent}/calls=${tf2.calls.length}`);
  const tf3 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const f3 = await attemptFacebookHide(failCtx, { config: CFG.liveConfirmed, transport: tf3, retry: true, liveAttempt: true });
  check("explicit retry re-attempts a failed action", f3.status === "executed" && f3.id !== f1.id && tf3.calls.length === 1, `${f3.status}/calls=${tf3.calls.length}`);

  // Blocked action re-runs only when gates/permissions actually change.
  const blkAcct = { status: "active", health: "healthy", grantedPermissions: ["pages_read_engagement"], externalId: "P1", pageId: "P1" };
  const blkCtx = baseCtx({ itemId: "IDEM_B", queueItemId: "IDEM_BQ", trigger: "approval", mode: "approval", account: blkAcct });
  const b1 = await attemptFacebookHide(blkCtx, { config: CFG.live, transport: new MockFacebookHideTransport() });
  const b2 = await attemptFacebookHide(blkCtx, { config: CFG.live, transport: new MockFacebookHideTransport() });
  check("repeated blocked (same gate) returns existing blocked", b1.status === "blocked" && b1.reason === "missing_permission" && b2.id === b1.id && b2.idempotent === true);
  const blkCtxGranted = { ...blkCtx, account: { ...blkAcct, grantedPermissions: ["pages_manage_engagement"] } };
  const b3 = await attemptFacebookHide(blkCtxGranted, { config: CFG.dryRun, transport: new MockFacebookHideTransport() });
  check("blocked → new attempt when permissions change", b3.id !== b1.id && b3.status === "dry_run");

  // Live actions executed stays 0 across the whole dry-run/default idempotency set…
  const executedDefault = await prisma.platformActionExecution.count({ where: { tenantId: T, queueItemId: { in: ["IDEM_Q", "IDEM_BQ"] }, status: "executed" } });
  check("live actions executed remains 0 in default/dry-run env", executedDefault === 0, String(executedDefault));
  // …and no tokens/secrets leaked into any idempotency row.
  const idemRows = await prisma.platformActionExecution.findMany({ where: { tenantId: T, queueItemId: { in: ["IDEM_Q", "IDEM_EXQ", "IDEM_FQ", "IDEM_BQ"] } } });
  const idemStr = JSON.stringify(idemRows);
  check("no token leaks in idempotency rows", !idemStr.includes("SECRET_TOKEN") && !idemStr.includes("pageAccessToken"));

  // --- V1.26 first controlled LIVE hide ---
  await cleanup();
  const liveCtx = (over: Partial<HideContext> = {}) => baseCtx({ itemId: "L_I", queueItemId: "L_Q", trigger: "approval", mode: "approval", ...over });

  // 1) live blocked if no prior dry-run — enforced via findPreflightDryRun (action layer).
  const noPre = await findPreflightDryRun({ tenantId: T, queueItemId: "L_NOPRE", policyId: "P_pol" });
  check("1) no prior dry-run → preflight null (live blocked by caller)", noPre === null);

  // seed a dry-run preflight for the live tests (plain approval → dry_run, trigger approval).
  const preT = new MockFacebookHideTransport();
  const pre = await attemptFacebookHide(liveCtx(), { config: CFG.dryRun, transport: preT });
  const preFound = await findPreflightDryRun({ tenantId: T, queueItemId: "L_Q", policyId: "P_pol" });
  check("1b) prior dry-run → preflight found, executedAt null", pre.status === "dry_run" && !!preFound && preFound.executedAt === null && preT.calls.length === 0);

  // 2) live blocked if LIVE_HIDE_TEST_CONFIRM != YES.
  const lt2 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const l2 = await attemptFacebookHide(liveCtx(), { config: CFG.live, transport: lt2, liveAttempt: true });
  check("2) live blocked if not confirmed → live_confirm_required, no call", l2.status === "blocked" && l2.reason === "live_confirm_required" && lt2.calls.length === 0, `${l2.status}/${l2.reason}/calls=${lt2.calls.length}`);

  // 3) live blocked if dry-run still true.
  const lt3 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const l3 = await attemptFacebookHide(liveCtx(), { config: CFG.dryRun, transport: lt3, liveAttempt: true });
  check("3) live blocked if DRY_RUN still true → dry_run_still_enabled, no call", l3.status === "blocked" && l3.reason === "dry_run_still_enabled" && lt3.calls.length === 0, `${l3.status}/${l3.reason}`);

  // 4) live blocked if missing pages_manage_engagement.
  const lt4 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const l4 = await attemptFacebookHide(liveCtx({ account: { status: "active", health: "healthy", grantedPermissions: ["pages_read_engagement"], externalId: "P1", pageId: "P1" } }), { config: CFG.liveConfirmed, transport: lt4, liveAttempt: true });
  check("4) live blocked missing permission → missing_permission, no call", l4.status === "blocked" && l4.reason === "missing_permission" && lt4.calls.length === 0, `${l4.status}/${l4.reason}`);

  // 5) live blocked for normal_criticism.
  const lt5 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const l5 = await attemptFacebookHide(liveCtx({ itemId: "L_NC", queueItemId: "L_NCQ", matchedCategory: "normal_criticism" }), { config: CFG.liveConfirmed, transport: lt5, liveAttempt: true });
  check("5) live blocked for normal_criticism → safety_never_autonomous, no call", l5.status === "blocked" && l5.reason === "safety_never_autonomous" && lt5.calls.length === 0, `${l5.status}/${l5.reason}`);

  // 6) live blocked for legal/refund/safety/customer_question.
  for (const cat of ["legal_complaint", "refund_complaint", "safety_claim", "customer_question"]) {
    const t = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
    const l = await attemptFacebookHide(liveCtx({ itemId: `L_${cat}`, queueItemId: `L_${cat}Q`, matchedCategory: cat }), { config: CFG.liveConfirmed, transport: t, liveAttempt: true });
    check(`6) live blocked for ${cat} → safety_never_autonomous, no call`, l.status === "blocked" && l.reason === "safety_never_autonomous" && t.calls.length === 0, `${l.status}/${l.reason}`);
  }

  // 8/9/10/14/15) live success: transport once, one executed row, executedAt set, audit written.
  const lt8 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const l8 = await attemptFacebookHide(liveCtx(), { config: CFG.liveConfirmed, transport: lt8, liveAttempt: true });
  check("8) live success calls transport exactly once (hide op)", l8.status === "executed" && lt8.calls.length === 1 && lt8.calls[0]!.op === "hide", `${l8.status}/calls=${lt8.calls.length}`);
  const execRows = await prisma.platformActionExecution.findMany({ where: { tenantId: T, queueItemId: "L_Q", status: "executed" } });
  check("9) live success creates exactly one executed row", execRows.length === 1, `rows=${execRows.length}`);
  check("10) live success sets executedAt", execRows[0]?.executedAt != null);
  const liveExecCount = await prisma.platformActionExecution.count({ where: { tenantId: T, queueItemId: "L_Q", status: "executed" } });
  check("14) command center live count = 1 for this action", liveExecCount === 1, String(liveExecCount));
  const execAudit = await prisma.auditLog.count({ where: { tenantId: T, event: "platform_action.executed", targetType: "platform_action_execution" } });
  check("15) timeline/audit executed event written", execAudit >= 1);

  // 7/16) double-click after executed → already_executed, no call, still one executed row.
  const lt7 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const l7 = await attemptFacebookHide(liveCtx(), { config: CFG.liveConfirmed, transport: lt7, liveAttempt: true });
  const execRows2 = await prisma.platformActionExecution.count({ where: { tenantId: T, queueItemId: "L_Q", status: "executed" } });
  check("7/16) double-click after executed → already_executed, no 2nd row/call", l7.status === "executed" && l7.reason === "already_executed" && l7.idempotent === true && lt7.calls.length === 0 && execRows2 === 1, `${l7.reason}/rows=${execRows2}/calls=${lt7.calls.length}`);

  // 11/12) provider error → failed; retry only via explicit retry.
  const fCtx = liveCtx({ itemId: "L_F", queueItemId: "L_FQ" });
  // preflight dry-run for the failed-live key.
  await attemptFacebookHide(fCtx, { config: CFG.dryRun, transport: new MockFacebookHideTransport() });
  const lf = await attemptFacebookHide(fCtx, { config: CFG.liveConfirmed, transport: new MockFacebookHideTransport({ ok: false, errorCode: "generic", errorMessage: "nope" }), liveAttempt: true });
  check("11) provider error → failed row (not faked)", lf.status === "failed", lf.status);
  const tNoRetry = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const lfNoRetry = await attemptFacebookHide(fCtx, { config: CFG.liveConfirmed, transport: tNoRetry, liveAttempt: true });
  check("12) repeated live click after failed does NOT retry", lfNoRetry.status === "failed" && lfNoRetry.idempotent === true && tNoRetry.calls.length === 0);
  const tRetry = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const lfRetry = await attemptFacebookHide(fCtx, { config: CFG.liveConfirmed, transport: tRetry, liveAttempt: true, retry: true });
  check("12b) explicit retry re-attempts live → executed once", lfRetry.status === "executed" && tRetry.calls.length === 1, `${lfRetry.status}/calls=${tRetry.calls.length}`);

  // 13) token never logged/stored in any live row.
  const liveRows = await prisma.platformActionExecution.findMany({ where: { tenantId: T, queueItemId: { in: ["L_Q", "L_FQ"] } } });
  const liveStr = JSON.stringify(liveRows);
  check("13) token never stored in live rows", !liveStr.includes("SECRET_TOKEN") && !liveStr.includes("pageAccessToken"));

  // 17) default env → live actions = 0 (blocked, no execution).
  const lt17 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const l17 = await attemptFacebookHide(liveCtx({ itemId: "L_D", queueItemId: "L_DQ" }), { config: CFG.default, transport: lt17, liveAttempt: true });
  const defaultExec = await prisma.platformActionExecution.count({ where: { tenantId: T, queueItemId: "L_DQ", status: "executed" } });
  check("17) default env → blocked, live actions = 0", l17.status === "blocked" && lt17.calls.length === 0 && defaultExec === 0, `${l17.status}/exec=${defaultExec}`);

  // 18) no Instagram / reply / delete execution — unsupported platform blocks; only hide op ever called.
  const lt18 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const l18 = await attemptFacebookHide(liveCtx({ itemId: "L_IG", queueItemId: "L_IGQ", platform: "instagram_business" }), { config: CFG.liveConfirmed, transport: lt18, liveAttempt: true });
  check("18) Instagram live → blocked/unsupported_platform, no call", l18.status === "blocked" && l18.reason === "unsupported_platform" && lt18.calls.length === 0, `${l18.status}/${l18.reason}`);
  const allLiveOps = [lt8, lt7, tRetry].flatMap((tr) => tr.calls.map((c) => c.op));
  check("18b) only hide ops ever issued (no reply/delete)", allLiveOps.every((op) => op === "hide"), allLiveOps.join(","));

  await cleanup();
  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — controlled Facebook hide gates`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
