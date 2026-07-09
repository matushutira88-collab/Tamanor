/**
 * V1.27 Production Safe Mode — the safety envelope for REAL live actions.
 * Kill switches, per-brand limits, first-time category, crisis lock, hard floor,
 * rollback and audit. Everything fail-closed; customer voice is never live hidden;
 * no token is ever stored. Live transport is only a MOCK here.
 *
 * Run via: pnpm production-safe:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import { MockFacebookHideTransport } from "@guardora/connectors";
import { attemptFacebookHide, rollbackHide, type HideContext } from "../src/live-actions";
import { evaluateProductionSafety, DEFAULT_SAFETY_SETTINGS, type ProductionSafetyContext } from "../src/production-safety";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

let T = "test_tenant_v127";
const CFG = { liveEnabled: true, facebookHideEnabled: true, dryRun: false, canExecuteLive: true, liveConfirmed: true, productionSafeMode: true, globalKillSwitch: false };

// A permissive safety context (everything allows) — tests override one field at a time.
const mkSafety = (over: Partial<ProductionSafetyContext> = {}): ProductionSafetyContext => ({
  flags: { productionSafeMode: true, globalKillSwitch: false },
  brandKillSwitch: false,
  accountKillSwitch: false,
  settings: {
    ...DEFAULT_SAFETY_SETTINGS,
    liveModeEnabled: true, autonomousHideEnabled: true,
    approvedAutoHideCategories: ["scam", "phishing", "spam", "hate_speech", "racism", "personal_attack", "profanity", "threat", "terrorism_extremism"],
    ...(over.settings ?? {}),
  },
  counts: { dayCount: 0, hourCount: 0, categoryDayCount: 0, consecutiveWithoutReview: 0, ...(over.counts ?? {}) },
  categoryApprovedBefore: true,
  rollbackAvailable: true,
  ...over,
});

let seq = 0;
const ctx = (over: Partial<HideContext> = {}): HideContext => {
  const n = ++seq;
  return {
    tenantId: T, brandId: "B1", itemId: `PS_I${n}`, queueItemId: `PS_Q${n}`, policyId: "P_pol", connectedAccountId: "A1", platform: "facebook_page",
    externalCommentId: "C1", externalPostId: "P_post", matchedCategory: "scam", confidence: 0.9, riskLevel: "critical",
    mode: "autonomous", trigger: "autonomous",
    account: { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: "SECRET_TOKEN", pageId: "P1", externalId: "P1" },
    requestedBy: "system", ...over,
  };
};

const SAFETY_EVENTS = [
  "autonomous_hide.allowed", "autonomous_hide.blocked", "safety_floor.blocked",
  "rate_limit.triggered", "kill_switch.blocked", "live_hide.rollback_requested",
  "live_hide.rolled_back", "live_hide.failed",
];
async function cleanup() {
  await prisma.platformActionExecution.deleteMany({ where: { tenantId: T, connectedAccountId: "A1" } });
  // Scoped: only remove audit rows this test writes — never unrelated tenant history.
  await prisma.auditLog.deleteMany({ where: { tenantId: T, event: { in: SAFETY_EVENTS } } });
}

async function run() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) { console.error("no tenant found — seed first"); process.exit(1); }
  T = tenant.id;
  await cleanup();

  // 1) global kill switch blocks live hide.
  const t1 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r1 = await attemptFacebookHide(ctx(), { config: CFG, transport: t1, safety: mkSafety({ flags: { productionSafeMode: true, globalKillSwitch: true } }) });
  check("1) global kill switch blocks live hide", r1.status === "blocked" && r1.reason === "global_kill_switch" && t1.calls.length === 0, `${r1.status}/${r1.reason}`);

  // 2) brand kill switch blocks live hide.
  const t2 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r2 = await attemptFacebookHide(ctx(), { config: CFG, transport: t2, safety: mkSafety({ brandKillSwitch: true }) });
  check("2) brand kill switch blocks live hide", r2.status === "blocked" && r2.reason === "brand_kill_switch" && t2.calls.length === 0);

  // 3) account kill switch blocks live hide.
  const t3 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r3 = await attemptFacebookHide(ctx(), { config: CFG, transport: t3, safety: mkSafety({ accountKillSwitch: true }) });
  check("3) account kill switch blocks live hide", r3.status === "blocked" && r3.reason === "account_kill_switch" && t3.calls.length === 0);

  // 4) daily limit blocks after threshold.
  const t4 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r4 = await attemptFacebookHide(ctx(), { config: CFG, transport: t4, safety: mkSafety({ counts: { dayCount: 10, hourCount: 0, categoryDayCount: 0, consecutiveWithoutReview: 0 } }) });
  check("4) daily limit blocks after threshold", r4.status === "blocked" && r4.reason === "daily_limit" && t4.calls.length === 0, `${r4.reason}`);

  // 5) hourly limit blocks after threshold.
  const t5 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r5 = await attemptFacebookHide(ctx(), { config: CFG, transport: t5, safety: mkSafety({ counts: { dayCount: 0, hourCount: 3, categoryDayCount: 0, consecutiveWithoutReview: 0 } }) });
  check("5) hourly limit blocks after threshold", r5.status === "blocked" && r5.reason === "hourly_limit" && t5.calls.length === 0, `${r5.reason}`);

  // 6) normal_criticism never live hides.
  const t6 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r6 = await attemptFacebookHide(ctx({ matchedCategory: "normal_criticism" }), { config: CFG, transport: t6, safety: mkSafety() });
  check("6) normal_criticism never live hides", r6.status === "blocked" && r6.reason === "safety_never_live" && t6.calls.length === 0, `${r6.reason}`);

  // 7) refund/legal/safety/customer_question never live hide.
  for (const cat of ["refund_complaint", "legal_complaint", "safety_claim", "customer_question"]) {
    const t = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
    const r = await attemptFacebookHide(ctx({ matchedCategory: cat }), { config: CFG, transport: t, safety: mkSafety() });
    check(`7) ${cat} never live hides`, r.status === "blocked" && r.reason === "safety_never_live" && t.calls.length === 0, `${r.reason}`);
  }

  // 8) low confidence downgrades to approval (below brand min).
  const t8 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r8 = await attemptFacebookHide(ctx({ confidence: 0.8 }), { config: CFG, transport: t8, safety: mkSafety() });
  check("8) low confidence downgrades to approval", r8.status === "blocked" && r8.reason === "below_min_confidence" && t8.calls.length === 0, `${r8.reason}`);

  // 9) first-time category requires human approval.
  const t9 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r9 = await attemptFacebookHide(ctx(), { config: CFG, transport: t9, safety: mkSafety({ categoryApprovedBefore: false }) });
  check("9) first-time category requires human approval", r9.status === "blocked" && r9.reason === "new_category_requires_approval" && t9.calls.length === 0, `${r9.reason}`);

  // 10) autonomous safe live works only for eligible categories.
  const t10a = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r10a = await attemptFacebookHide(ctx({ matchedCategory: "competitor_promo" }), { config: CFG, transport: t10a, safety: mkSafety({ categoryApprovedBefore: true, settings: { ...DEFAULT_SAFETY_SETTINGS, liveModeEnabled: true, autonomousHideEnabled: true, approvedAutoHideCategories: ["competitor_promo"] } }) });
  check("10a) ineligible category (competitor_promo) is not autonomously live hidden", r10a.status === "blocked" && r10a.reason === "category_not_eligible" && t10a.calls.length === 0, `${r10a.reason}`);
  const t10b = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r10b = await attemptFacebookHide(ctx({ matchedCategory: "scam" }), { config: CFG, transport: t10b, safety: mkSafety() });
  check("10b) eligible category + all gates → executed once", r10b.status === "executed" && t10b.calls.length === 1 && t10b.calls[0]!.op === "hide", `${r10b.status}/calls=${t10b.calls.length}`);

  // 11) audit written BEFORE action (autonomous_hide.allowed exists for the executed item).
  const allowedAudit = await prisma.auditLog.count({ where: { tenantId: T, event: "autonomous_hide.allowed" } });
  check("11) audit written before action (autonomous_hide.allowed)", allowedAudit >= 1, String(allowedAudit));
  const blockedAudit = await prisma.auditLog.count({ where: { tenantId: T, event: { in: ["safety_floor.blocked", "rate_limit.triggered", "kill_switch.blocked", "autonomous_hide.blocked"] } } });
  check("11b) safety blocks are audited", blockedAudit >= 5, String(blockedAudit));

  // 12) execution idempotent — same key does not execute twice.
  const t12 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r12 = await attemptFacebookHide(ctx({ itemId: "PS_IDEM", queueItemId: "PS_IDEMQ" }), { config: CFG, transport: new MockFacebookHideTransport({ ok: true, responseCode: "200" }), safety: mkSafety() });
  const r12b = await attemptFacebookHide(ctx({ itemId: "PS_IDEM", queueItemId: "PS_IDEMQ" }), { config: CFG, transport: t12, safety: mkSafety() });
  const idemRows = await prisma.platformActionExecution.count({ where: { tenantId: T, queueItemId: "PS_IDEMQ", status: "executed" } });
  check("12) execution idempotent (no double execute)", r12.status === "executed" && r12b.status === "executed" && r12b.reason === "already_executed" && t12.calls.length === 0 && idemRows === 1);

  // 13) Graph failure becomes failed, no fake success.
  const r13 = await attemptFacebookHide(ctx({ itemId: "PS_F", queueItemId: "PS_FQ" }), { config: CFG, transport: new MockFacebookHideTransport({ ok: false, errorCode: "generic", errorMessage: "nope" }), safety: mkSafety() });
  check("13) Graph failure → failed (not faked)", r13.status === "failed", r13.status);

  // 14) retry requires explicit retry.
  const t14 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r14 = await attemptFacebookHide(ctx({ itemId: "PS_F", queueItemId: "PS_FQ" }), { config: CFG, transport: t14, safety: mkSafety() });
  check("14) repeated attempt after failed does NOT retry", r14.status === "failed" && r14.idempotent === true && t14.calls.length === 0);
  const t14b = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r14b = await attemptFacebookHide(ctx({ itemId: "PS_F", queueItemId: "PS_FQ" }), { config: CFG, transport: t14b, retry: true, safety: mkSafety() });
  check("14b) explicit retry re-attempts", r14b.status === "executed" && t14b.calls.length === 1);

  // 15) rollback / unhide audit path.
  const execRow = await prisma.platformActionExecution.findFirst({ where: { tenantId: T, status: "executed" }, orderBy: { createdAt: "desc" } });
  const rbDry = await rollbackHide({ tenantId: T, executionId: execRow!.id, account: { pageId: "P1", externalId: "P1", accessToken: "SECRET_TOKEN" }, live: false }, { transport: new MockFacebookHideTransport() });
  check("15a) rollback dry-run → dry_run + rollback_requested audit", rbDry.status === "dry_run" && (await prisma.auditLog.count({ where: { tenantId: T, event: "live_hide.rollback_requested" } })) >= 1);
  const rbLiveT = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const rbLive = await rollbackHide({ tenantId: T, executionId: execRow!.id, account: { pageId: "P1", externalId: "P1", accessToken: "SECRET_TOKEN" }, live: true }, { transport: rbLiveT });
  const rolledRow = await prisma.platformActionExecution.findFirst({ where: { id: execRow!.id } });
  check("15b) rollback live → rolled_back + audit + status updated + unhide op", rbLive.status === "rolled_back" && rbLiveT.calls.some((c) => c.op === "unhide") && rolledRow?.status === "rolled_back" && rolledRow?.rolledBackAt != null && (await prisma.auditLog.count({ where: { tenantId: T, event: "live_hide.rolled_back" } })) >= 1);

  // 16) no token leak in any row/audit.
  const rows = JSON.stringify(await prisma.platformActionExecution.findMany({ where: { tenantId: T } }));
  const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { tenantId: T } }));
  check("16) no token leak (executions + audit)", !rows.includes("SECRET_TOKEN") && !rows.includes("pageAccessToken") && !audits.includes("SECRET_TOKEN"));

  // 17) no reply/delete/Instagram — Instagram blocks; only hide/unhide ops ever issued.
  const t17 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r17 = await attemptFacebookHide(ctx({ itemId: "PS_IG", queueItemId: "PS_IGQ", platform: "instagram_business" }), { config: CFG, transport: t17, safety: mkSafety() });
  check("17) Instagram live → blocked, no call", r17.status === "blocked" && t17.calls.length === 0, r17.reason);

  // 18/19) UI surfaces (source inspection).
  const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
  check("18) Command Center shows live safety state", cc.includes("liveSafety") || cc.includes("safeLiveOps") || cc.includes("killSwitch"));
  const ctl = readSrc("apps/web/src/app/dashboard/control-center/page.tsx");
  check("19) Control Center shows Autonomous Safe Live", ctl.includes("autonomousSafeLive") || ctl.includes("Autonomous Safe Live"));

  // 20) default env / default settings still safe — autonomous with default (live off) → blocked, live=0.
  const t20 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r20 = await attemptFacebookHide(ctx({ itemId: "PS_D", queueItemId: "PS_DQ" }), { config: CFG, transport: t20, safety: mkSafety({ settings: { ...DEFAULT_SAFETY_SETTINGS } }) });
  const liveExec20 = await prisma.platformActionExecution.count({ where: { tenantId: T, queueItemId: "PS_DQ", status: "executed" } });
  check("20) default settings still safe (live off → blocked, live=0)", r20.status === "blocked" && r20.reason === "live_mode_disabled" && t20.calls.length === 0 && liveExec20 === 0, `${r20.reason}`);

  // Pure-function sanity: evaluateProductionSafety kill-switch precedence.
  const pure = evaluateProductionSafety({ trigger: "autonomous", category: "scam", confidence: 0.99, riskLevel: "critical", safety: mkSafety({ brandKillSwitch: true }) });
  check("pure) kill switch precedes all other gates", pure.outcome === "blocked" && pure.reason === "brand_kill_switch");

  await cleanup();
  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Production Safe Mode`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
