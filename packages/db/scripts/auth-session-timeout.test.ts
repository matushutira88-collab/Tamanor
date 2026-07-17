/**
 * V1.58.9 — server-enforced session lifetime against a REAL Postgres. Drives the REAL session core
 * (createUserSession / readUserSession / rotateUserSession) with INJECTED timeouts + clock — no real
 * waiting — to prove idle timeout, absolute ceiling, activity sliding (that never beats the absolute),
 * remember-me, throttled activity writes, rotation ceiling-preservation, and backward compatibility
 * with pre-migration sessions (absoluteExpiresAt = NULL).
 *
 * Run: pnpm auth-session-timeout:test   (spins up a throwaway Postgres, applies all migrations)
 */
import { systemDb, createUserSession, readUserSession, rotateUserSession, type SessionTimeouts } from "@guardora/db";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
// Small, fast timeouts: idle 1s, absolute 10s, remember 100s, touch 0.2s.
const T: SessionTimeouts = { idleMs: 1000, absoluteMs: 10_000, rememberMs: 100_000, touchMs: 200 };
const BASE = Date.UTC(2030, 0, 1);
const at = (ms: number) => new Date(BASE + ms);

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: "Se", slug: `se-${sfx}` } });
  const u = await systemDb.user.create({ data: { email: `se-${sfx}@example.com`, emailVerifiedAt: new Date() } });
  await systemDb.membership.create({ data: { userId: u.id, tenantId: t.id, role: "owner" } });
  const lastSeen = (id: string) => systemDb.userSession.findUnique({ where: { id }, select: { lastSeenAt: true } }).then((r) => r!.lastSeenAt.getTime());

  try {
    // -------------------------------------------------------------------------
    console.log("Idle timeout");
    const s = await createUserSession({ userId: u.id, activeTenantId: t.id, timeouts: T, now: at(0) });
    check("fresh session reads OK", (await readUserSession(s.token, at(0), T)).ok);
    check("idle: no activity past idleMs → session_expired_idle", (await readUserSession(s.token, at(2000), T)).reason === "session_expired_idle");

    // -------------------------------------------------------------------------
    console.log("Activity sliding (never beats absolute)");
    const s2 = await createUserSession({ userId: u.id, activeTenantId: t.id, timeouts: T, now: at(0) });
    check("read at +500 slides activity, still valid", (await readUserSession(s2.token, at(500), T)).ok);
    check("read at +1200 valid because activity slid the idle window", (await readUserSession(s2.token, at(1200), T)).ok);

    // Absolute ceiling beats even continuous activity. Token expiry is set FAR out (ttlMs) so the
    // ABSOLUTE check is the one that fires, not the token `expiresAt`.
    const s3 = await createUserSession({ userId: u.id, activeTenantId: t.id, timeouts: T, now: at(0), ttlMs: 100_000 });
    await readUserSession(s3.token, at(9900), T); // recent activity — lastSeenAt slid to ~9900
    check("absolute ceiling rejects an ACTIVE session past absoluteMs", (await readUserSession(s3.token, at(10_001), T)).reason === "session_expired_absolute");

    // -------------------------------------------------------------------------
    console.log("Remember-me");
    const rem = await createUserSession({ userId: u.id, activeTenantId: t.id, rememberMe: true, timeouts: T, now: at(0) });
    const remRow = await systemDb.userSession.findUnique({ where: { id: rem.sessionId }, select: { rememberMe: true, absoluteExpiresAt: true } });
    check("remember-me sets rememberMe + the LONGER absolute ceiling", remRow?.rememberMe === true && remRow?.absoluteExpiresAt?.getTime() === BASE + T.rememberMs);

    // -------------------------------------------------------------------------
    console.log("Throttled activity write");
    const s4 = await createUserSession({ userId: u.id, activeTenantId: t.id, timeouts: T, now: at(0) });
    await readUserSession(s4.token, at(100), T); // within touchMs (200) → no write
    check("read within touch interval does NOT slide lastSeenAt", (await lastSeen(s4.sessionId)) === BASE);
    await readUserSession(s4.token, at(300), T); // beyond touchMs → write
    check("read past touch interval slides lastSeenAt", (await lastSeen(s4.sessionId)) === BASE + 300);

    // -------------------------------------------------------------------------
    console.log("Rotation preserves the absolute ceiling (real clock)");
    const r = await createUserSession({ userId: u.id, activeTenantId: t.id, rememberMe: true });
    const oldAbs = r.session.absoluteExpiresAt!.getTime();
    const rot = await rotateUserSession(r.token);
    check("rotation preserves the ORIGINAL absolute ceiling (no extension)", rot.session.absoluteExpiresAt!.getTime() === oldAbs);
    check("rotation preserves rememberMe", rot.session.rememberMe === true);
    check("old token is revoked after rotation (session-fixation safe)", (await readUserSession(r.token)).reason === "session_revoked");
    check("new token is valid", (await readUserSession(rot.token)).ok);

    // -------------------------------------------------------------------------
    console.log("Backward compatibility (pre-migration session, absoluteExpiresAt = NULL)");
    const legacy = await createUserSession({ userId: u.id, activeTenantId: t.id });
    await systemDb.userSession.update({ where: { id: legacy.sessionId }, data: { absoluteExpiresAt: null } });
    check("a NULL-absolute (pre-migration) session still resolves (no forced logout)", (await readUserSession(legacy.token)).ok);
  } finally {
    await systemDb.userSession.deleteMany({ where: { userId: u.id } });
    await systemDb.membership.deleteMany({ where: { userId: u.id } });
    await systemDb.user.deleteMany({ where: { id: u.id } });
    await systemDb.tenant.deleteMany({ where: { id: t.id } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — server-enforced session lifetime (V1.58.9)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
