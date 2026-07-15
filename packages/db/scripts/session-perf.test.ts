/**
 * V1.51C — session performance: THROTTLED lastSeenAt writes + db_query_duration instrumentation,
 * with NO loss of correctness (revocation / expiry / passwordChangedAt still enforced).
 * REAL DB test. Run via: pnpm session-perf:test
 */
import { randomBytes } from "node:crypto";
import { prisma, systemDb, registerUser, hashPassword, createUserSession, readUserSession, LAST_SEEN_THROTTLE_MS } from "@guardora/db";
import { metrics } from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const lastSeen = (tokenHash: string) => systemDb.userSession.findUnique({ where: { tokenHash }, select: { lastSeenAt: true } });

async function run() {
  const sfx = randomBytes(5).toString("hex");
  const reg = await registerUser({ email: `sp-${sfx}@ex.com`, passwordHash: await hashPassword("session perf pw 1"), workspaceName: "SP Co", country: "SK" });
  const sess = await createUserSession({ userId: reg.userId });
  const tokenHash = (await systemDb.userSession.findFirst({ where: { userId: reg.userId }, select: { tokenHash: true } }))!.tokenHash;

  // 1) First read sets lastSeenAt.
  const before = metrics.getHistogram("db_query_duration", { operation: "session_read" })?.count ?? 0;
  const r1 = await readUserSession(sess.token);
  check("session read succeeds", r1.ok === true);
  const ls1 = (await lastSeen(tokenHash))?.lastSeenAt ?? null;
  check("first read sets lastSeenAt", ls1 !== null);

  // 2) db_query_duration{operation:session_read} recorded on the read (instrumentation live).
  const after = metrics.getHistogram("db_query_duration", { operation: "session_read" })?.count ?? 0;
  check("db_query_duration recorded for the session read", after === before + 1, `before=${before} after=${after}`);

  // 3) THROTTLE: an immediate second read must NOT rewrite lastSeenAt (< 10 min stale).
  await readUserSession(sess.token);
  const ls2 = (await lastSeen(tokenHash))?.lastSeenAt ?? null;
  check("throttled: immediate re-read does NOT update lastSeenAt", ls1?.getTime() === ls2?.getTime(), `${ls1?.toISOString()} vs ${ls2?.toISOString()}`);

  // 4) When lastSeenAt is older than the throttle, the next read DOES update it.
  const stale = new Date(Date.now() - LAST_SEEN_THROTTLE_MS - 60_000);
  await systemDb.userSession.update({ where: { tokenHash }, data: { lastSeenAt: stale } });
  await readUserSession(sess.token);
  const ls3 = (await lastSeen(tokenHash))?.lastSeenAt ?? null;
  check("stale (>10min) lastSeenAt IS refreshed on read", (ls3?.getTime() ?? 0) > stale.getTime());

  // 5) Correctness preserved — revocation still fails closed (throttle never affects security).
  await systemDb.userSession.update({ where: { tokenHash }, data: { revokedAt: new Date() } });
  const rRevoked = await readUserSession(sess.token);
  check("revoked session still rejected (fail-closed)", rRevoked.ok === false);

  // 6) Correctness preserved — expiry still fails closed.
  const sess2 = await createUserSession({ userId: reg.userId });
  const th2 = (await systemDb.userSession.findFirst({ where: { userId: reg.userId, revokedAt: null }, orderBy: { createdAt: "desc" }, select: { tokenHash: true } }))!.tokenHash;
  await systemDb.userSession.update({ where: { tokenHash: th2 }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const rExpired = await readUserSession(sess2.token);
  check("expired session still rejected (fail-closed)", rExpired.ok === false);

  await prisma.tenant.delete({ where: { id: reg.tenantId } }).catch(() => {});
  await prisma.user.delete({ where: { id: reg.userId } }).catch(() => {});

  console.log(`\nLAST_SEEN_THROTTLE_MS = ${LAST_SEEN_THROTTLE_MS} ms (10 min)`);
  console.log(`${failures === 0 ? "PASS" : "FAIL"} — session performance: throttled lastSeenAt + instrumentation (V1.51C)`);
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
