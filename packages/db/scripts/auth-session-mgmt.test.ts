/**
 * V1.58.9 — active sessions + revoke + password change/reset against a REAL Postgres. Proves ownership
 * scoping (a user sees/revokes only THEIR sessions), revoke one/others/all, that a password change
 * revokes every session yet a fresh session survives the passwordChangedAt backstop, and that a reset
 * revokes all sessions. Run: pnpm auth-session-mgmt:test
 */
import {
  systemDb, createUserSession, readUserSession,
  listUserSessions, revokeOwnedSession, revokeOtherSessions, revokeAllSessions,
  getUserPasswordHash, changeUserPassword, hashPassword, verifyPassword,
  createPasswordResetToken, resetPasswordWithToken,
} from "@guardora/db";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const sfx = Date.now().toString(36);
  const mkUser = async (tag: string) => {
    const t = await systemDb.tenant.create({ data: { name: `Sm${tag}`, slug: `sm-${tag}-${sfx}` } });
    const u = await systemDb.user.create({ data: { email: `sm-${tag}-${sfx}@example.com`, passwordHash: await hashPassword("current-password-123"), emailVerifiedAt: new Date() } });
    await systemDb.membership.create({ data: { userId: u.id, tenantId: t.id, role: "owner" } });
    return { u, t };
  };
  const A = await mkUser("a"); const B = await mkUser("b");

  try {
    console.log("Active sessions — ownership scoping");
    const a1 = await createUserSession({ userId: A.u.id, activeTenantId: A.t.id, userAgentSummary: "Chrome · macOS" });
    const a2 = await createUserSession({ userId: A.u.id, activeTenantId: A.t.id, userAgentSummary: "Safari · iOS" });
    const b1 = await createUserSession({ userId: B.u.id, activeTenantId: B.t.id });

    const listA = await listUserSessions(A.u.id, a1.sessionId);
    check("user sees exactly their OWN live sessions", listA.length === 2 && listA.every((s) => [a1.sessionId, a2.sessionId].includes(s.id)));
    check("no other user's session is visible", !listA.some((s) => s.id === b1.sessionId));
    check("current device is marked", listA.find((s) => s.id === a1.sessionId)?.current === true && listA.find((s) => s.id === a2.sessionId)?.current === false);
    check("safe fields only (device label, no token)", listA[0]!.userAgentSummary !== undefined && !("tokenHash" in (listA[0]! as object)));

    console.log("Revoke");
    check("cannot revoke ANOTHER user's session", (await revokeOwnedSession(A.u.id, b1.sessionId)) === false && (await readUserSession(b1.token)).ok === true);
    check("revoke ONE own session", (await revokeOwnedSession(A.u.id, a2.sessionId)) === true && (await readUserSession(a2.token)).reason === "session_revoked");
    check("the current session still valid after revoking another", (await readUserSession(a1.token)).ok === true);

    // revoke others (keep a1)
    const a3 = await createUserSession({ userId: A.u.id, activeTenantId: A.t.id });
    const others = await revokeOtherSessions(A.u.id, a1.sessionId);
    check("revoke OTHERS keeps current, revokes the rest", others >= 1 && (await readUserSession(a1.token)).ok === true && (await readUserSession(a3.token)).reason === "session_revoked");

    console.log("Password change");
    const hash = await getUserPasswordHash(A.u.id);
    check("current password verifies", !!hash && (await verifyPassword(hash!, "current-password-123")));
    const newHash = await hashPassword("a-brand-new-strong-passphrase");
    await changeUserPassword(A.u.id, newHash, null); // revoke ALL + passwordChangedAt
    check("password change revokes ALL existing sessions", (await readUserSession(a1.token)).ok === false);
    // A fresh session minted AFTER the change survives (createdAt > passwordChangedAt).
    const fresh = await createUserSession({ userId: A.u.id, activeTenantId: A.t.id });
    check("a fresh session after the change is valid (backstop not tripped)", (await readUserSession(fresh.token)).ok === true);
    check("new password is what verifies now", await verifyPassword((await getUserPasswordHash(A.u.id))!, "a-brand-new-strong-passphrase"));

    console.log("Password reset revokes sessions");
    const bTok = await createUserSession({ userId: B.u.id, activeTenantId: B.t.id });
    const { rawToken } = await createPasswordResetToken(B.u.id);
    const res = await resetPasswordWithToken(rawToken, await hashPassword("reset-strong-passphrase-77"));
    check("reset consumes token + succeeds", res.ok === true);
    check("reset revokes ALL of the user's sessions", (await readUserSession(bTok.token)).ok === false && (await readUserSession(b1.token)).ok === false);

    console.log("Revoke all");
    const x1 = await createUserSession({ userId: A.u.id, activeTenantId: A.t.id });
    const n = await revokeAllSessions(A.u.id);
    check("revoke ALL revokes every session incl. current", n >= 1 && (await readUserSession(x1.token)).ok === false && (await readUserSession(fresh.token)).ok === false);
  } finally {
    for (const X of [A, B]) {
      await systemDb.userSession.deleteMany({ where: { userId: X.u.id } });
      await systemDb.passwordResetToken.deleteMany({ where: { userId: X.u.id } });
      await systemDb.membership.deleteMany({ where: { userId: X.u.id } });
      await systemDb.user.deleteMany({ where: { id: X.u.id } });
      await systemDb.tenant.deleteMany({ where: { id: X.t.id } });
    }
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — active sessions, revoke, password change/reset (V1.58.9)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
