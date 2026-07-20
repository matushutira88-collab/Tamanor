/**
 * V1.66 — PER-USER onboarding state, derived checklist and state-machine safety.
 * Run via: pnpm onboarding:test
 *
 * Covers the pure logic (checklist derivation, progress, transitions, ack sanitisation) AND the
 * tenant+user-scoped persistence, including the guarantee that one member can never read or mutate
 * another member's onboarding state.
 */
import { randomBytes } from "node:crypto";
import {
  systemDb, registerUser, hashPassword, withTenant,
  getOnboardingState, applyOnboardingAction, acknowledgeOnboarding, maybeAutoComplete,
  buildChecklist, summarize, canTransition, sanitizeAcks, shouldShowOnboarding,
  OnboardingTransitionError, ONBOARDING_STEPS, REQUIRED_STEPS,
  type DerivedFacts,
} from "@guardora/db";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
async function throws<T>(fn: () => Promise<T>, kind: new (...a: never[]) => Error): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return e instanceof kind; }
}
const NO_FACTS: DerivedFacts = {
  hasWorkspace: true, hasConnectedAccount: false, hasProtectedBrand: false,
  hasMonitoringEnabled: false, hasFirstSync: false, hasFirstReview: false,
};

async function run() {
  const sfx = randomBytes(5).toString("hex");
  const startedAt = new Date();

  // ---- PURE: checklist derivation & progress -------------------------------------------------
  {
    const empty = buildChecklist(NO_FACTS);
    check("9a) checklist has the 6 ordered steps", empty.length === 6 && empty.map((c) => c.key).join(",") === ONBOARDING_STEPS.join(","));
    const s0 = summarize(empty);
    check("checklist at 0%: only 'workspace' done, next = connect_account", s0.completedCount === 1 && s0.progressPct === 17 && s0.nextStep === "connect_account");
    check("canFinish false while required steps are pending", s0.canFinish === false);

    const all = buildChecklist({ hasWorkspace: true, hasConnectedAccount: true, hasProtectedBrand: true, hasMonitoringEnabled: true, hasFirstSync: true, hasFirstReview: true });
    const s1 = summarize(all);
    check("fully derived checklist → 100%, no next step, canFinish", s1.completedCount === 6 && s1.progressPct === 100 && s1.nextStep === null && s1.canFinish === true);

    const required = summarize(buildChecklist({ ...NO_FACTS, hasConnectedAccount: true, hasMonitoringEnabled: true }));
    check("canFinish true once ONLY the required steps are done (sync/review never block)", required.canFinish === true && required.nextStep === "protect_brand" && REQUIRED_STEPS.length === 3);
  }

  // ---- PURE: state machine ------------------------------------------------------------------
  check("12) invalid transition completed→in_progress is rejected", canTransition("completed", "in_progress") === false);
  check("7) completed never reopens by itself (only restart→not_started allowed)", canTransition("completed", "not_started") === true && canTransition("completed", "dismissed") === false);
  check("dismissed is resumable", canTransition("dismissed", "in_progress") === true);
  check("shouldShow hides completed and dismissed", shouldShowOnboarding("not_started") && shouldShowOnboarding("in_progress") && !shouldShowOnboarding("completed") && !shouldShowOnboarding("dismissed"));

  // ---- PURE: acknowledgement sanitisation (no PII / arbitrary JSON) --------------------------
  {
    const dirty = sanitizeAcks({ welcome_seen: true, email: "a@b.c", token: "secret", note: "private message", finish_ack: "yes" });
    check("G) ack JSON keeps ONLY allow-listed booleans (email/token/note dropped)", JSON.stringify(dirty) === JSON.stringify({ welcome_seen: true }));
    check("ack sanitiser is null/array safe", JSON.stringify(sanitizeAcks(null)) === "{}" && JSON.stringify(sanitizeAcks([1, 2])) === "{}");
  }

  // ---- Fixtures: tenant A with TWO members, tenant B with one -------------------------------
  const a = await registerUser({ email: `onb-a-${sfx}@ex.com`, passwordHash: await hashPassword("password a 1"), workspaceName: "Onb A", country: "SK" });
  const b = await registerUser({ email: `onb-b-${sfx}@ex.com`, passwordHash: await hashPassword("password b 1"), workspaceName: "Onb B", country: "SK" });
  // A second member inside tenant A (the per-user isolation subject).
  const second = await registerUser({ email: `onb-a2-${sfx}@ex.com`, passwordHash: await hashPassword("password a2 1"), workspaceName: "Onb A2", country: "SK" });
  await systemDb.membership.create({ data: { userId: second.userId, tenantId: a.tenantId, role: "analyst" } });

  // ---- 1) a brand-new membership starts at not_started ---------------------------------------
  const s1 = await getOnboardingState(a.tenantId, a.userId);
  check("1) new user's membership starts at not_started", s1?.status === "not_started", String(s1?.status));
  check("1) new member sees the onboarding surface", s1?.shouldShow === true);
  check("new member's derived checklist reflects an empty workspace", s1?.completedCount === 1 && s1?.nextStep === "connect_account");

  // ---- 2) the MIGRATION BACKFILL RULE gives existing members a safe, non-blocking default -------
  // Exercised as the migration itself does it: take rows still at the `not_started` default and derive
  // the status from the legacy tenant flag. Scoped to this test's own tenants so it is deterministic and
  // repeatable (a global scan would be wrong — brand-new memberships are legitimately `not_started`).
  {
    const finishedTenant = b.tenantId;   // pretend this workspace had already completed onboarding
    const unfinishedTenant = second.tenantId;
    await systemDb.tenant.update({ where: { id: finishedTenant }, data: { onboardingCompletedAt: new Date("2026-01-15T10:00:00Z") } });
    await systemDb.tenant.update({ where: { id: unfinishedTenant }, data: { onboardingCompletedAt: null } });
    await systemDb.membership.updateMany({ where: { tenantId: { in: [finishedTenant, unfinishedTenant] } }, data: { onboardingStatus: "not_started", onboardingCompletedAt: null, onboardingDismissedAt: null } });

    // The exact backfill statement from 20260728090000_v1_66_membership_onboarding, scoped to the fixtures.
    await systemDb.$executeRawUnsafe(
      `UPDATE "memberships" m SET
         "onboardingStatus"      = CASE WHEN t."onboardingCompletedAt" IS NOT NULL THEN 'completed'::"OnboardingStatus" ELSE 'dismissed'::"OnboardingStatus" END,
         "onboardingCompletedAt" = t."onboardingCompletedAt",
         "onboardingDismissedAt" = CASE WHEN t."onboardingCompletedAt" IS NULL THEN NOW() ELSE NULL END
       FROM "tenants" t
       WHERE m."tenantId" = t.id AND m."onboardingStatus" = 'not_started' AND m."tenantId" IN ($1, $2)`,
      finishedTenant, unfinishedTenant,
    );

    const done = await systemDb.membership.findFirst({ where: { tenantId: finishedTenant }, select: { onboardingStatus: true, onboardingCompletedAt: true } });
    const never = await systemDb.membership.findFirst({ where: { tenantId: unfinishedTenant }, select: { onboardingStatus: true, onboardingDismissedAt: true } });
    check("2) workspace that HAD finished onboarding → member migrated to completed", done?.onboardingStatus === "completed" && done?.onboardingCompletedAt !== null, String(done?.onboardingStatus));
    check("2) workspace that never finished → member migrated to dismissed (resumable, not blocked)", never?.onboardingStatus === "dismissed" && never?.onboardingDismissedAt !== null, String(never?.onboardingStatus));
    check("2) neither migrated state hides the product behind onboarding", !shouldShowOnboarding("completed") && !shouldShowOnboarding("dismissed"));
    // Restore the fixture used later for per-user isolation checks.
    await systemDb.membership.updateMany({ where: { tenantId: a.tenantId, userId: second.userId }, data: { onboardingStatus: "not_started", onboardingDismissedAt: null } });
  }

  // ---- 3+4) state is PER-MEMBER: acting as A must not touch the second member ------------------
  await applyOnboardingAction(a.tenantId, a.userId, "start", "connect_account");
  const other = await getOnboardingState(a.tenantId, second.userId);
  check("3) two members of the SAME tenant hold independent state", other?.status === "not_started", String(other?.status));
  check("4) one member's action did not mutate the other member's row", other?.startedAt === null && other?.step === null);

  // ---- 5) progress persists (re-read, no session coupling) ------------------------------------
  const reread = await getOnboardingState(a.tenantId, a.userId);
  check("5) progress persists across reads/sessions", reread?.status === "in_progress" && reread?.step === "connect_account" && reread?.startedAt !== null);

  // ---- 6) dismiss → resume ---------------------------------------------------------------------
  const dismissed = await applyOnboardingAction(a.tenantId, a.userId, "dismiss");
  check("6) dismiss stores the timestamp and hides the surface", dismissed?.status === "dismissed" && dismissed?.dismissedAt !== null && dismissed?.shouldShow === false);
  const resumed = await applyOnboardingAction(a.tenantId, a.userId, "resume");
  check("6) resume brings it back to in_progress and shows again", resumed?.status === "in_progress" && resumed?.shouldShow === true);

  // ---- 9/10/11) checklist derives from REAL system state, never from clicks --------------------
  const brandA = await withTenant(a.tenantId, (db) => db.brand.findFirst({ where: { tenantId: a.tenantId }, select: { id: true } }));
  check("fixture: tenant A has a brand", !!brandA);
  const acct = await systemDb.connectedAccount.create({
    data: { tenantId: a.tenantId, brandId: brandA!.id, platform: "facebook_page" as never, status: "active", mode: "read_only", externalId: `ext-${sfx}`, monitoringEnabled: false },
  });
  const afterConnect = await getOnboardingState(a.tenantId, a.userId);
  check("9) connect_account step derives from a REAL connected account", afterConnect?.checklist.find((c) => c.key === "connect_account")?.done === true);
  check("9) protect_brand derives from a brand that actually has an account", afterConnect?.checklist.find((c) => c.key === "protect_brand")?.done === true);
  check("10) enable_monitoring is still FALSE while monitoringEnabled=false", afterConnect?.checklist.find((c) => c.key === "enable_monitoring")?.done === false);
  check("11) first_sync is still FALSE with no successful sync", afterConnect?.checklist.find((c) => c.key === "first_sync")?.done === false);

  await systemDb.connectedAccount.update({ where: { id: acct.id }, data: { monitoringEnabled: true } });
  const afterMonitor = await getOnboardingState(a.tenantId, a.userId);
  check("10) enable_monitoring flips ONLY when real monitoring state changes", afterMonitor?.checklist.find((c) => c.key === "enable_monitoring")?.done === true);

  await systemDb.connectedAccount.update({ where: { id: acct.id }, data: { lastSuccessfulSyncAt: new Date() } });
  const afterSync = await getOnboardingState(a.tenantId, a.userId);
  check("11) first_sync derives from lastSuccessfulSyncAt", afterSync?.checklist.find((c) => c.key === "first_sync")?.done === true);
  check("first_review remains FALSE with no real moderation activity", afterSync?.checklist.find((c) => c.key === "first_review")?.done === false);

  // ---- auto-complete once every REQUIRED step is satisfied -------------------------------------
  {
    const completed = await maybeAutoComplete(a.tenantId, a.userId);
    const st = await getOnboardingState(a.tenantId, a.userId);
    check("D) auto-completes when all REQUIRED steps are done", completed === true && st?.status === "completed" && st?.completedAt !== null);
    check("7) a completed onboarding does not reopen automatically", st?.shouldShow === false && (await maybeAutoComplete(a.tenantId, a.userId)) === false);
  }

  // ---- 12) invalid transition is rejected server-side ------------------------------------------
  check("12) resume on a COMPLETED onboarding throws OnboardingTransitionError",
    await throws(() => applyOnboardingAction(a.tenantId, a.userId, "resume"), OnboardingTransitionError));

  // ---- 8) restart affects ONLY the current user -------------------------------------------------
  {
    const before = await getOnboardingState(a.tenantId, second.userId);
    const restarted = await applyOnboardingAction(a.tenantId, a.userId, "restart");
    const after = await getOnboardingState(a.tenantId, second.userId);
    check("8) restart resets the current user and bumps the version", restarted?.status === "not_started" && restarted?.version === 2 && restarted?.completedAt === null);
    check("8) restart did NOT touch the other member of the same tenant", after?.status === before?.status && after?.version === before?.version);
  }

  // ---- acknowledgements ---------------------------------------------------------------------------
  {
    const ack = await acknowledgeOnboarding(a.tenantId, a.userId, "welcome_seen");
    check("manual acknowledgement persists under the allow-listed key", ack?.acknowledgements.welcome_seen === true);
  }

  // ---- cross-tenant isolation ---------------------------------------------------------------------
  {
    const foreign = await getOnboardingState(b.tenantId, a.userId);
    check("G) a user with no membership in tenant B gets NO state there", foreign === null);
    const noop = await applyOnboardingAction(b.tenantId, a.userId, "start");
    check("G) acting on a tenant you are not a member of is a no-op (null)", noop === null);
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — per-user onboarding state & derived checklist (V1.66)`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
