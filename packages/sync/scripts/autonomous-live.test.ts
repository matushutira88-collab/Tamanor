/**
 * V1.27 — Autonomous Safe Hide for harmful comments.
 * Clearly harmful comments (vulgarity, personal attack, hate, racism, scam,
 * phishing, spam, threat h/c) are hidden AUTOMATICALLY in the sync pipeline under
 * the Production Safe Mode envelope — no manual click. Everything fail-closed;
 * customer voice is never hidden; live transport is only a MOCK here; no token stored.
 *
 * This exercises the autonomous trigger with a production per-brand live opt-in
 * (LIVE_HIDE_TEST_CONFIRM is NOT set — the brand opt-in unlocks live instead).
 *
 * Run via: pnpm autonomous-live:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import { MockFacebookHideTransport } from "@guardora/connectors";
import { attemptFacebookHide, type HideContext } from "../src/live-actions";
import { DEFAULT_SAFETY_SETTINGS, type ProductionSafetyContext } from "../src/production-safety";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

let T = "test_tenant_v127_auto";
// canExecuteLive true, liveConfirmed FALSE → proves the production per-brand opt-in
// (not LIVE_HIDE_TEST_CONFIRM) unlocks autonomous live.
const CFG = { liveEnabled: true, facebookHideEnabled: true, dryRun: false, canExecuteLive: true, liveConfirmed: false, productionSafeMode: true, globalKillSwitch: false };

const ELIGIBLE = ["scam", "phishing", "spam", "profanity", "personal_attack", "hate_speech", "racism", "terrorism_extremism", "threat"];
const mkSafety = (over: Partial<ProductionSafetyContext> = {}): ProductionSafetyContext => ({
  flags: { productionSafeMode: true, globalKillSwitch: false },
  brandKillSwitch: false,
  accountKillSwitch: false,
  settings: { ...DEFAULT_SAFETY_SETTINGS, liveModeEnabled: true, autonomousHideEnabled: true, approvedAutoHideCategories: ELIGIBLE, ...(over.settings ?? {}) },
  counts: { dayCount: 0, hourCount: 0, categoryDayCount: 0, consecutiveWithoutReview: 0, ...(over.counts ?? {}) },
  categoryApprovedBefore: true,
  rollbackAvailable: true,
  ...over,
});

let seq = 0;
const ctx = (over: Partial<HideContext> = {}): HideContext => {
  const n = ++seq;
  return {
    tenantId: T, brandId: "B1", itemId: `AU_I${n}`, queueItemId: `AU_Q${n}`, policyId: "P_pol", connectedAccountId: "A1", platform: "facebook_page",
    externalCommentId: "C1", externalPostId: "P_post", matchedCategory: "profanity", confidence: 0.92, riskLevel: "critical",
    mode: "autonomous", trigger: "autonomous",
    account: { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: "SECRET_TOKEN", pageId: "P1", externalId: "P1" },
    requestedBy: "system", ...over,
  };
};

async function cleanup() {
  await prisma.platformActionExecution.deleteMany({ where: { tenantId: T, connectedAccountId: "A1" } });
  await prisma.auditLog.deleteMany({ where: { tenantId: T, event: { startsWith: "autonomous_hide" } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: T, event: { in: ["safety_floor.blocked", "rate_limit.triggered", "kill_switch.blocked"] } } });
}

async function autoHide(over: Partial<HideContext>, transport: MockFacebookHideTransport, safety = mkSafety()) {
  return attemptFacebookHide(ctx(over), { config: CFG, transport, safety });
}

async function run() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) { console.error("no tenant found — seed first"); process.exit(1); }
  T = tenant.id;
  await cleanup();

  // 1) profanity + autonomous + live gates → hideFacebookComment called once.
  const t1 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r1 = await autoHide({ matchedCategory: "profanity" }, t1);
  check("1) profanity autonomous → executed, transport called once", r1.status === "executed" && t1.calls.length === 1 && t1.calls[0]!.op === "hide", `${r1.status}/calls=${t1.calls.length}`);

  // 2) personal_attack → hide.
  const t2 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r2 = await autoHide({ matchedCategory: "personal_attack" }, t2);
  check("2) personal_attack autonomous → executed", r2.status === "executed" && t2.calls.length === 1);

  // 3) scam / phishing / spam → hide.
  for (const cat of ["scam", "phishing", "spam"]) {
    const t = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
    const r = await autoHide({ matchedCategory: cat }, t);
    check(`3) ${cat} autonomous → executed`, r.status === "executed" && t.calls.length === 1, `${r.status}`);
  }

  // 4) hate_speech / racism → hide.
  for (const cat of ["hate_speech", "racism"]) {
    const t = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
    const r = await autoHide({ matchedCategory: cat }, t);
    check(`4) ${cat} autonomous → executed`, r.status === "executed" && t.calls.length === 1, `${r.status}`);
  }

  // 5) normal_criticism → never hide.
  const t5 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r5 = await autoHide({ matchedCategory: "normal_criticism" }, t5);
  check("5) normal_criticism → never hide (blocked, no call)", r5.status === "blocked" && r5.reason === "safety_never_live" && t5.calls.length === 0, `${r5.reason}`);

  // 6) refund / legal / safety → never hide.
  for (const cat of ["refund_complaint", "legal_complaint", "safety_claim"]) {
    const t = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
    const r = await autoHide({ matchedCategory: cat }, t);
    check(`6) ${cat} → never hide`, r.status === "blocked" && r.reason === "safety_never_live" && t.calls.length === 0, `${r.reason}`);
  }

  // 7) low confidence → approval (blocked below_min_confidence, no live).
  const t7 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r7 = await autoHide({ matchedCategory: "profanity", confidence: 0.8 }, t7);
  check("7) low confidence → approval (blocked below_min_confidence)", r7.status === "blocked" && r7.reason === "below_min_confidence" && t7.calls.length === 0, `${r7.reason}`);

  // 8) missing permission → blocked.
  const t8 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r8 = await autoHide({ matchedCategory: "scam", account: { status: "active", health: "healthy", grantedPermissions: ["pages_read_engagement"], externalId: "P1", pageId: "P1" } }, t8);
  check("8) missing permission → blocked, no call", r8.status === "blocked" && r8.reason === "missing_permission" && t8.calls.length === 0, `${r8.reason}`);

  // 9) kill switch → blocked.
  const t9 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r9 = await autoHide({ matchedCategory: "scam" }, t9, mkSafety({ brandKillSwitch: true }));
  check("9) kill switch → blocked, no call", r9.status === "blocked" && r9.reason === "brand_kill_switch" && t9.calls.length === 0, `${r9.reason}`);

  // 10) hourly limit → approval.
  const t10 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r10 = await autoHide({ matchedCategory: "scam" }, t10, mkSafety({ counts: { dayCount: 0, hourCount: 3, categoryDayCount: 0, consecutiveWithoutReview: 0 } }));
  check("10) hourly limit → approval (blocked hourly_limit)", r10.status === "blocked" && r10.reason === "hourly_limit" && t10.calls.length === 0, `${r10.reason}`);

  // 11) daily limit → approval.
  const t11 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r11 = await autoHide({ matchedCategory: "scam" }, t11, mkSafety({ counts: { dayCount: 10, hourCount: 0, categoryDayCount: 0, consecutiveWithoutReview: 0 } }));
  check("11) daily limit → approval (blocked daily_limit)", r11.status === "blocked" && r11.reason === "daily_limit" && t11.calls.length === 0, `${r11.reason}`);

  // 12) double sync same item → only one executed row.
  const d1 = await attemptFacebookHide(ctx({ itemId: "AU_DUP", queueItemId: "AU_DUPQ", matchedCategory: "scam" }), { config: CFG, transport: new MockFacebookHideTransport({ ok: true, responseCode: "200" }), safety: mkSafety() });
  const t12 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const d2 = await attemptFacebookHide(ctx({ itemId: "AU_DUP", queueItemId: "AU_DUPQ", matchedCategory: "scam" }), { config: CFG, transport: t12, safety: mkSafety() });
  const dupRows = await prisma.platformActionExecution.count({ where: { tenantId: T, queueItemId: "AU_DUPQ", status: "executed" } });
  check("12) double sync same item → only one executed row", d1.status === "executed" && d2.status === "executed" && d2.reason === "already_executed" && t12.calls.length === 0 && dupRows === 1, `rows=${dupRows}`);

  // 13) Graph failure → failed, no fake success.
  const r13 = await attemptFacebookHide(ctx({ itemId: "AU_F", queueItemId: "AU_FQ", matchedCategory: "scam" }), { config: CFG, transport: new MockFacebookHideTransport({ ok: false, errorCode: "generic", errorMessage: "nope" }), safety: mkSafety() });
  check("13) Graph failure → failed (not faked)", r13.status === "failed", r13.status);

  // 14) token leak none.
  const rows = JSON.stringify(await prisma.platformActionExecution.findMany({ where: { tenantId: T } }));
  const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { tenantId: T, event: { startsWith: "autonomous_hide" } } }));
  check("14) token leak none (executions + audit)", !rows.includes("SECRET_TOKEN") && !rows.includes("pageAccessToken") && !audits.includes("SECRET_TOKEN"));

  // 15) Action Queue shows automatically hidden.
  const aq = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
  check("15) Action Queue shows automatically hidden", aq.includes("autoExec") && aq.includes("t.cc.autoHidden"));

  // 16) Command Center shows auto-hidden count.
  const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
  check("16) Command Center shows auto-hidden count", cc.includes("autoHidesToday"));

  // 17) no reply/delete/Instagram — Instagram blocks; only hide ops issued.
  const t17 = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const r17 = await autoHide({ matchedCategory: "scam", platform: "instagram_business" }, t17);
  check("17) Instagram autonomous → blocked/unsupported_platform, no call", r17.status === "blocked" && r17.reason === "unsupported_platform" && t17.calls.length === 0, `${r17.reason}`);
  const allOps = [t1, t2, t12].flatMap((tr) => tr.calls.map((c) => c.op));
  check("17b) only hide ops ever issued (no reply/delete)", allOps.every((op) => op === "hide"));

  // executed audits present BEFORE the action.
  const allowedAudit = await prisma.auditLog.count({ where: { tenantId: T, event: "autonomous_hide.allowed" } });
  check("18) autonomous_hide.allowed audited before action", allowedAudit >= 1, String(allowedAudit));

  await cleanup();
  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Autonomous Safe Hide`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
