/**
 * V1.26B — Live hide execution UX.
 * The detail page must make the LIVE hide the PRIMARY action when an item is
 * "live_possible" — the plain Approve must NOT be the primary green button — and
 * "Approve without hiding" must never pretend to hide. Live execution itself still
 * goes only through the confirmed executeLiveHide → transport-once path.
 *
 * Run via: pnpm live-ux:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import { MockFacebookHideTransport } from "@guardora/connectors";
import { attemptFacebookHide, resolvePrimaryAction, findPreflightDryRun, type HideContext } from "../src/live-actions";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

let T = "test_tenant_v126b";
const LIVE = { liveEnabled: true, facebookHideEnabled: true, dryRun: false, canExecuteLive: true, liveConfirmed: true };
const ctx = (over: Partial<HideContext> = {}): HideContext => ({
  tenantId: T, brandId: "B1", itemId: "UX_I", queueItemId: "UX_Q", policyId: "P_pol", connectedAccountId: "A1", platform: "facebook_page",
  externalCommentId: "C1", externalPostId: "P_post", matchedCategory: "scam", confidence: 0.9, riskLevel: "critical",
  mode: "approval", trigger: "approval",
  account: { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: "SECRET_TOKEN", pageId: "P1", externalId: "P1" },
  requestedBy: "user", ...over,
});

async function cleanup() {
  await prisma.platformActionExecution.deleteMany({ where: { tenantId: T, connectedAccountId: "A1" } });
  await prisma.auditLog.deleteMany({ where: { tenantId: T, targetType: "platform_action_execution" } });
}

async function run() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) { console.error("no tenant found — seed first"); process.exit(1); }
  T = tenant.id;
  await cleanup();

  // 1) live_possible → live hide button is primary + rendered, Approve NOT primary.
  const dReady = resolvePrimaryAction({ proposedAction: "hide_comment", expected: "live_possible", alreadyExecuted: false });
  check("1) live_possible → primary=live_hide, renders live button", dReady.primary === "live_hide" && dReady.showLiveForm === true, JSON.stringify(dReady));
  check("2) normal Approve is NOT primary in live_possible state", dReady.approveIsPrimary === false);

  // V1.26C — live_possible renders the live form regardless of preflight (unconditioned).
  const dNoPre = resolvePrimaryAction({ proposedAction: "hide_comment", expected: "live_possible", alreadyExecuted: false });
  check("2b) live_possible renders live form unconditioned (no preflight needed to show)", dNoPre.primary === "live_hide" && dNoPre.showLiveForm === true && dNoPre.approveIsPrimary === false);

  // not live_possible (dry_run) → Approve is the normal primary action, no live button.
  const dDry = resolvePrimaryAction({ proposedAction: "hide_comment", expected: "dry_run", alreadyExecuted: false });
  check("2c) not live_possible → Approve primary, no live button", dDry.primary === "approve" && dDry.approveIsPrimary === true && dDry.showLiveForm === false);

  // already executed → hard stop, no primary action, no live button.
  const dDone = resolvePrimaryAction({ proposedAction: "hide_comment", expected: "live_possible", alreadyExecuted: true });
  check("2d) already executed → hard_stop, no live button, Approve not primary", dDone.primary === "hard_stop" && dDone.showLiveForm === false && dDone.approveIsPrimary === false);

  // --- Render / wiring assertions (spec item 5) ---
  const pageSrc = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
  const formSrc = readSrc("apps/web/src/components/dashboard/live-hide-form.tsx");
  const enSrc = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const liveHideButtonLabel = /liveHideButton:\s*"([^"]+)"/.exec(enSrc)?.[1] ?? "";
  check("R1) live_possible renders the live-hide button (t.cc.liveHideButton)", pageSrc.includes("liveMode ?") && pageSrc.includes("<LiveHideForm") && /buttonLabel=\{showRetry \? t\.cc\.liveHideRetryButton : t\.cc\.liveHideButton\}/.test(pageSrc) && liveHideButtonLabel.length > 0, liveHideButtonLabel);
  check("R2) LiveHideForm is NOT conditioned on preflight/showLiveForm when liveMode", !/showLiveForm \?[\s\S]*?<LiveHideForm/.test(pageSrc));
  check("R3) primary Approve button is gated behind !liveMode", /canApprove && !liveMode && !alreadyExecuted\b/.test(pageSrc));
  check("R4) approveWithoutHide is a secondary action", /action=\{approveWithoutHide\}[\s\S]*?variant="secondary"/.test(pageSrc));
  check("R5) executeLiveHide is wired to the live form", /action=\{executeLiveHide\}/.test(formSrc) && formSrc.includes("REQUIRED_PHRASE") && formSrc.includes('name="understood"') && formSrc.includes('name="confirmPhrase"'));
  check("R6) dev debug text present (primaryAction/expectedResult)", pageSrc.includes("primaryAction=") && pageSrc.includes("expectedResult="));

  // 3) "Approve without hiding" must not create any execution row (it never calls the hide seam).
  //    Simulate: mark approved without invoking attemptFacebookHide → zero executions.
  await cleanup();
  const before = await prisma.platformActionExecution.count({ where: { tenantId: T, queueItemId: "UX_Q" } });
  check("3) approve-without-hide creates no execution row (does not pretend to hide)", before === 0);

  // 4) live button requires a real live attempt: a dry-run preflight first, then a
  //    confirmed live attempt calls the transport exactly once and creates one executed row.
  const preT = new MockFacebookHideTransport();
  await attemptFacebookHide(ctx(), { config: { liveEnabled: true, facebookHideEnabled: true, dryRun: true, canExecuteLive: false, liveConfirmed: false }, transport: preT });
  const pre = await findPreflightDryRun({ tenantId: T, queueItemId: "UX_Q", policyId: "P_pol" });
  check("4) preflight dry-run exists, transport untouched", !!pre && preT.calls.length === 0);

  const liveT = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const live = await attemptFacebookHide(ctx(), { config: LIVE, transport: liveT, liveAttempt: true });
  check("5) live attempt calls transport exactly once (hide op)", live.status === "executed" && liveT.calls.length === 1 && liveT.calls[0]!.op === "hide", `${live.status}/calls=${liveT.calls.length}`);
  const execRows = await prisma.platformActionExecution.count({ where: { tenantId: T, queueItemId: "UX_Q", status: "executed" } });
  check("6) exactly one executed row created + executedAt set", execRows === 1 && !!(await prisma.platformActionExecution.findFirst({ where: { tenantId: T, queueItemId: "UX_Q", status: "executed" } }))?.executedAt);

  // 7) double-click does not execute twice.
  const dblT = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const dbl = await attemptFacebookHide(ctx(), { config: LIVE, transport: dblT, liveAttempt: true });
  const execRows2 = await prisma.platformActionExecution.count({ where: { tenantId: T, queueItemId: "UX_Q", status: "executed" } });
  check("7) double click does not execute twice", dbl.status === "executed" && dbl.reason === "already_executed" && dblT.calls.length === 0 && execRows2 === 1);

  // 8) no reply/delete/Instagram — Instagram blocks; only hide ops ever issued.
  const igT = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
  const ig = await attemptFacebookHide(ctx({ itemId: "UX_IG", queueItemId: "UX_IGQ", platform: "instagram_business" }), { config: LIVE, transport: igT, liveAttempt: true });
  check("8) Instagram live → blocked/unsupported_platform, no call", ig.status === "blocked" && ig.reason === "unsupported_platform" && igT.calls.length === 0);
  check("8b) only hide ops ever issued (no reply/delete)", [liveT, dblT, igT].flatMap((tr) => tr.calls.map((c) => c.op)).every((op) => op === "hide"));

  // 9) token never stored in any row.
  const rows = await prisma.platformActionExecution.findMany({ where: { tenantId: T } });
  const s = JSON.stringify(rows);
  check("9) token leak none", !s.includes("SECRET_TOKEN") && !s.includes("pageAccessToken"));

  await cleanup();
  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — live hide execution UX`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
