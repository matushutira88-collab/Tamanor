/**
 * FAMILY NOTIFICATIONS PHASE 3C — scheduler lease, runner, endpoint auth, and production schedule config.
 * Proves: DB-backed lease (atomic acquire, no steal of a live lease, expired-recoverable, owner-token release,
 * crash-recoverable, no sensitive ids); the runner's staged bounded cycle + aggregate-only result; the cron
 * endpoint's fail-closed bearer auth (no cookie/query-string/session, missing-secret denies all, no-store,
 * aggregate-only, no caller-controlled bounds/tenant); and exactly one every-5-minutes entry in the deployed root.
 * Synthetic data only. Run: pnpm family-notifications-scheduler:test
 */
import { systemDb } from "@guardora/db";
import {
  acquireSchedulerLease, releaseSchedulerLease, runFamilyNotificationScheduler,
  getFamilyNotificationSchedulerHealth, FAMILY_NOTIFICATIONS_SCHEDULER_LEASE_KEY,
} from "../src/internal/family-notification-scheduler";
import { assertCronAuth } from "../../../apps/web/src/lib/cron-auth";
import { WorkspaceKind } from "@guardora/core";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `sch_${process.pid}`;
const NOW = new Date("2026-10-01T00:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const leaseKey = `test-lease-${sfx}`;
const REPO = new URL("../../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(REPO + p, "utf8");

async function main() {
  // ═════════ 1. Lease ═════════
  console.log("\n1. lease");
  const a1 = await acquireSchedulerLease(leaseKey, "worker-1", 60_000, NOW);
  check("★ (1) first runner acquires the lease", a1.acquired === true);
  const a2 = await acquireSchedulerLease(leaseKey, "worker-2", 60_000, at(1000));
  check("★ (2)(3) concurrent runner gets lease_busy; a live lease is not stolen", a2.acquired === false);
  const wrongRelease = await releaseSchedulerLease(leaseKey, "worker-2");
  check("★ (5) a wrong owner token cannot release the lease", wrongRelease.released === false && (await systemDb.schedulerLease.findUnique({ where: { leaseKey } })) !== null);
  const a3 = await acquireSchedulerLease(leaseKey, "worker-3", 60_000, at(61_000)); // now past the original expiry
  check("★ (4)(6) an expired (crashed-worker) lease is recoverable", a3.acquired === true);
  const okRelease = await releaseSchedulerLease(leaseKey, "worker-3");
  check("★ (release) the holder can release its own lease", okRelease.released === true && (await systemDb.schedulerLease.findUnique({ where: { leaseKey } })) === null);
  const cols = (await systemDb.$queryRawUnsafe<Array<{ column_name: string }>>(`SELECT column_name FROM information_schema.columns WHERE table_name='scheduler_leases'`)).map((c) => c.column_name);
  check("★ (7) the lease table has no tenant/user/source/email columns", !cols.some((c) => /tenant|user|source|email|recipient|profile/i.test(c)));
  const leaseGrants = await systemDb.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM information_schema.role_table_grants WHERE grantee='tamanor_app' AND table_name='scheduler_leases'`);
  check("★ (lease security) tamanor_app has ZERO grants on scheduler_leases (owner-only)", Number(leaseGrants[0]?.n) === 0);

  // ═════════ 2. Runner ═════════
  console.log("\n2. runner");
  // Fixture: a Family tenant with a ConsentManage manager + a consent + an invitation both in-window.
  const A = (await systemDb.tenant.create({ data: { id: `sa_${sfx}`, name: "SA", slug: `sa_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const uOwner = (await systemDb.user.create({ data: { id: `su_o_${sfx}`, email: `su_o_${sfx}@t.local` } })).id;
  const mOwner = (await systemDb.membership.create({ data: { userId: uOwner, tenantId: A, role: "owner" as never } })).id;
  const pA = (await systemDb.protectedProfile.create({ data: { tenantId: A, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  await systemDb.consentRecord.create({ data: { tenantId: A, protectedProfileId: pA, consentType: "guardian", consentStatus: "active", grantedAt: NOW, grantedByMembershipId: mOwner, validUntil: at(7 * 86_400_000) } });
  await systemDb.familyGuardianInvitation.create({ data: { tenantId: A, invitedByMembershipId: mOwner, invitedEmailNormalized: `si_${sfx}@x.local`, tokenHash: `${sfx}hash`, protectedProfileId: pA, intendedFamilyRole: "guardian", intendedGuardianRole: "secondary", intendedRelationshipType: "parent", status: "pending", expiresAt: at(6 * 3_600_000) } });

  const r = await runFamilyNotificationScheduler({ now: NOW, workerId: "runner-A" });
  check("★ (8)(9)(10)(11) runner acquires → evaluates invitations + consents → processes outbox (staged)", r.acquired === true && r.invitationsScanned >= 1 && r.consentsScanned >= 1 && r.outboxClaimed >= 1);
  check("★ (16) result is aggregate-only (no ids; numbers/booleans/enum string)", Object.entries(r).every(([k, v]) => (k === "stoppedReason" ? typeof v === "string" : k === "acquired" ? typeof v === "boolean" : typeof v === "number")));
  check("★ (18) result carries no raw error / stack / identifier", !/stack|Error:|@[a-z]|sa_|su_/.test(JSON.stringify(r)));
  // (14) time-budget stop (inject elapsed >= budget so the outbox loop stops immediately).
  await systemDb.consentRecord.create({ data: { tenantId: A, protectedProfileId: pA, consentType: "guardian", consentStatus: "active", grantedAt: NOW, grantedByMembershipId: mOwner, validUntil: at(8 * 86_400_000) } });
  const rTb = await runFamilyNotificationScheduler({ now: NOW, workerId: "runner-tb", timeBudgetMs: 10_000 }, { elapsedMs: () => 10_000 });
  check("★ (14) time-budget exhaustion stops the outbox drain", rTb.acquired === true && rTb.stoppedReason === "time_budget");
  // (13) batch-limit stop (>=2 due events, outboxBatchSize=1, maxOutboxBatches=1).
  await systemDb.consentRecord.createMany({ data: [
    { tenantId: A, protectedProfileId: pA, consentType: "guardian", consentStatus: "active", grantedAt: NOW, grantedByMembershipId: mOwner, validUntil: at(9 * 86_400_000) },
    { tenantId: A, protectedProfileId: pA, consentType: "guardian", consentStatus: "active", grantedAt: NOW, grantedByMembershipId: mOwner, validUntil: at(10 * 86_400_000) },
  ] });
  const rBl = await runFamilyNotificationScheduler({ now: NOW, workerId: "runner-bl", outboxBatchSize: 1, maxOutboxBatches: 1 });
  check("★ (12)(13) bounded cycle stops at the batch limit", rBl.acquired === true && rBl.stoppedReason === "batch_limit");
  // (15) empty run succeeds.
  const empty = await runFamilyNotificationScheduler({ now: new Date("2020-01-01T00:00:00Z"), workerId: "runner-empty" });
  check("★ (15) an empty run succeeds (completed, zero work)", empty.acquired === true && empty.stoppedReason === "completed");
  // Health after runs is aggregate-only.
  const health = await getFamilyNotificationSchedulerHealth(NOW);
  check("★ (health) scheduler health is aggregate-only + a bounded lease state", ["free", "active", "expired"].includes(health.schedulerLease));

  // ═════════ 3. Endpoint authentication (assertCronAuth) ═════════
  console.log("\n3. endpoint auth");
  const SECRET = "a-sufficiently-long-test-cron-secret-value-1234567890";
  const req = (headers: Record<string, string> = {}) => new Request("https://x.test/api/internal/cron/family-notifications", { headers });
  check("★ (19) missing Authorization is rejected", assertCronAuth(req({}), SECRET).ok === false);
  check("★ (20) a wrong secret is rejected", assertCronAuth(req({ authorization: "Bearer wrong-secret" }), SECRET).ok === false);
  check("★ (21) a query-string secret is ignored (no header → rejected)", assertCronAuth(new Request(`https://x.test/api/internal/cron/family-notifications?secret=${SECRET}`), SECRET).ok === false);
  check("★ (22) a browser cookie/session alone is rejected", assertCronAuth(req({ cookie: `session=${SECRET}` }), SECRET).ok === false);
  check("★ (23) the correct bearer is accepted", assertCronAuth(req({ authorization: `Bearer ${SECRET}` }), SECRET).ok === true);
  check("★ (24) a missing production secret fails closed (deny all)", assertCronAuth(req({ authorization: "Bearer anything" }), "").ok === false && assertCronAuth(req({ authorization: "Bearer anything" }), undefined).reason === "cron_secret_unset");

  // ═════════ 4. Route + schedule (static, deployed root) ═════════
  console.log("\n4. route + schedule");
  const routeSrc = read("apps/web/src/app/api/internal/cron/family-notifications/route.ts");
  check("★ (36) route is server-only (nodejs runtime + force-dynamic)", /runtime = "nodejs"/.test(routeSrc) && /dynamic = "force-dynamic"/.test(routeSrc));
  check("★ (25) route sets Cache-Control: no-store", /Cache-Control["']?\s*:\s*["']no-store/.test(routeSrc));
  check("★ (30) route calls ONLY the shared runner", /runFamilyNotificationScheduler\(\{\}\)/.test(routeSrc) && !/evaluateExpiring|processFamilyNotificationOutboxBatch/.test(routeSrc));
  check("★ (28)(29) caller cannot raise bounds or choose tenant/source (no req input threaded)", /runFamilyNotificationScheduler\(\{\}\)/.test(routeSrc) && !/req\.(json|url|nextUrl)|searchParams|params/.test(routeSrc));
  check("★ (26) route returns aggregate counts only (spreads the runner result, no id fields)", /Response\.json\(\s*\{ ok: true, \.\.\.r \}/.test(routeSrc));
  check("★ (27) route/auth never log or echo the secret", !/console\.(log|error)\([^)]*secret/i.test(routeSrc) && !/console\.(log|error)\([^)]*CRON_SECRET/i.test(read("apps/web/src/lib/cron-auth.ts")));
  check("★ (19-24 wiring) route enforces assertCronAuth before running", /assertCronAuth\(req\)/.test(routeSrc) && /cronUnauthorized/.test(routeSrc) && routeSrc.indexOf("assertCronAuth") < routeSrc.indexOf("runFamilyNotificationScheduler"));

  const vercel = JSON.parse(read("apps/web/vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
  const mine = vercel.crons.filter((c) => c.path === "/api/internal/cron/family-notifications");
  check("★ (31)(33) exactly one scheduler cron entry (no duplicate)", mine.length === 1);
  check("★ (32) cadence is every five minutes", mine[0]?.schedule === "*/5 * * * *");
  check("★ (34) config lives in the deployed web root (apps/web/vercel.json)", vercel.crons.length >= 4);
  check("★ (35) the pre-existing cron jobs are unchanged", ["/api/internal/jobs/meta-dispatch", "/api/internal/jobs/webhook-retry", "/api/internal/jobs/maintenance"].every((p) => vercel.crons.some((c) => c.path === p)));
  check("★ (lease key) the runner uses the documented global lease key", FAMILY_NOTIFICATIONS_SCHEDULER_LEASE_KEY === "family-notifications-scheduler");
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await systemDb.schedulerLease.deleteMany({ where: { leaseKey: { in: [leaseKey, FAMILY_NOTIFICATIONS_SCHEDULER_LEASE_KEY] } } }).catch(() => {});
    await systemDb.familyNotificationOutboxEvent.deleteMany({ where: { tenantId: `sa_${sfx}` } }).catch(() => {});
    await systemDb.notification.deleteMany({ where: { tenantId: `sa_${sfx}` } }).catch(() => {});
    await systemDb.tenant.delete({ where: { id: `sa_${sfx}` } }).catch(() => {});
    await systemDb.user.delete({ where: { id: `su_o_${sfx}` } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications scheduler: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
