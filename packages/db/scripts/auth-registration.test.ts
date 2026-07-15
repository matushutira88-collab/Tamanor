/**
 * V1.50A — Self-service registration + credential login integration tests.
 *
 * REAL integration tests against the production functions the web server actions
 * call: registerUser (atomic User+Tenant+Membership+Brand+trial), hashPassword /
 * verifyPassword (Argon2id), findUserForLogin, and the session core createUserSession
 * (the exact path startSession/login uses). Nothing re-implements auth logic here.
 *
 * Run via: pnpm auth-registration:test
 */
import { randomBytes } from "node:crypto";
import { prisma, systemDb } from "@guardora/db";
import {
  registerUser, findUserForLogin, hashPassword, verifyPassword,
  EmailAlreadyRegisteredError, normalizeEmail, FREE_TRIAL_PLAN,
  createUserSession, DUMMY_PASSWORD_HASH, Role,
  resolveOAuthLogin, OAuthEmailRequiredError,
} from "@guardora/db";
import { resolveUsagePolicy, isKnownPlan } from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
async function rejects(fn: () => Promise<unknown>, is?: (e: unknown) => boolean): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return is ? is(e) : true; }
}

async function run() {
  const sfx = randomBytes(5).toString("hex");
  const email = `Reg-${sfx}@Example.COM`;
  const password = "correct horse battery staple 42";
  const created: string[] = []; // tenant ids to clean up
  const oauthUserIds: string[] = []; // extra user ids created via OAuth, to clean up

  // 1) Argon2id hashing round-trips + never stores plaintext.
  const h = await hashPassword(password);
  check("hashPassword returns an Argon2id PHC string", h.startsWith("$argon2id$"), h.slice(0, 12));
  check("hash is not the plaintext", h !== password && !h.includes(password));
  check("verifyPassword accepts the correct password", await verifyPassword(h, password));
  check("verifyPassword rejects a wrong password", !(await verifyPassword(h, "wrong")));
  check("verifyPassword fail-closed on null hash", !(await verifyPassword(null, password)));
  check("dummy hash verifies false (enumeration guard is real work)", !(await verifyPassword(DUMMY_PASSWORD_HASH, password)));

  // 2) Registration creates the whole workspace graph atomically.
  const res = await registerUser({ email, passwordHash: h, workspaceName: "Acme Co", company: "Acme Ltd", country: "Slovakia" });
  created.push(res.tenantId);
  const user = await systemDb.user.findUnique({ where: { id: res.userId }, select: { email: true, passwordHash: true } });
  const tenant = await systemDb.tenant.findUnique({ where: { id: res.tenantId }, select: { plan: true, trialStartsAt: true, trialEndsAt: true, country: true } });
  const membership = await systemDb.membership.findFirst({ where: { userId: res.userId, tenantId: res.tenantId }, select: { role: true } });
  const brands = await systemDb.brand.count({ where: { tenantId: res.tenantId } });
  const policies = await systemDb.brandAutoProtectPolicy.count({ where: { tenantId: res.tenantId } });

  check("email is normalized (lower-cased) on store", user?.email === normalizeEmail(email), user?.email ?? "null");
  check("password stored as Argon2id hash (never plaintext)", !!user?.passwordHash?.startsWith("$argon2id$") && user?.passwordHash !== password);
  check("tenant plan = free_trial", tenant?.plan === FREE_TRIAL_PLAN, tenant?.plan ?? "null");
  check("trialStartsAt + trialEndsAt set", !!tenant?.trialStartsAt && !!tenant?.trialEndsAt);
  check("trial window is ~14 days", (() => {
    if (!tenant?.trialStartsAt || !tenant?.trialEndsAt) return false;
    const days = (tenant.trialEndsAt.getTime() - tenant.trialStartsAt.getTime()) / 86_400_000;
    return Math.abs(days - 14) < 0.01;
  })());
  check("country persisted", tenant?.country === "Slovakia", tenant?.country ?? "null");
  check("membership role = owner", membership?.role === Role.owner, membership?.role ?? "null");
  check("a default brand was created", brands === 1, String(brands));
  check("default auto-protect policies created", policies > 0, String(policies));

  // 3) free_trial is a known plan resolving to the (conservative) Free-equivalent policy.
  check("free_trial is a known usage plan", isKnownPlan(FREE_TRIAL_PLAN));
  const policy = resolveUsagePolicy(FREE_TRIAL_PLAN);
  check("free_trial policy does not allow generated replies", policy.allowGeneratedReplies === false);
  check("free_trial policy has a bounded premium cost cap", typeof policy.premiumCostLimitMicros === "bigint");

  // 4) Duplicate email is rejected race-safely (unique constraint → typed error).
  const dupRejected = await rejects(
    () => registerUser({ email: email.toLowerCase(), passwordHash: h, workspaceName: "Dup", country: "Czechia" }),
    (e) => e instanceof EmailAlreadyRegisteredError,
  );
  check("duplicate email throws EmailAlreadyRegisteredError", dupRejected);
  const userCount = await systemDb.user.count({ where: { email: normalizeEmail(email) } });
  check("no duplicate identity was created", userCount === 1, String(userCount));

  // 5) Login lookup + the real session path used after a verified password.
  const found = await findUserForLogin("REG-" + sfx + "@example.com");
  check("findUserForLogin matches case-insensitively", found?.id === res.userId);
  check("wrong password fails verify against stored hash", !(await verifyPassword(found?.passwordHash ?? null, "nope")));
  check("correct password verifies against stored hash", await verifyPassword(found?.passwordHash ?? null, password));

  const missing = await findUserForLogin(`no-such-${sfx}@example.com`);
  check("unknown email returns null (caller uses dummy verify)", missing === null);

  const sess = await createUserSession({ userId: res.userId });
  check("createUserSession issues a session for the new owner", !!sess.token && sess.token.length > 20);
  check("session resolves to the owner role in the new tenant", sess.session.role === Role.owner && sess.session.tenantId === res.tenantId);

  // 6) V1.50B — OAuth identity resolution: new user, login, cross-provider linking, no dups.
  const gEmail = `oauth-${sfx}@example.com`;
  const gSub = `google-sub-${sfx}`;
  const fbId = `fb-id-${sfx}`;

  // 6a) First Google sign-in → brand-new identity + workspace (isNew).
  const g1 = await resolveOAuthLogin({ provider: "google", providerAccountId: gSub, email: gEmail, emailVerified: true, name: "OAuth User" });
  if (g1.tenantId) created.push(g1.tenantId);
  oauthUserIds.push(g1.userId);
  check("first Google sign-in creates a new identity", g1.isNew === true && !!g1.userId);
  const gUser = await systemDb.user.findUnique({ where: { id: g1.userId }, select: { email: true, passwordHash: true } });
  check("OAuth-created user has NO password (OAuth-only)", gUser?.passwordHash === null);
  check("OAuth-created user got a workspace (owner membership)", (await systemDb.membership.count({ where: { userId: g1.userId, role: Role.owner } })) === 1);
  check("OAuth-created workspace is on the Free Trial", (await systemDb.tenant.findFirst({ where: { id: g1.tenantId ?? "" }, select: { plan: true } }))?.plan === FREE_TRIAL_PLAN);

  // 6b) Second Google sign-in (same sub) → SAME user, login (not new).
  const g2 = await resolveOAuthLogin({ provider: "google", providerAccountId: gSub, email: gEmail, emailVerified: true, name: "OAuth User" });
  check("returning Google sign-in resolves to the same user", g2.userId === g1.userId && g2.isNew === false);

  // 6c) Facebook sign-in with the SAME verified email → LINKS to the same user (no duplicate).
  const fb1 = await resolveOAuthLogin({ provider: "facebook", providerAccountId: fbId, email: gEmail, emailVerified: true, name: "OAuth User" });
  check("Facebook with same verified email links to the SAME identity", fb1.userId === g1.userId && fb1.isNew === false);
  check("one identity now has BOTH providers linked", (await systemDb.oAuthAccount.count({ where: { userId: g1.userId } })) === 2);
  check("no duplicate user was created by cross-provider login", (await systemDb.user.count({ where: { email: gEmail } })) === 1);

  // 6d) Missing/unverified email is refused (cannot safely create or link).
  const noEmail = await rejects(
    () => resolveOAuthLogin({ provider: "facebook", providerAccountId: `fb-noemail-${sfx}`, email: null, emailVerified: false, name: "No Email" }),
    (e) => e instanceof OAuthEmailRequiredError,
  );
  check("OAuth with no verified email throws OAuthEmailRequiredError", noEmail);

  // 6e) An existing PASSWORD account linked via a matching verified Google email (no dup).
  const g3 = await resolveOAuthLogin({ provider: "google", providerAccountId: `google-link-${sfx}`, email: `REG-${sfx}@example.com`, emailVerified: true, name: "Existing" });
  check("Google links onto an existing password account (same identity)", g3.userId === res.userId && g3.isNew === false);
  check("linking added no duplicate for the password account", (await systemDb.user.count({ where: { email: normalizeEmail(email) } })) === 1);

  // Cleanup (delete tenants → cascades memberships/brands/policies/sessions; then users → cascades oauth links).
  for (const id of created) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  for (const uid of [res.userId, ...oauthUserIds]) await prisma.user.delete({ where: { id: uid } }).catch(() => {});

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — self-service registration, login & OAuth identity (V1.50A/B)`);
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
