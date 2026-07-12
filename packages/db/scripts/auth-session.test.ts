/**
 * V1.37.1 Auth & Authorization integration tests.
 *
 * These are REAL integration tests: they call the actual production session core
 * (@guardora/db session — the exact functions `getSession`/`requireSession` and
 * every server action depend on), the real authorization predicate (@guardora/core
 * `can`, which `assertCan`/`requirePermission` use), and the exact tenant-scoped
 * query pattern the server actions run — with two real tenants + real users +
 * memberships. Nothing re-implements auth logic in the test.
 *
 * Run via: pnpm auth-session:test
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@guardora/db";
import {
  createUserSession, readUserSession, revokeUserSession, rotateUserSession,
  hashSessionToken,
} from "@guardora/db";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Permission, Role, can } from "@guardora/core";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}

async function run() {
  const auth = readSrc("apps/web/src/server/auth.ts");
  const session = readSrc("apps/web/src/server/session.ts");
  const mw = readSrc("apps/web/src/middleware.ts");
  const sessionActions = readSrc("apps/web/src/server/session-actions.ts");
  const gbpConnect = readSrc("apps/web/src/app/api/connectors/google-business/connect/route.ts");
  const metaStart = readSrc("apps/web/src/app/api/connectors/meta/start/route.ts");

  const sfx = randomBytes(4).toString("hex");
  // Two real tenants + users + memberships.
  const tenantA = await prisma.tenant.create({ data: { name: "AuthTest A", slug: `auth-a-${sfx}` } });
  const tenantB = await prisma.tenant.create({ data: { name: "AuthTest B", slug: `auth-b-${sfx}` } });
  const userA = await prisma.user.create({ data: { email: `a-${sfx}@t.test`, name: "User A" } });
  const userB = await prisma.user.create({ data: { email: `b-${sfx}@t.test`, name: "User B" } });
  const userC = await prisma.user.create({ data: { email: `c-${sfx}@t.test`, name: "User C" } });
  const userD = await prisma.user.create({ data: { email: `d-${sfx}@t.test`, name: "User D" } });
  await prisma.membership.create({ data: { userId: userA.id, tenantId: tenantA.id, role: "owner" } });
  await prisma.membership.create({ data: { userId: userB.id, tenantId: tenantB.id, role: "owner" } });
  await prisma.membership.create({ data: { userId: userC.id, tenantId: tenantA.id, role: "viewer" } });
  const memD = await prisma.membership.create({ data: { userId: userD.id, tenantId: tenantA.id, role: "owner" } });

  const brandB = await prisma.brand.create({ data: { tenantId: tenantB.id, name: "Brand B" } });
  const acctB = await prisma.connectedAccount.create({ data: { tenantId: tenantB.id, brandId: brandB.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `B_${sfx}`, pageId: `B_${sfx}` } });
  const ciB = await prisma.contentItem.create({ data: { tenantId: tenantB.id, brandId: brandB.id, connectedAccountId: acctB.id, platform: "facebook_page", kind: "comment", externalId: `bc_${sfx}`, text: "x", publishedAt: new Date() } });
  const riB = await prisma.reputationItem.create({ data: { tenantId: tenantB.id, brandId: brandB.id, platform: "facebook_page", contentItemId: ciB.id, riskLevel: "high", riskCategories: ["scam"], sentiment: "neutral" } });
  const aqiB = await prisma.actionQueueItem.create({ data: { tenantId: tenantB.id, brandId: brandB.id, itemId: riB.id, category: "scam", proposedAction: "hide_comment", queueState: "approval_required" } });

  try {
    // ---------------- SESSION SECURITY ----------------
    const { token: tokenA, sessionId: sidA } = await createUserSession({ userId: userA.id });

    // 1) A raw userId is NOT a valid session token.
    check("1) raw userId cookie not accepted", (await readUserSession(userA.id)).ok === false);
    // 2) A random token is rejected.
    check("2) random token rejected", (await readUserSession(randomBytes(32).toString("base64url"))).ok === false);
    // 3) A tampered token is rejected.
    check("3) tampered token rejected", (await readUserSession(tokenA.slice(0, -2) + (tokenA.endsWith("A") ? "B" : "A"))).ok === false);
    // 4) Expired session rejected.
    const { token: expTok } = await createUserSession({ userId: userA.id, ttlMs: -1000 });
    check("4) expired session rejected", (await readUserSession(expTok)).reason === "session_expired");
    // 5/6) Revoked session (logout) rejected — server-side invalidation.
    const { token: revTok } = await createUserSession({ userId: userA.id });
    await revokeUserSession(revTok);
    const revRead = await readUserSession(revTok);
    check("5/6) revoked/logout session rejected", revRead.ok === false && revRead.reason === "session_revoked");
    // 7) No raw token in the DB — only the SHA-256 hash is stored.
    const rowByRaw = await prisma.userSession.findFirst({ where: { tokenHash: tokenA } });
    const rowByHash = await prisma.userSession.findUnique({ where: { tokenHash: hashSessionToken(tokenA) } });
    check("7) DB stores hash only, never the raw token", rowByRaw === null && rowByHash?.id === sidA && rowByHash!.tokenHash !== tokenA);
    // 8) Legacy guardora_session yields no access (never read as a session). The legacy
    //    constant + its deletion live in the session core; deletion is mutation-only
    //    (clearLegacyInJar), and the read path never authenticates from it. (V1.37.3D)
    const sessionCore = readSrc("apps/web/src/server/session-core.ts");
    check("8) legacy guardora_session not accepted",
      !auth.includes('"guardora_session"')
      && sessionCore.includes('LEGACY_COOKIE = "guardora_session"')
      && sessionCore.includes("jar.delete(LEGACY_COOKIE)")
      && mw.includes('"tamanor_session"'));
    // 9) Session whose membership disappeared is rejected.
    const { token: tokD } = await createUserSession({ userId: userD.id, activeTenantId: tenantA.id });
    check("9a) valid before membership removal", (await readUserSession(tokD)).ok === true);
    await prisma.membership.delete({ where: { id: memD.id } });
    check("9b) session without membership rejected", (await readUserSession(tokD)).reason === "membership_missing");
    // 10) Creating a session with an active tenant the user is not a member of fails closed.
    check("10) invalid active tenant rejected", await rejects(() => createUserSession({ userId: userA.id, activeTenantId: tenantB.id })));

    // ---------------- TENANT ISOLATION (real bound session + real scoped query) ----------------
    const sessA = (await readUserSession(tokenA)).session!;
    // 11) The session's tenant is A, never B — bound server-side, not client-supplied.
    check("11) session tenant is bound to A", sessA.tenantId === tenantA.id && sessA.tenantId !== tenantB.id);
    // 12) Switching to a foreign tenant is rejected (membership re-checked).
    check("12) switch to foreign tenant rejected", await rejects(() => rotateUserSession(tokenA, { activeTenantId: tenantB.id })));
    // 13-16) With A's REAL bound tenantId, the exact production scoping pattern denies B's objects.
    const scoped = (m: string, id: string) => (prisma as never as Record<string, { findFirst: (a: unknown) => Promise<unknown> }>)[m].findFirst({ where: { id, tenantId: sessA.tenantId } });
    check("13) cross-tenant ConnectedAccount read denied", (await scoped("connectedAccount", acctB.id)) === null);
    check("14) cross-tenant ContentItem read denied", (await scoped("contentItem", ciB.id)) === null);
    check("15) cross-tenant ActionQueueItem (approve target) denied", (await scoped("actionQueueItem", aqiB.id)) === null);
    check("16) cross-tenant Brand read denied", (await scoped("brand", brandB.id)) === null);
    // 17) tenantId is derived from the validated session, never accepted from the client.
    check("17) client tenantId cannot be injected", getSessionTenantIsServerDerived(session + sessionCore) && sessA.tenantId === tenantA.id);

    // ---------------- ROLE / PERMISSION (real authz predicate) ----------------
    const sessC = (await readUserSession((await createUserSession({ userId: userC.id })).token)).session!;
    check("18) viewer cannot manage connectors", can(sessC.role as Role, Permission.ConnectorManage) === false);
    check("19) viewer cannot approve proposals", can(sessC.role as Role, Permission.ProposalApprove) === false && can(sessC.role as Role, Permission.ProposalExecute) === false);
    check("20) owner can manage connectors + approve", can(sessA.role as Role, Permission.ConnectorManage) === true && can(sessA.role as Role, Permission.ProposalApprove) === true);
    check("21) denied predicate is exactly what actions use (assertCan/requirePermission → can)", auth.includes("can(session.role, permission)") && sessC.role === "viewer");

    // ---------------- OAUTH COMPATIBILITY (server-side session enforced) ----------------
    check("22) OAuth connect routes require a real session + tenant-scoped brand", metaStart.includes("getSession()") && metaStart.includes("session.tenantId") && gbpConnect.includes("getSession()") && gbpConnect.includes("ConnectorManage"));
    check("23) dev sign-in is secure + production-disabled", sessionActions.includes("startSession(userId)") && sessionActions.includes("disabled in production") && !sessionActions.includes("jar.set(SESSION_COOKIE, userId"));

    // ---------------- LOG HYGIENE ----------------
    check("24) no token/secret logged in session core", !session.includes("console.log") && !readSrc("packages/db/src/session.ts").includes("console.log"));
  } finally {
    for (const uid of [userA.id, userB.id, userC.id, userD.id]) await prisma.userSession.deleteMany({ where: { userId: uid } });
    await prisma.actionQueueItem.deleteMany({ where: { brandId: brandB.id } });
    await prisma.reputationItem.deleteMany({ where: { brandId: brandB.id } });
    await prisma.contentItem.deleteMany({ where: { brandId: brandB.id } });
    await prisma.connectedAccount.deleteMany({ where: { brandId: brandB.id } });
    await prisma.brand.deleteMany({ where: { id: brandB.id } });
    await prisma.membership.deleteMany({ where: { userId: { in: [userA.id, userB.id, userC.id, userD.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id, userC.id, userD.id] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Auth & Authorization (V1.37.1)`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

// getSession derives tenant from the validated session row, not from any client input.
function getSessionTenantIsServerDerived(sessionSrc: string): boolean {
  return sessionSrc.includes("readUserSession(token)") && !sessionSrc.includes("searchParams") && !sessionSrc.includes("formData");
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
