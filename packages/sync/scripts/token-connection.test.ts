/**
 * V1.27C — Persistent Facebook Connection Manager.
 * The Page connection stays durable; a watchdog validates the Page token (GET
 * /{pageId}, not /me/accounts) and flags needs_reconnect BEFORE any hide. A hide
 * never runs on an unverified/bad token, and Facebook's per-comment can_hide=false
 * is handled distinctly from token errors. Mocks only; no token is ever logged.
 *
 * Run via: pnpm token-connection:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma, metaConnectedAccountFields } from "@guardora/db";
import { MockFacebookHideTransport } from "@guardora/connectors";
import { attemptFacebookHide, type HideContext } from "../src/live-actions";
import { checkAccountToken } from "../src/connection-manager";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const CFG = { liveEnabled: true, facebookHideEnabled: true, dryRun: false, canExecuteLive: true, liveConfirmed: true, productionSafeMode: false, globalKillSwitch: false };
const PAGE_TOKEN = "PAGE_TOKEN_CONN";
let T = "test_tenant_v127c";

let seq = 0;
const ctx = (accountId: string, over: Record<string, unknown> = {}): HideContext => {
  const n = ++seq;
  const { account: overAccount, ...restOver } = over;
  const account = { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: PAGE_TOKEN, pageId: "TOK_PAGE", externalId: "TOK_PAGE", connectionStatus: "connected", tokenHealth: "ok", ...((overAccount as object) ?? {}) };
  return {
    tenantId: T, brandId: "CONNB", itemId: `CN_I${n}`, queueItemId: `CN_Q${n}`, policyId: "P_pol", connectedAccountId: accountId, platform: "facebook_page",
    externalCommentId: "C1", externalPostId: "P_post", matchedCategory: "scam", confidence: 0.95, riskLevel: "critical",
    mode: "approval", trigger: "approval", account, requestedBy: "user", ...restOver,
  } as HideContext;
};

async function run() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) { console.error("no tenant found — seed first"); process.exit(1); }
  T = tenant.id;

  const brand = await prisma.brand.create({ data: { tenantId: T, name: "Connection Test Brand" } });
  const acct = await prisma.connectedAccount.create({
    data: { tenantId: T, brandId: brand.id, platform: "facebook_page", status: "active", health: "unknown", mode: "read_only", externalId: "TOK_PAGE", pageId: "TOK_PAGE", grantedPermissions: ["pages_manage_engagement"], accessToken: PAGE_TOKEN, connectionStatus: "connected", tokenHealth: "unknown" },
  });
  const cleanup = async () => {
    await prisma.platformActionExecution.deleteMany({ where: { connectedAccountId: acct.id } });
    await prisma.auditLog.deleteMany({ where: { brandId: brand.id } });
    await prisma.connectedAccount.deleteMany({ where: { id: acct.id } });
    await prisma.brand.deleteMany({ where: { id: brand.id } });
  };

  try {
    // 1) watchdog marks an OK token healthy.
    const okT = new MockFacebookHideTransport({ ok: true }, { pageToken: { ok: true, pageId: "TOK_PAGE", pageName: "Konfigurátor" } });
    const r1 = await checkAccountToken(acct.id, { transport: okT });
    const a1 = await prisma.connectedAccount.findUnique({ where: { id: acct.id }, select: { connectionStatus: true, tokenHealth: true, health: true, lastSuccessfulGraphCheckAt: true } });
    check("1) watchdog marks OK token healthy", r1.tokenHealth === "ok" && r1.connectionStatus === "connected" && a1?.tokenHealth === "ok" && a1?.health === "healthy" && a1?.lastSuccessfulGraphCheckAt != null, JSON.stringify(r1));

    // 2) watchdog marks an invalid token needs_reconnect.
    const badT = new MockFacebookHideTransport({ ok: true }, { pageToken: { ok: false, errorCode: "token_invalid" } });
    const r2 = await checkAccountToken(acct.id, { transport: badT });
    const a2 = await prisma.connectedAccount.findUnique({ where: { id: acct.id }, select: { connectionStatus: true, tokenHealth: true, health: true, lastError: true } });
    check("2) watchdog marks invalid token needs_reconnect", r2.connectionStatus === "needs_reconnect" && r2.tokenHealth === "invalid" && a2?.connectionStatus === "needs_reconnect" && a2?.lastError === "token_invalid", JSON.stringify(r2));

    // 3) reconnect stores connected + then validates page object → tokenHealth ok.
    const fields = metaConnectedAccountFields({ externalName: "Konfigurátor", pageId: "TOK_PAGE", igBusinessId: null, scopes: [], grantedPermissions: ["pages_manage_engagement"], encryptedToken: "x", tokenType: "page", tokenExpiresAt: null });
    check("3) reconnect resets connectionStatus=connected", fields.connectionStatus === "connected" && fields.tokenHealth === "unknown");
    await prisma.connectedAccount.update({ where: { id: acct.id }, data: fields });
    const r3 = await checkAccountToken(acct.id, { transport: okT });
    check("3b) post-reconnect page validation → tokenHealth ok", r3.tokenHealth === "ok" && r3.connectionStatus === "connected");

    // 4) reconnect clears token_expired/requiresReconnectReason.
    check("4) reconnect clears token errors", fields.lastError === null && fields.requiresReconnectReason === null);

    // 5) hide preflight blocks needs_reconnect (no Graph hide call).
    const t5 = new MockFacebookHideTransport({ ok: true });
    const r5 = await attemptFacebookHide(ctx(acct.id, { account: { connectionStatus: "needs_reconnect", tokenHealth: "invalid" } }), { config: CFG, transport: t5, liveAttempt: true });
    check("5) preflight blocks needs_reconnect", r5.status === "blocked" && r5.reason === "reconnect_required" && t5.calls.length === 0, `${r5.status}/${r5.reason}`);

    // 6) hide preflight blocks tokenHealth != ok.
    const t6 = new MockFacebookHideTransport({ ok: true });
    const r6 = await attemptFacebookHide(ctx(acct.id, { account: { connectionStatus: "connected", tokenHealth: "expired" } }), { config: CFG, transport: t6, liveAttempt: true });
    check("6) preflight blocks tokenHealth != ok", r6.status === "blocked" && r6.reason === "token_not_healthy" && t6.calls.length === 0, `${r6.reason}`);

    // 7) the real-time comment/token check runs before the hide (token error → reconnect, no POST).
    const t7 = new MockFacebookHideTransport({ ok: true }, { comment: { ok: false, errorCode: "token_expired" } });
    const r7 = await attemptFacebookHide(ctx(acct.id), { config: CFG, transport: t7, liveAttempt: true });
    const a7 = await prisma.connectedAccount.findUnique({ where: { id: acct.id }, select: { connectionStatus: true } });
    check("7) live comment check runs before hide; token error → reconnect, no POST", r7.status === "blocked" && r7.reason === "reconnect_required" && t7.calls.length === 0 && a7?.connectionStatus === "needs_reconnect", `${r7.reason}`);

    // 8) can_hide=false blocks the live hide (no POST).
    const t8 = new MockFacebookHideTransport({ ok: true }, { comment: { ok: true, canHide: false, isHidden: false } });
    const r8 = await attemptFacebookHide(ctx(acct.id), { config: CFG, transport: t8, liveAttempt: true });
    check("8) can_hide=false blocks live hide (no POST)", r8.status === "blocked" && r8.reason === "facebook_can_hide_false" && t8.calls.length === 0, `${r8.reason}/calls=${t8.calls.length}`);

    // 10) is_hidden=true → already_hidden (no POST).
    const t10 = new MockFacebookHideTransport({ ok: true }, { comment: { ok: true, canHide: true, isHidden: true } });
    const r10 = await attemptFacebookHide(ctx(acct.id), { config: CFG, transport: t10, liveAttempt: true });
    check("10) is_hidden=true → already_hidden (no POST)", r10.status === "executed" && r10.reason === "already_hidden" && t10.calls.length === 0, `${r10.status}/${r10.reason}`);

    // 14) autonomous hide blocked when token unhealthy.
    const t14 = new MockFacebookHideTransport({ ok: true });
    const r14 = await attemptFacebookHide(ctx(acct.id, { trigger: "autonomous", mode: "autonomous", account: { connectionStatus: "connected", tokenHealth: "invalid" } }), { config: CFG, transport: t14, liveAttempt: false });
    check("14) autonomous hide blocked when token unhealthy", r14.status === "blocked" && r14.reason === "token_not_healthy" && t14.calls.length === 0, `${r14.reason}`);

    // 15) token never logged in rows / audit.
    const rows = JSON.stringify(await prisma.platformActionExecution.findMany({ where: { connectedAccountId: acct.id } }));
    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { brandId: brand.id } }));
    check("15) token never logged", !rows.includes(PAGE_TOKEN) && !audits.includes(PAGE_TOKEN));

    // 16) no reply/delete/Instagram — Instagram blocks; only hide ops issued across all mocks.
    const t16 = new MockFacebookHideTransport({ ok: true });
    const r16 = await attemptFacebookHide(ctx(acct.id, { platform: "instagram_business", account: { connectionStatus: "connected", tokenHealth: "ok" } }), { config: CFG, transport: t16, liveAttempt: true });
    check("16) Instagram blocked; only hide ops used", r16.status === "blocked" && t16.calls.length === 0, r16.reason);

    // Source assertions (9/11/12/13).
    const aq = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
    check("9) can_hide=false hides the live button", aq.includes("canHideFalse") && /liveMode = decision\.primary === "live_hide" && !canHideFalse/.test(aq));
    const diag = readSrc("packages/sync/scripts/facebook-token-diagnose.ts");
    check("11) page token diagnosis does not rely on /me/accounts", diag.includes("getPageTokenState") && diag.includes("page_token_ok") && /\/me\/accounts.*secondary|secondary.*\/me\/accounts|user token check/i.test(diag));
    const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
    check("12) Command Center shows reconnect banner + connections", cc.includes("reconnectAccounts") && cc.includes("connectionsTitle"));
    const ad = readSrc("apps/web/src/app/dashboard/accounts/[accountId]/page.tsx");
    check("13) Account detail shows token health", ad.includes("tokenHealthLabel") && ad.includes("connectionStatusLabel"));
  } finally {
    await cleanup();
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Persistent Connection Manager`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
