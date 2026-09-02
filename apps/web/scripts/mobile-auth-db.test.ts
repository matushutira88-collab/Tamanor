/**
 * M2 — mobile bearer transport against REAL Postgres rows.
 *
 * The pure suite (`pnpm mobile-auth:test`) proves the request logic with fakes.
 * This one proves the properties only a real database can show: that the bearer
 * token is the genuine high-entropy opaque `UserSession` token, that the server
 * enforces revocation / idle / absolute expiry / passwordChangedAt / membership on
 * a bearer request exactly as it does on a cookie request, and that a token for one
 * tenant can never resolve another.
 *
 * It deliberately wires the REAL `@guardora/db` session functions into the mobile
 * service — the same functions the web cookie path uses — so a divergence between
 * the two transports would fail here.
 *
 * REQUIRES a provisioned local database (DATABASE_URL + applied migrations). It
 * skips with a clear message when one is absent, rather than reporting a false pass.
 *
 * Run: pnpm mobile-auth-db:test
 */
import { randomBytes } from "node:crypto";
import {
  prisma, createUserSession, readUserSession, revokeUserSession, hashSessionToken,
} from "@guardora/db";
import { classifyWorkspaceRouting } from "@guardora/core";
import {
  handleMobileSession, handleMobileLogout, type MobileAuthDeps, type MobileWorkspace,
} from "../src/server/mobile-auth";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`);
  c ? pass++ : fail++;
};

/** The mobile service wired to the REAL session store. */
function realDeps(): MobileAuthDeps {
  return {
    // Credential checking is covered by the pure suite; this file exercises the
    // session transport, so the credential core is not reached.
    authenticateCredentials: async () => ({ ok: false, failure: "invalid_credentials" }),
    credentialDeps: null as never,
    createUserSession: async (input) => {
      const created = await createUserSession(input);
      return { token: created.token, session: created.session };
    },
    readUserSession,
    revokeUserSession,
    classifyWorkspace: (kind): MobileWorkspace => classifyWorkspaceRouting(kind),
    summarizeUserAgent: () => "Tamanor · iOS",
    metrics: { inc: () => {} },
    emitOpsEvent: () => {},
  };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function run() {
  const deps = realDeps();
  const sfx = randomBytes(4).toString("hex");

  const tenantA = await prisma.tenant.create({ data: { name: "Mob A", slug: `mob-a-${sfx}` } });
  const tenantB = await prisma.tenant.create({ data: { name: "Mob B", slug: `mob-b-${sfx}` } });
  const userA = await prisma.user.create({ data: { email: `mob-a-${sfx}@t.test`, name: "Mob A User" } });
  const userB = await prisma.user.create({ data: { email: `mob-b-${sfx}@t.test`, name: "Mob B User" } });
  await prisma.membership.create({ data: { userId: userA.id, tenantId: tenantA.id, role: "owner" } });
  await prisma.membership.create({ data: { userId: userB.id, tenantId: tenantB.id, role: "owner" } });

  try {
    /* ---------------- token properties ---------------- */
    const { token, session } = await createUserSession({ userId: userA.id });

    check("token is high-entropy (>= 32 bytes, base64url)", token.length >= 43 && /^[A-Za-z0-9_-]+$/.test(token));
    check("token does not encode the user id", !token.includes(userA.id));
    check("token does not encode the email", !token.includes(userA.email));
    check("token does not encode the tenant id", !token.includes(tenantA.id));
    check("token is not a JWT", token.split(".").length !== 3);
    check("two logins mint DIFFERENT tokens (fresh per session)",
      token !== (await createUserSession({ userId: userA.id })).token);

    const row = await prisma.userSession.findUnique({ where: { tokenHash: hashSessionToken(token) } });
    check("only the token HASH is persisted — never the raw token", row !== null && !JSON.stringify(row).includes(token));

    /* ---------------- session endpoint ---------------- */
    {
      const res = await handleMobileSession(bearer(token), deps);
      const view = res.body.session as Record<string, unknown>;
      check("valid bearer resolves the session", res.status === 200 && view.userEmail === userA.email);
      check("resolved tenant comes from the session row", view.tenantName === "Mob A");
      check("response exposes no internal ids", !("userId" in view) && !("tenantId" in view) && !("sessionId" in view));
      check("response never contains the token", !JSON.stringify(res.body).includes(token));
    }
    {
      const res = await handleMobileSession(bearer("not-a-real-token"), deps);
      check("a forged token is rejected", res.status === 401 && res.body.error === "unauthenticated");
    }

    /* ---------------- tenant isolation ---------------- */
    {
      const { token: tokenB } = await createUserSession({ userId: userB.id });
      const res = await handleMobileSession(bearer(tokenB), deps);
      const view = res.body.session as Record<string, unknown>;
      check("token for B resolves B, never A", view.userEmail === userB.email && view.tenantName === "Mob B");
      const resA = await handleMobileSession(bearer(token), deps);
      check("token for A still resolves only A", (resA.body.session as Record<string, unknown>).tenantName === "Mob A");
    }

    /* ---------------- revocation ---------------- */
    {
      const { token: t } = await createUserSession({ userId: userA.id });
      const out = await handleMobileLogout(bearer(t), deps);
      check("logout returns 200", out.status === 200);
      const after = await handleMobileSession(bearer(t), deps);
      check("a revoked token cannot access the session endpoint", after.status === 401 && after.body.error === "session_revoked");
      const again = await handleMobileLogout(bearer(t), deps);
      check("repeated logout is idempotent", again.status === 200);
    }

    /* ---------------- lifetime enforcement ---------------- */
    {
      // Token expiry in the past.
      const { token: t } = await createUserSession({ userId: userA.id, ttlMs: -1_000 });
      const res = await handleMobileSession(bearer(t), deps);
      check("an expired token is rejected", res.status === 401 && res.body.error === "session_expired");
    }
    {
      // Absolute ceiling already passed.
      const { token: t } = await createUserSession({ userId: userA.id, absoluteExpiresAt: new Date(Date.now() - 1_000) });
      const res = await handleMobileSession(bearer(t), deps);
      check("a session past its ABSOLUTE ceiling is rejected", res.status === 401 && res.body.error === "session_expired");
    }
    {
      // Idle: push lastSeenAt far into the past.
      const { token: t, sessionId } = await createUserSession({ userId: userA.id });
      await prisma.userSession.update({
        where: { id: sessionId },
        data: { lastSeenAt: new Date(Date.now() - 365 * 86_400_000) },
      });
      const res = await handleMobileSession(bearer(t), deps);
      check("an IDLE-expired session is rejected", res.status === 401 && res.body.error === "session_expired");
    }

    /* ---------------- passwordChangedAt + membership ---------------- */
    {
      const { token: t } = await createUserSession({ userId: userA.id });
      await prisma.user.update({ where: { id: userA.id }, data: { passwordChangedAt: new Date(Date.now() + 1_000) } });
      const res = await handleMobileSession(bearer(t), deps);
      check("a password change invalidates existing bearer sessions", res.status === 401 && res.body.error === "session_revoked");
      await prisma.user.update({ where: { id: userA.id }, data: { passwordChangedAt: null } });
    }
    {
      const user = await prisma.user.create({ data: { email: `mob-c-${sfx}@t.test`, name: "Mob C" } });
      const m = await prisma.membership.create({ data: { userId: user.id, tenantId: tenantA.id, role: "owner" } });
      const { token: t } = await createUserSession({ userId: user.id });
      await prisma.membership.delete({ where: { id: m.id } });
      const res = await handleMobileSession(bearer(t), deps);
      check("losing membership fails closed", res.status === 401 && res.body.error === "unauthenticated");
      await prisma.userSession.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }

    /* ---------------- parity with the cookie path ---------------- */
    {
      const { token: t } = await createUserSession({ userId: userA.id });
      const direct = await readUserSession(t);
      const viaBearer = await handleMobileSession(bearer(t), deps);
      check("bearer transport resolves the SAME session the cookie path would",
        direct.ok && (viaBearer.body.session as Record<string, unknown>).userEmail === direct.session?.userEmail);
    }
  } finally {
    await prisma.userSession.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
    await prisma.membership.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await prisma.$disconnect();
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — mobile auth bearer transport vs. Postgres (M2): ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.log("SKIP — mobile-auth-db:test needs a provisioned local database (DATABASE_URL + applied migrations).");
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
