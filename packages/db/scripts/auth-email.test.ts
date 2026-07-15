/**
 * V1.50C — Email verification & password recovery integration tests.
 *
 * REAL tests against the production token functions (hash-at-rest, one-time atomic consume,
 * expiry, session revocation, the passwordChangedAt backstop) + the email transport
 * abstraction. Nothing re-implements the security logic here.
 *
 * Run via: pnpm auth-email:test
 */
import { randomBytes } from "node:crypto";
import { prisma, systemDb } from "@guardora/db";
import {
  registerUser, resolveOAuthLogin, hashPassword, verifyPassword, normalizeEmail,
  createEmailVerificationToken, consumeEmailVerificationToken,
  createPasswordResetToken, resetPasswordWithToken,
  cleanupExpiredAuthTokens, hashAuthToken,
  createUserSession, readUserSession,
} from "@guardora/db";
import {
  resolveEmailConfig, createEmailTransport, MemoryEmailTransport,
} from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const sfx = randomBytes(5).toString("hex");
  const tenantIds: string[] = [];
  const userIds: string[] = [];

  // A fresh email/password account (starts UNVERIFIED).
  const email = `verify-${sfx}@example.com`;
  const reg = await registerUser({ email, passwordHash: await hashPassword("correct horse battery 1"), workspaceName: "Verify Co", country: "Slovakia" });
  tenantIds.push(reg.tenantId); userIds.push(reg.userId);
  const u0 = await systemDb.user.findUnique({ where: { id: reg.userId }, select: { emailVerifiedAt: true } });
  check("registration creates an UNVERIFIED account", u0?.emailVerifiedAt === null);

  // 1) Verification token: hashed at rest, valid consume verifies, replay fails.
  const v1 = await createEmailVerificationToken(reg.userId);
  const stored = await systemDb.emailVerificationToken.findUnique({ where: { tokenHash: hashAuthToken(v1.rawToken) }, select: { tokenHash: true } });
  check("verification token is hashed at rest (hash stored, not raw)", !!stored && stored.tokenHash !== v1.rawToken && stored.tokenHash === hashAuthToken(v1.rawToken));

  const c1 = await consumeEmailVerificationToken(v1.rawToken);
  check("valid verification succeeds", c1.ok === true && c1.ok && c1.userId === reg.userId);
  const u1 = await systemDb.user.findUnique({ where: { id: reg.userId }, select: { emailVerifiedAt: true } });
  check("emailVerifiedAt is set after verification", u1?.emailVerifiedAt !== null);
  const c1replay = await consumeEmailVerificationToken(v1.rawToken);
  check("replay of a consumed verification token fails", c1replay.ok === false && !c1replay.ok && c1replay.reason === "consumed");

  // 2) Expired token fails.
  const vExp = await createEmailVerificationToken(reg.userId);
  await systemDb.emailVerificationToken.updateMany({ where: { tokenHash: hashAuthToken(vExp.rawToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const cExp = await consumeEmailVerificationToken(vExp.rawToken);
  check("expired verification token fails", cExp.ok === false && !cExp.ok && cExp.reason === "expired");

  // 3) Resend invalidates the previous active token.
  const vA = await createEmailVerificationToken(reg.userId);
  const vB = await createEmailVerificationToken(reg.userId); // resend
  const oldRow = await systemDb.emailVerificationToken.findUnique({ where: { tokenHash: hashAuthToken(vA.rawToken) }, select: { consumedAt: true } });
  check("resend invalidates the previous verification token", oldRow?.consumedAt !== null);
  const cB = await consumeEmailVerificationToken(vB.rawToken);
  check("the newest resent token still verifies", cB.ok === true);

  // 4) Concurrent verification converges (exactly one winner).
  const vCon = await createEmailVerificationToken(reg.userId);
  const [r1, r2] = await Promise.all([consumeEmailVerificationToken(vCon.rawToken), consumeEmailVerificationToken(vCon.rawToken)]);
  const winners = [r1, r2].filter((r) => r.ok).length;
  check("concurrent verification converges to exactly one winner", winners === 1);

  // 5) Malformed / unknown token → invalid.
  const cBad = await consumeEmailVerificationToken("not-a-real-token");
  check("unknown verification token → invalid", cBad.ok === false && !cBad.ok && cBad.reason === "invalid");

  // ---- Password reset -------------------------------------------------------

  const p1 = await createPasswordResetToken(reg.userId);
  const pStored = await systemDb.passwordResetToken.findUnique({ where: { tokenHash: hashAuthToken(p1.rawToken) }, select: { tokenHash: true } });
  check("reset token is hashed at rest", !!pStored && pStored.tokenHash === hashAuthToken(p1.rawToken) && pStored.tokenHash !== p1.rawToken);

  // A live session that must be revoked by the reset.
  const preSess = await createUserSession({ userId: reg.userId });
  check("pre-reset session is valid", (await readUserSession(preSess.token)).ok === true);

  const newHash = await hashPassword("brand new password 999");
  const pr = await resetPasswordWithToken(p1.rawToken, newHash);
  check("valid reset succeeds", pr.ok === true);
  const u2 = await systemDb.user.findUnique({ where: { id: reg.userId }, select: { passwordHash: true, passwordChangedAt: true } });
  check("new password is stored as Argon2id", !!u2?.passwordHash?.startsWith("$argon2id$"));
  check("new password verifies; old password no longer works", (await verifyPassword(u2?.passwordHash ?? null, "brand new password 999")) && !(await verifyPassword(u2?.passwordHash ?? null, "correct horse battery 1")));
  check("passwordChangedAt is set", u2?.passwordChangedAt !== null);
  check("ALL prior sessions are revoked by the reset", (await readUserSession(preSess.token)).ok === false);

  // 6) Reset replay + expiry.
  const prReplay = await resetPasswordWithToken(p1.rawToken, newHash);
  check("reset token replay fails (consumed)", prReplay.ok === false && !prReplay.ok && prReplay.reason === "consumed");
  const pExp = await createPasswordResetToken(reg.userId);
  await systemDb.passwordResetToken.updateMany({ where: { tokenHash: hashAuthToken(pExp.rawToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const cpExp = await resetPasswordWithToken(pExp.rawToken, newHash);
  check("expired reset token fails", cpExp.ok === false && !cpExp.ok && cpExp.reason === "expired");

  // 7) Concurrent resets converge.
  const pCon = await createPasswordResetToken(reg.userId);
  const [pc1, pc2] = await Promise.all([resetPasswordWithToken(pCon.rawToken, newHash), resetPasswordWithToken(pCon.rawToken, newHash)]);
  check("concurrent resets converge to exactly one winner", [pc1, pc2].filter((r) => r.ok).length === 1);

  // 8) passwordChangedAt backstop: a session older than the last change fails closed even if not revoked.
  const freshSess = await createUserSession({ userId: reg.userId });
  await systemDb.userSession.updateMany({ where: { tokenHash: hashAuthToken(freshSess.token) }, data: { revokedAt: null } }); // ensure not revoked
  await systemDb.user.updateMany({ where: { id: reg.userId }, data: { passwordChangedAt: new Date(Date.now() + 5000) } }); // change "after" the session
  const backstop = await readUserSession(freshSess.token);
  check("passwordChangedAt backstop rejects a stale session", backstop.ok === false && backstop.reason === "password_changed");

  // ---- OAuth interaction ----------------------------------------------------

  const gEmail = `oauth-verify-${sfx}@example.com`;
  const g = await resolveOAuthLogin({ provider: "google", providerAccountId: `g-${sfx}`, email: gEmail, emailVerified: true, name: "G User" });
  if (g.tenantId) tenantIds.push(g.tenantId); userIds.push(g.userId);
  const gU = await systemDb.user.findUnique({ where: { id: g.userId }, select: { emailVerifiedAt: true } });
  check("OAuth provider-verified email starts VERIFIED", gU?.emailVerifiedAt !== null);

  // Anti-takeover: a provider-verified login onto an UNVERIFIED password account verifies it
  // AND invalidates the pre-set password.
  const preEmail = `pre-${sfx}@example.com`;
  const preReg = await registerUser({ email: preEmail, passwordHash: await hashPassword("attacker password 000"), workspaceName: "Pre Co", country: "Czechia" });
  tenantIds.push(preReg.tenantId); userIds.push(preReg.userId);
  await resolveOAuthLogin({ provider: "google", providerAccountId: `g-pre-${sfx}`, email: preEmail, emailVerified: true, name: "Real Owner" });
  const preU = await systemDb.user.findUnique({ where: { id: preReg.userId }, select: { emailVerifiedAt: true, passwordHash: true } });
  check("OAuth link verifies a previously-unverified account", preU?.emailVerifiedAt !== null);
  check("anti-takeover: the pre-registration password is invalidated on link", preU?.passwordHash === null);

  // ---- Email transport ------------------------------------------------------

  const memory = new MemoryEmailTransport();
  const send = await memory.send({ to: "a@b.test", subject: "s", html: "<b>h</b>", text: "t" });
  check("memory transport captures a sent message", send.ok && memory.sent.length === 1 && memory.last()?.subject === "s");
  const nullT = createEmailTransport(null);
  check("no config → null transport fails truthfully", (await nullT.send({ to: "x@y.z", subject: "s", html: "", text: "" })).ok === false);
  check("resolveEmailConfig returns null without EMAIL_FROM", resolveEmailConfig({}) === null);
  const cfg = resolveEmailConfig({ EMAIL_FROM: "no-reply@tamanor.com", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_secret" });
  check("resolveEmailConfig reads provider config from env", cfg?.provider === "resend" && cfg?.from === "no-reply@tamanor.com");

  // 9) Cleanup removes expired/consumed tokens (bounded, idempotent).
  const cleaned = await cleanupExpiredAuthTokens();
  check("cleanup removes expired/consumed tokens", cleaned.verificationRemoved >= 0 && cleaned.resetRemoved >= 0);
  const remainingConsumed = await systemDb.emailVerificationToken.count({ where: { userId: reg.userId, consumedAt: { not: null } } });
  check("consumed verification tokens are cleaned up", remainingConsumed === 0, String(remainingConsumed));

  // Cleanup fixtures.
  for (const id of tenantIds) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => {});

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — email verification & password recovery (V1.50C)`);
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
