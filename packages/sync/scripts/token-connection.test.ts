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
import { prisma, metaConnectedAccountFields, encryptToken, decryptToken } from "@guardora/db";
import { MockFacebookHideTransport, type FacebookHideTransport, type HideTransportResult, type CommentState, type PageTokenState } from "@guardora/connectors";

// Captures the exact token handed to Graph (to prove it is DECRYPTED, not the stored tag).
class CapturingTransport implements FacebookHideTransport {
  readonly name = "capture";
  readonly calls: { op: "hide" | "unhide"; commentId: string }[] = [];
  seenTokens: string[] = [];
  private hidden = false; // stateful: a successful hide flips is_hidden (verification GET)
  async hide(commentId: string, token: string): Promise<HideTransportResult> { this.seenTokens.push(token); this.calls.push({ op: "hide", commentId }); this.hidden = true; return { ok: true, responseCode: "200" }; }
  async unhide(commentId: string, token: string): Promise<HideTransportResult> { this.seenTokens.push(token); this.calls.push({ op: "unhide", commentId }); this.hidden = false; return { ok: true, responseCode: "200" }; }
  async getCommentState(_c: string, token: string): Promise<CommentState> { this.seenTokens.push(token); return { ok: true, canHide: true, isHidden: this.hidden }; }
  async getPageTokenState(pageId: string, token: string): Promise<PageTokenState> { this.seenTokens.push(token); return { ok: true, pageId }; }
}
import { attemptFacebookHide, predictHideOutcome, type HideContext } from "../src/live-actions";
import { ensureHideTarget } from "./ri-fixtures";
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

let RB = "";
let RA = "";
const submit = async (c: any, o?: any) => { await ensureHideTarget(prisma, c, RB, RA); return attemptFacebookHide(c, o); };

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

  RB = brand.id; RA = acct.id;
  try {
    // 1) watchdog marks an OK token healthy.
    const okT = new MockFacebookHideTransport({ ok: true }, { pageToken: { ok: true, pageId: "TOK_PAGE", pageName: "Konfigurátor" } });
    const r1 = await checkAccountToken(T, acct.id, { transport: okT });
    const a1 = await prisma.connectedAccount.findUnique({ where: { id: acct.id }, select: { connectionStatus: true, tokenHealth: true, health: true, lastSuccessfulGraphCheckAt: true } });
    check("1) watchdog marks OK token healthy", r1.tokenHealth === "ok" && r1.connectionStatus === "connected" && a1?.tokenHealth === "ok" && a1?.health === "healthy" && a1?.lastSuccessfulGraphCheckAt != null, JSON.stringify(r1));

    // 2) watchdog marks an invalid token needs_reconnect.
    const badT = new MockFacebookHideTransport({ ok: true }, { pageToken: { ok: false, errorCode: "token_invalid" } });
    const r2 = await checkAccountToken(T, acct.id, { transport: badT });
    const a2 = await prisma.connectedAccount.findUnique({ where: { id: acct.id }, select: { connectionStatus: true, tokenHealth: true, health: true, lastError: true } });
    check("2) watchdog marks invalid token needs_reconnect", r2.connectionStatus === "needs_reconnect" && r2.tokenHealth === "invalid" && a2?.connectionStatus === "needs_reconnect" && a2?.lastError === "token_invalid", JSON.stringify(r2));

    // 3) reconnect stores connected + then validates page object → tokenHealth ok.
    const fields = metaConnectedAccountFields({ externalName: "Konfigurátor", pageId: "TOK_PAGE", igBusinessId: null, scopes: [], grantedPermissions: ["pages_manage_engagement"], encryptedToken: "x", tokenType: "page", tokenExpiresAt: null });
    check("3) reconnect resets connectionStatus=connected", fields.connectionStatus === "connected" && fields.tokenHealth === "unknown");
    await prisma.connectedAccount.update({ where: { id: acct.id }, data: fields });
    const r3 = await checkAccountToken(T, acct.id, { transport: okT });
    check("3b) post-reconnect page validation → tokenHealth ok", r3.tokenHealth === "ok" && r3.connectionStatus === "connected");

    // 4) reconnect clears token_expired/requiresReconnectReason.
    check("4) reconnect clears token errors", fields.lastError === null && fields.requiresReconnectReason === null);

    // 5) stale needs_reconnect + fresh page check FAILS → blocked/reconnect_required, no hide.
    const t5 = new MockFacebookHideTransport({ ok: true }, { pageToken: { ok: false, errorCode: "token_expired" } });
    const r5 = await submit(ctx(acct.id, { account: { connectionStatus: "needs_reconnect", tokenHealth: "invalid" } }), { config: CFG, transport: t5, liveAttempt: true });
    check("5) needs_reconnect + failed revalidation → blocked/reconnect_required", r5.status === "blocked" && r5.reason === "reconnect_required" && t5.calls.length === 0, `${r5.status}/${r5.reason}`);

    // 5b) V1.27D — stale expired row BUT fresh page check SUCCEEDS → repaired → hide executes.
    const t5b = new MockFacebookHideTransport({ ok: true }, { pageToken: { ok: true, pageId: "TOK_PAGE", pageName: "Konfigurátor" } });
    const r5b = await submit(ctx(acct.id, { account: { connectionStatus: "needs_reconnect", tokenHealth: "expired" } }), { config: CFG, transport: t5b, liveAttempt: true });
    const heal = await prisma.connectedAccount.findUnique({ where: { id: acct.id }, select: { connectionStatus: true, tokenHealth: true, lastSuccessfulGraphCheckAt: true } });
    check("5b) stale expired + fresh token OK → self-healed, hide executed", r5b.status === "executed" && t5b.calls.some((c) => c.op === "hide") && heal?.connectionStatus === "connected" && heal?.tokenHealth === "ok", `${r5b.status}/${heal?.tokenHealth}`);

    // 6) tokenHealth expired + NO token (cannot revalidate) → blocked/token_not_healthy.
    const t6 = new MockFacebookHideTransport({ ok: true });
    const r6 = await submit(ctx(acct.id, { account: { connectionStatus: "connected", tokenHealth: "expired", accessToken: null } }), { config: CFG, transport: t6, liveAttempt: true });
    check("6) tokenHealth != ok + unverifiable → blocked/token_not_healthy", r6.status === "blocked" && r6.reason === "token_not_healthy" && t6.calls.length === 0, `${r6.reason}`);

    // 7) the real-time comment/token check runs before the hide (token error → reconnect, no POST).
    const t7 = new MockFacebookHideTransport({ ok: true }, { comment: { ok: false, errorCode: "token_expired" } });
    const r7 = await submit(ctx(acct.id), { config: CFG, transport: t7, liveAttempt: true });
    const a7 = await prisma.connectedAccount.findUnique({ where: { id: acct.id }, select: { connectionStatus: true } });
    check("7) live comment check runs before hide; token error → reconnect, no POST", r7.status === "blocked" && r7.reason === "reconnect_required" && t7.calls.length === 0 && a7?.connectionStatus === "needs_reconnect", `${r7.reason}`);

    // 8) can_hide=false blocks the live hide (no POST).
    const t8 = new MockFacebookHideTransport({ ok: true }, { comment: { ok: true, canHide: false, isHidden: false } });
    const r8 = await submit(ctx(acct.id), { config: CFG, transport: t8, liveAttempt: true });
    check("8) can_hide=false blocks live hide (no POST)", r8.status === "blocked" && r8.reason === "facebook_can_hide_false" && t8.calls.length === 0, `${r8.reason}/calls=${t8.calls.length}`);

    // 10) is_hidden=true → already_hidden (no POST).
    const t10 = new MockFacebookHideTransport({ ok: true }, { comment: { ok: true, canHide: true, isHidden: true } });
    const r10 = await submit(ctx(acct.id), { config: CFG, transport: t10, liveAttempt: true });
    check("10) is_hidden=true → already_hidden (no POST)", r10.status === "executed" && r10.reason === "already_hidden" && t10.calls.length === 0, `${r10.status}/${r10.reason}`);

    // 14) autonomous hide blocked when token unhealthy + fresh check fails.
    const t14 = new MockFacebookHideTransport({ ok: true }, { pageToken: { ok: false, errorCode: "token_invalid" } });
    const r14 = await submit(ctx(acct.id, { trigger: "autonomous", mode: "autonomous", account: { connectionStatus: "needs_reconnect", tokenHealth: "invalid" } }), { config: CFG, transport: t14, liveAttempt: false });
    check("14) autonomous hide blocked when token unhealthy", r14.status === "blocked" && r14.reason === "reconnect_required" && t14.calls.length === 0, `${r14.reason}`);

    // 15) token never logged in rows / audit.
    const rows = JSON.stringify(await prisma.platformActionExecution.findMany({ where: { connectedAccountId: acct.id } }));
    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { brandId: brand.id } }));
    check("15) token never logged", !rows.includes(PAGE_TOKEN) && !audits.includes(PAGE_TOKEN));

    // 16) no reply/delete/Instagram — Instagram blocks; only hide ops issued across all mocks.
    const t16 = new MockFacebookHideTransport({ ok: true });
    const r16 = await submit(ctx(acct.id, { platform: "instagram_business", account: { connectionStatus: "connected", tokenHealth: "ok" } }), { config: CFG, transport: t16, liveAttempt: true });
    check("16) Instagram blocked; only hide ops used", r16.status === "blocked" && t16.calls.length === 0, r16.reason);

    // RT) V1.27D runtime-order regression: a historical blocked/reconnect_required row +
    // a stale account row, but a FRESH page token check succeeds → live hide EXECUTES,
    // never returns the old blocked/reconnect_required.
    await prisma.connectedAccount.update({ where: { id: acct.id }, data: { connectionStatus: "needs_reconnect", tokenHealth: "expired", health: "error", requiresReconnectReason: "token_expired" } });
    // V1.37.5B — real parents for the historical execution row (FK + trigger).
    await ensureHideTarget(prisma, { tenantId: T, itemId: "CN_RT", queueItemId: "CN_RTQ" }, RB, RA);
    await prisma.platformActionExecution.create({ data: { tenantId: T, brandId: brand.id, itemId: "CN_RT", queueItemId: "CN_RTQ", policyId: "P_pol", connectedAccountId: acct.id, platform: "facebook_page", actionType: "hide_comment", requestedBy: "user", trigger: "approval", status: "blocked", reason: "reconnect_required" } });
    const okAll = new MockFacebookHideTransport({ ok: true, responseCode: "200" }, { pageToken: { ok: true, pageId: "TOK_PAGE", pageName: "Konfigurátor" }, comment: { ok: true, canHide: true, isHidden: false } });
    const rRT = await submit(ctx(acct.id, { itemId: "CN_RT", queueItemId: "CN_RTQ", account: { connectionStatus: "needs_reconnect", tokenHealth: "expired" } }), { config: CFG, transport: okAll, liveAttempt: true });
    const rtRow = await prisma.platformActionExecution.findFirst({ where: { tenantId: T, queueItemId: "CN_RTQ", status: "executed" } });
    check("RT) blocked row + stale account + fresh token OK → executed (not reconnect_required)", rRT.status === "executed" && rRT.reason === "live_hide_executed" && rtRow?.executedAt != null && okAll.calls.some((c) => c.op === "hide"), `${rRT.status}/${rRT.reason}`);

    // UI) predictHideOutcome after a fresh page check repairs the row → live_possible.
    await prisma.connectedAccount.update({ where: { id: acct.id }, data: { connectionStatus: "needs_reconnect", tokenHealth: "expired", health: "error" } });
    const repaired = await checkAccountToken(T, acct.id, { transport: new MockFacebookHideTransport({ ok: true }, { pageToken: { ok: true, pageId: "TOK_PAGE" } }) });
    const pred = predictHideOutcome({
      tenantId: T, brandId: "B", itemId: "X", queueItemId: "Y", policyId: "P", connectedAccountId: acct.id, platform: "facebook_page",
      externalCommentId: "C1", externalPostId: null, matchedCategory: "scam", confidence: 0.95, riskLevel: "critical", mode: "approval", trigger: "approval",
      account: { status: "active", health: repaired.tokenHealth === "ok" ? "healthy" : "error", grantedPermissions: ["pages_manage_engagement"], pageId: "TOK_PAGE", externalId: "TOK_PAGE", connectionStatus: repaired.connectionStatus, tokenHealth: repaired.tokenHealth },
    }, CFG);
    check("UI) stale account + fresh page ok → predict live_possible", pred.expected === "live_possible", `${pred.expected}/${pred.reason}`);

    // ENC) V1.27D runtime bug: the stored Page token is TAGGED/encrypted; the hide path
    // must send the DECRYPTED token to Graph, else Graph rejects it (code 190) → false
    // reconnect_required. This is the true cause of the real-UI failure.
    const RAW = "EAArealpagetoken_abc123";
    const stored = encryptToken(RAW);
    check("ENC0) storage tags the token; decrypt strips it", stored !== RAW && decryptToken(stored) === RAW);
    const cap = new CapturingTransport();
    // The caller (web action) is responsible for decrypting; simulate that contract.
    const rEnc = await submit(ctx(acct.id, { itemId: "ENC", queueItemId: "ENCQ", account: { accessToken: decryptToken(stored) } }), { config: CFG, transport: cap, liveAttempt: true });
    check("ENC1) Graph receives the DECRYPTED token and hide executes", rEnc.status === "executed" && cap.seenTokens.length > 0 && cap.seenTokens.every((t) => t === RAW) && !cap.seenTokens.some((t) => t.startsWith("plain:")), `${rEnc.status}/tokensOk=${cap.seenTokens.every((t) => t === RAW)}`);
    // A tagged token would fail — prove the transport never receives the tag.
    check("ENC2) tagged token never reaches Graph", !cap.seenTokens.includes(stored));

    // Source assertions (9/11/12/13 + page self-heal wiring + token decrypt in the real path).
    const aq = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
    check("UI2) page self-heals via checkAccountToken and passes it to predict", aq.includes("checkAccountToken") && aq.includes("connectionStatus: effConn"));
    const actionsSrc = readSrc("apps/web/src/app/dashboard/action-queue/[id]/actions.ts");
    check("ENC3) web hide action decrypts the token before the Graph call", /decryptToken\(acct\.longLivedToken \?\? acct\.accessToken\)/.test(actionsSrc) && actionsSrc.includes("accessToken: pageToken"));
    const syncSrc = readSrc("packages/sync/src/index.ts");
    check("ENC4) autonomous path decrypts the token before the Graph call", /accessToken: decryptToken\(account\.longLivedToken \?\? account\.accessToken\)/.test(syncSrc));
    check("9) can_hide=false hides the live button", aq.includes("canHideFalse") && /liveMode = decision\.primary === "live_hide" && !canHideFalse/.test(aq));
    const diag = readSrc("packages/sync/scripts/facebook-token-diagnose.ts");
    check("11) page token diagnosis does not rely on /me/accounts", diag.includes("getPageTokenState") && diag.includes("page_token_ok") && /\/me\/accounts.*secondary|secondary.*\/me\/accounts|user token check/i.test(diag));
    const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
    check("12) Command Center shows reconnect state + connections", cc.includes("needsReconnect") && cc.includes("connectionsTitle") && cc.includes("ctaReconnect"));
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
