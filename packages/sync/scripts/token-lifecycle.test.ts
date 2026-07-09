/**
 * V1.27B — Facebook Page token lifecycle for real hides.
 * A token_expired failure must (1) mark the account for reconnect, (2) be blocked
 * precisely on the next preflight without calling Graph, and (3) never leak a token.
 * The hide must use the stored PAGE token, not a user token. Reconnect clears it.
 *
 * Run via: pnpm token-lifecycle:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma, metaConnectedAccountFields } from "@guardora/db";
import { MockFacebookHideTransport, type FacebookHideTransport, type HideTransportResult } from "@guardora/connectors";
import { attemptFacebookHide, type HideContext } from "../src/live-actions";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

// Transport that captures the exact access token it was handed (to prove it is the
// PAGE token, not a user token). Records the value only inside the test process.
class CapturingTransport implements FacebookHideTransport {
  readonly name = "capture";
  seenToken: string | null = null;
  ops: string[] = [];
  constructor(private readonly outcome: HideTransportResult = { ok: true, responseCode: "200" }) {}
  async hide(_commentId: string, accessToken: string): Promise<HideTransportResult> { this.seenToken = accessToken; this.ops.push("hide"); return this.outcome; }
  async unhide(_commentId: string, accessToken: string): Promise<HideTransportResult> { this.seenToken = accessToken; this.ops.push("unhide"); return this.outcome; }
}

const CFG = { liveEnabled: true, facebookHideEnabled: true, dryRun: false, canExecuteLive: true, liveConfirmed: true, productionSafeMode: false, globalKillSwitch: false };
const PAGE_TOKEN = "PAGE_TOKEN_XYZ";

let T = "test_tenant_v127b";
let seq = 0;
const ctx = (accountId: string, over: Partial<HideContext> = {}): HideContext => {
  const n = ++seq;
  return {
    tenantId: T, brandId: "TOKB", itemId: `TK_I${n}`, queueItemId: `TK_Q${n}`, policyId: "P_pol", connectedAccountId: accountId, platform: "facebook_page",
    externalCommentId: "C1", externalPostId: "P_post", matchedCategory: "scam", confidence: 0.95, riskLevel: "critical",
    mode: "approval", trigger: "approval",
    account: { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: PAGE_TOKEN, pageId: "TOK_PAGE", externalId: "TOK_PAGE" },
    requestedBy: "user", ...over,
  };
};

async function run() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) { console.error("no tenant found — seed first"); process.exit(1); }
  T = tenant.id;

  // Test fixtures: a throwaway brand + connected account.
  const brand = await prisma.brand.create({ data: { tenantId: T, name: "TokenLifecycle Test Brand" } });
  const acct = await prisma.connectedAccount.create({
    data: { tenantId: T, brandId: brand.id, platform: "facebook_page", status: "active", health: "healthy", mode: "read_only", externalId: "TOK_PAGE", pageId: "TOK_PAGE", grantedPermissions: ["pages_manage_engagement"], accessToken: PAGE_TOKEN },
  });
  const cleanup = async () => {
    await prisma.platformActionExecution.deleteMany({ where: { connectedAccountId: acct.id } });
    await prisma.auditLog.deleteMany({ where: { brandId: brand.id } });
    await prisma.connectedAccount.deleteMany({ where: { id: acct.id } });
    await prisma.brand.deleteMany({ where: { id: brand.id } });
  };

  try {
    // 4) hide uses the PAGE access token, not a user token.
    const cap = new CapturingTransport({ ok: true, responseCode: "200" });
    const rOk = await attemptFacebookHide(ctx(acct.id), { config: CFG, transport: cap, liveAttempt: true });
    check("4) hide uses the stored PAGE access token", rOk.status === "executed" && cap.seenToken === PAGE_TOKEN && cap.ops.length === 1 && cap.ops[0] === "hide", `${rOk.status}/token=${cap.seenToken === PAGE_TOKEN}`);

    // 1) token_expired failure marks the account needs_reconnect.
    const tExp = new MockFacebookHideTransport({ ok: false, responseCode: "400", errorCode: "token_expired", errorMessage: "Graph hide failed (HTTP 400)." });
    const rExp = await attemptFacebookHide(ctx(acct.id), { config: CFG, transport: tExp, liveAttempt: true });
    const after = await prisma.connectedAccount.findUnique({ where: { id: acct.id }, select: { health: true, lastError: true, lastErrorAt: true } });
    check("1) token_expired → failed", rExp.status === "failed" && rExp.reason === "token_expired", `${rExp.status}/${rExp.reason}`);
    check("1b) token_expired marks account needs_reconnect", after?.health === "error" && after?.lastError === "token_expired" && after?.lastErrorAt != null, `${after?.health}/${after?.lastError}`);

    // 5) provider error is sanitized (no token in the failure message).
    const failRow = await prisma.platformActionExecution.findFirst({ where: { connectedAccountId: acct.id, status: "failed" }, orderBy: { createdAt: "desc" } });
    check("5) provider error sanitized (no token in message)", !!failRow && !JSON.stringify(failRow).includes(PAGE_TOKEN) && (failRow.providerErrorMessage ?? "").includes("HTTP 400"));

    // 2) preflight blocks an expired token (past expiry) — no Graph call.
    const tPre = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
    const rPre = await attemptFacebookHide(ctx(acct.id, { account: { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: PAGE_TOKEN, pageId: "TOK_PAGE", externalId: "TOK_PAGE", tokenExpiresAt: new Date(Date.now() - 1000) } }), { config: CFG, transport: tPre, liveAttempt: true });
    check("2) preflight blocks expired token (no Graph call)", rPre.status === "blocked" && rPre.reason === "token_expired" && tPre.calls.length === 0, `${rPre.status}/${rPre.reason}`);

    // 3) preflight blocks when the account is flagged needsReconnect — no Graph call.
    const tNr = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
    const rNr = await attemptFacebookHide(ctx(acct.id, { account: { status: "active", health: "healthy", grantedPermissions: ["pages_manage_engagement"], accessToken: PAGE_TOKEN, pageId: "TOK_PAGE", externalId: "TOK_PAGE", needsReconnect: true } }), { config: CFG, transport: tNr, liveAttempt: true });
    check("3) preflight blocks needsReconnect (no Graph call)", rNr.status === "blocked" && rNr.reason === "token_expired" && tNr.calls.length === 0, `${rNr.status}/${rNr.reason}`);

    // 6) reconnect clears token_expired (metaConnectedAccountFields resets health + lastError).
    const fields = metaConnectedAccountFields({ externalName: "Konfigurátor", pageId: "TOK_PAGE", igBusinessId: null, scopes: [], grantedPermissions: ["pages_manage_engagement"], encryptedToken: "newtoken", tokenType: "page", tokenExpiresAt: null });
    check("6) reconnect clears token_expired (health healthy, lastError null)", fields.health === "healthy" && fields.lastError === null && fields.lastErrorAt === null);

    // 7) no token leak in any execution row.
    const rows = JSON.stringify(await prisma.platformActionExecution.findMany({ where: { connectedAccountId: acct.id } }));
    check("7) no token leak in execution rows", !rows.includes(PAGE_TOKEN) && !rows.includes("pageAccessToken"));

    // 8) no reply/delete/Instagram — Instagram blocks; only hide ops ever issued.
    const tIg = new MockFacebookHideTransport({ ok: true, responseCode: "200" });
    const rIg = await attemptFacebookHide(ctx(acct.id, { platform: "instagram_business" }), { config: CFG, transport: tIg, liveAttempt: true });
    check("8) Instagram → blocked, no call; only hide ops used", rIg.status === "blocked" && tIg.calls.length === 0 && cap.ops.every((o) => o === "hide"), rIg.reason);

    // 9/10) UI source: reconnect CTA + retry disabled on token_expired.
    const aq = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
    check("9) Action Queue shows token_expired reconnect CTA", aq.includes("tokenExpired") && aq.includes("reconnectPage") && aq.includes("reconnectHref"));
    check("10) retry disabled until reconnect on token_expired", aq.includes("tokenExpired ?") && aq.includes("reconnectFirst"));
  } finally {
    await cleanup();
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Facebook token lifecycle`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
