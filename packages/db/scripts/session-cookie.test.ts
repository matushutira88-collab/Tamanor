/**
 * V1.37.3D — session COOKIE-BOUNDARY regression tests.
 *
 * Reproduces the Next.js runtime error "Cookies can only be modified in a Server
 * Action or Route Handler" and proves the fix: readSession is strictly read-only,
 * the legacy cookie never authenticates, and legacy deletion happens only in the
 * mutation-safe login/logout/tenant-switch entry points.
 *
 * These call the REAL production cookie-jar core (apps/web/src/server/session-core)
 * against real Postgres session rows. A read-only jar (whose set/delete THROW, like
 * a Server Component's cookie jar) proves the render path never mutates.
 *
 * Run: pnpm session-cookie:test
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma, readUserSession, createUserSession } from "@guardora/db";
import {
  SESSION_COOKIE, LEGACY_COOKIE, type CookieJar,
  readSessionFromJar, startSessionInJar, endSessionInJar, switchActiveTenantInJar,
} from "../../../apps/web/src/server/session-core";

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

/** Simulates a Server Component / render-time jar: reads work, mutations THROW. */
function readOnlyJar(initial: Record<string, string>): CookieJar {
  const store = new Map(Object.entries(initial));
  const boom = () => { throw new Error("Cookies can only be modified in a Server Action or Route Handler."); };
  return {
    get: (n) => (store.has(n) ? { value: store.get(n)! } : undefined),
    set: boom,
    delete: boom,
  };
}
/** Simulates a Server Action / Route Handler jar: mutations allowed + recorded. */
function mutableJar(initial: Record<string, string>) {
  const store = new Map(Object.entries(initial));
  const ops: string[] = [];
  const jar: CookieJar = {
    get: (n) => (store.has(n) ? { value: store.get(n)! } : undefined),
    set: (n, v) => { ops.push(`set:${n}`); store.set(n, v); },
    delete: (n) => { ops.push(`del:${n}`); store.delete(n); },
  };
  return { jar, store, ops };
}

async function run() {
  const sfx = randomBytes(4).toString("hex");
  const tenant = await prisma.tenant.create({ data: { name: "Ck A", slug: `ck-a-${sfx}` } });
  const tenant2 = await prisma.tenant.create({ data: { name: "Ck B", slug: `ck-b-${sfx}` } });
  const user = await prisma.user.create({ data: { email: `ck-${sfx}@t.test`, name: "Ck User" } });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: "owner" } });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant2.id, role: "owner" } });

  try {
    // A real, valid opaque token for this user.
    const { token: validToken } = await createUserSession({ userId: user.id });

    // 1) READ-ONLY render path: valid token resolves WITHOUT any cookie mutation.
    check("1) readSession does not mutate cookies (render-safe, valid token)", await (async () => {
      const s = await readSessionFromJar(readOnlyJar({ [SESSION_COOKIE]: validToken }));
      return s?.userId === user.id; // no throw ⇒ no set/delete was attempted
    })());

    // 2) READ-ONLY render path: stale/invalid token fails closed to null, no mutation.
    check("2) invalid token → null, no cookie mutation on read", await (async () => {
      const s = await readSessionFromJar(readOnlyJar({ [SESSION_COOKIE]: "not-a-real-token" }));
      return s === null;
    })());

    // 3) Legacy cookie is IGNORED — even a real token placed under the legacy name
    //    must never authenticate, and reading it must not mutate.
    check("3) legacy guardora_session cookie never authenticates", await (async () => {
      const s = await readSessionFromJar(readOnlyJar({ [LEGACY_COOKIE]: validToken }));
      return s === null;
    })());

    // 3b) With BOTH cookies present, read resolves the tamanor session and does NOT
    //     delete the legacy cookie during render (still read-only).
    check("3b) read ignores legacy but resolves tamanor without mutating", await (async () => {
      const jar = readOnlyJar({ [SESSION_COOKIE]: validToken, [LEGACY_COOKIE]: "legacy-junk" });
      const s = await readSessionFromJar(jar);
      return s?.userId === user.id; // no throw despite legacy present ⇒ no delete attempted
    })());

    // 4) LOGIN Server Action: creates tamanor_session AND clears the legacy cookie.
    const login = mutableJar({ [LEGACY_COOKIE]: "legacy-junk" });
    const loginSession = await startSessionInJar(login.jar, user.id);
    const newToken = login.store.get(SESSION_COOKIE);
    check("4) login sets tamanor_session + deletes legacy + DB session valid",
      loginSession.userId === user.id
      && !!newToken
      && login.store.has(SESSION_COOKIE)
      && !login.store.has(LEGACY_COOKIE)
      && login.ops.includes(`set:${SESSION_COOKIE}`)
      && login.ops.includes(`del:${LEGACY_COOKIE}`)
      && (await readUserSession(newToken!)).ok === true);

    // 5) LOGOUT Server Action: clears BOTH cookies AND revokes the DB session.
    const { token: logoutToken } = await createUserSession({ userId: user.id });
    const logout = mutableJar({ [SESSION_COOKIE]: logoutToken, [LEGACY_COOKIE]: "legacy-junk" });
    check("5a) DB session valid before logout", (await readUserSession(logoutToken)).ok === true);
    await endSessionInJar(logout.jar);
    check("5b) logout clears both cookies + revokes DB session",
      !logout.store.has(SESSION_COOKIE)
      && !logout.store.has(LEGACY_COOKIE)
      && logout.ops.includes(`del:${SESSION_COOKIE}`)
      && logout.ops.includes(`del:${LEGACY_COOKIE}`)
      && (await readUserSession(logoutToken)).ok === false);

    // 6) TENANT SWITCH Server Action: rotates the token + clears legacy.
    const { token: switchToken } = await createUserSession({ userId: user.id, activeTenantId: tenant.id });
    const sw = mutableJar({ [SESSION_COOKIE]: switchToken, [LEGACY_COOKIE]: "legacy-junk" });
    const switched = await switchActiveTenantInJar(sw.jar, tenant2.id);
    const rotated = sw.store.get(SESSION_COOKIE);
    check("6) tenant switch rotates token + clears legacy (old token invalid)",
      switched.tenantId === tenant2.id
      && !!rotated && rotated !== switchToken
      && !sw.store.has(LEGACY_COOKIE)
      && (await readUserSession(switchToken)).ok === false
      && (await readUserSession(rotated!)).ok === true);

    // 7) Source guardrails: the read path must contain NO cookie mutation, and the
    //    render seam (readSession/getSession/requirePermission) must not clear legacy.
    const core = readSrc("apps/web/src/server/session-core.ts");
    const readOnlyBody = core.slice(core.indexOf("export async function readSessionFromJar"), core.indexOf("export async function startSessionInJar"));
    check("7a) readSessionFromJar body has no jar.set/jar.delete", !/\.set\(|\.delete\(/.test(readOnlyBody), readOnlyBody.slice(0, 40));
    const sessionWrapper = readSrc("apps/web/src/server/session.ts");
    check("7b) readSession() never calls a mutation/clearLegacy helper",
      /readSession[\s\S]*?readSessionFromJar/.test(sessionWrapper) && !/readSession[^]*?clearLegacy/.test(sessionWrapper.slice(sessionWrapper.indexOf("export async function readSession"), sessionWrapper.indexOf("export async function endSession"))));
    const auth = readSrc("apps/web/src/server/auth.ts");
    check("7c) auth seam (getSession/requireSession) performs no cookie mutation", !/\.set\(|\.delete\(|clearLegacy/.test(auth));
  } finally {
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, tenant2.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — session cookie boundary (V1.37.3D)`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
