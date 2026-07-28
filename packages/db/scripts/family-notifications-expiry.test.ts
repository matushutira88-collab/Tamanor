/**
 * FAMILY NOTIFICATIONS PHASE 3C — deterministic expiry evaluators + processing (local DB, end-to-end).
 *
 * Proves the final two triggers (invitation-expiring 24h, consent-expiring 14d): deterministic eligibility at the
 * exact boundary, one event per (source, expiry version), stale-expiry → not_applicable, current-authorization
 * recipients, evaluator determinism/bounds/ordering, no source mutation, and no authorization_pending for expiry.
 * Synthetic data only. Run: pnpm family-notifications-expiry:test
 */
import { systemDb, withTenant, type FamilyNotificationSchedulerHealth } from "@guardora/db";
import { evaluateExpiringGuardianInvitations, evaluateExpiringConsents } from "../src/internal/family-notification-expiry";
import { processFamilyNotificationOutboxBatch } from "../src/internal/family-notification-outbox-processor";
import { getFamilyNotificationSchedulerHealth } from "../src/internal/family-notification-scheduler";
import { enqueueFamilyNotificationOutboxEventTx, OUTBOX_TYPE_SOURCE, CRITICAL_OUTBOX_TYPES, INVITATION_WARNING_WINDOW_MS, CONSENT_WARNING_WINDOW_MS, invitationExpiringEventVersion, consentExpiringEventVersion } from "../src/internal/family-notification-outbox";
import { WorkspaceKind, GuardianRelationshipType, GuardianAuthorityLevel } from "@guardora/core";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `exp_${process.pid}`;
let tk = 0;
const th = () => createHash("sha256").update(`tok_${sfx}_${tk++}`).digest("hex");
const NOW = new Date("2026-09-01T00:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const HOUR = 3_600_000, DAY = 86_400_000;

const evInv = (tenantId: string, id: string) => systemDb.familyNotificationOutboxEvent.findMany({ where: { tenantId, notificationType: "family_guardian_invitation_expiring" as never, sourceId: id } });
const evCon = (tenantId: string, id: string) => systemDb.familyNotificationOutboxEvent.findMany({ where: { tenantId, notificationType: "family_consent_expiring" as never, sourceId: id } });

async function main() {
  const A = (await systemDb.tenant.create({ data: { id: `xa_${sfx}`, name: "XA", slug: `xa_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const B = (await systemDb.tenant.create({ data: { id: `xb_${sfx}`, name: "XB", slug: `xb_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const uOwner = (await systemDb.user.create({ data: { id: `xu_o_${sfx}`, email: `xu_o_${sfx}@t.local` } })).id;
  const uGuard = (await systemDb.user.create({ data: { id: `xu_g_${sfx}`, email: `xu_g_${sfx}@t.local` } })).id;
  const uView = (await systemDb.user.create({ data: { id: `xu_v_${sfx}`, email: `xu_v_${sfx}@t.local` } })).id;
  const mOwner = (await systemDb.membership.create({ data: { userId: uOwner, tenantId: A, role: "owner" as never } })).id;
  const mGuard = (await systemDb.membership.create({ data: { userId: uGuard, tenantId: A, role: "admin" as never } })).id;
  await systemDb.membership.create({ data: { userId: uView, tenantId: A, role: "viewer" as never } });
  const pA = (await systemDb.protectedProfile.create({ data: { tenantId: A, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const relA = (await systemDb.guardianRelationship.create({ data: { tenantId: A, guardianMembershipId: mGuard, protectedProfileId: pA, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "secondary", status: "verified" } })).id;

  // fgi_terminal_ts_consistent: an accepted/declined/revoked invitation MUST carry its terminal timestamp.
  const mkInvite = (expiresAt: Date, status = "pending", tenantId = A) => systemDb.familyGuardianInvitation.create({ data: { tenantId, invitedByMembershipId: mGuard, invitedEmailNormalized: `inv_${tk}_${sfx}@x.local`, tokenHash: th(), protectedProfileId: pA, intendedFamilyRole: "guardian", intendedGuardianRole: "secondary", intendedRelationshipType: "parent", status, expiresAt, ...(status === "accepted" ? { acceptedAt: NOW, acceptedByUserId: uGuard } : {}), ...(status === "declined" ? { declinedAt: NOW } : {}), ...(status === "revoked" ? { revokedAt: NOW } : {}) } }).then((r) => r.id);
  const mkConsent = (validUntil: Date | null, consentStatus = "active", tenantId = A) => systemDb.consentRecord.create({ data: { tenantId, protectedProfileId: pA, consentType: "guardian", consentStatus, grantedAt: NOW, grantedByMembershipId: mOwner, validUntil, revokedAt: consentStatus === "withdrawn" ? NOW : null } }).then((r) => r.id);
  const notifOf = (userId: string, type: string, sourceId: string) => systemDb.notification.count({ where: { tenantId: A, userId, type: type as never, metadata: { path: ["entityId"], equals: sourceId } } });

  // ═════════ 1. Type map ═════════
  console.log("\n1. type map");
  const types = Object.keys(OUTBOX_TYPE_SOURCE);
  check("★ (1) exactly 13 outbox types", types.length === 13);
  check("★ (2) both expiry types present + mapped once", types.includes("family_guardian_invitation_expiring") && types.includes("family_consent_expiring"));
  check("★ (3) invitation-expiring maps only to family_guardian_invitation / invitationId", (OUTBOX_TYPE_SOURCE as Record<string, { sourceType: string; idKey: string }>).family_guardian_invitation_expiring.sourceType === "family_guardian_invitation" && (OUTBOX_TYPE_SOURCE as Record<string, { idKey: string }>).family_guardian_invitation_expiring.idKey === "invitationId");
  check("★ (4) consent-expiring maps only to consent_record / consentRecordId", (OUTBOX_TYPE_SOURCE as Record<string, { sourceType: string; idKey: string }>).family_consent_expiring.sourceType === "consent_record" && (OUTBOX_TYPE_SOURCE as Record<string, { idKey: string }>).family_consent_expiring.idKey === "consentRecordId");
  check("★ (64) expiry types are NOT critical readiness types", !CRITICAL_OUTBOX_TYPES.has("family_guardian_invitation_expiring") && !CRITICAL_OUTBOX_TYPES.has("family_consent_expiring"));
  check("★ (window constants) 24h invitation / 14d consent", INVITATION_WARNING_WINDOW_MS === 24 * HOUR && CONSENT_WARNING_WINDOW_MS === 14 * DAY);

  // ═════════ 2. Invitation eligibility (evaluator, deterministic now) ═════════
  console.log("\n2. invitation eligibility");
  const invBoundary = await mkInvite(at(INVITATION_WARNING_WINDOW_MS)); // expiresAt exactly now+24h → eligible (<=)
  const invInside = await mkInvite(at(12 * HOUR));                       // 12h out → eligible
  const invOutside = await mkInvite(at(25 * HOUR));                      // 25h out → ineligible (> window)
  const invExpired = await mkInvite(at(-1 * HOUR), "pending");           // already past → ineligible (expiresAt <= now)
  const invAccepted = await mkInvite(at(6 * HOUR), "accepted");          // accepted → ineligible
  const invRevoked = await mkInvite(at(6 * HOUR), "revoked");            // revoked → ineligible
  const invDeclined = await mkInvite(at(6 * HOUR), "declined");          // declined/cancelled → ineligible
  const r1 = await evaluateExpiringGuardianInvitations({ now: NOW });
  check("★ (8) exact 24h boundary is eligible (one event)", (await evInv(A, invBoundary)).length === 1);
  check("★ (9) just inside the window is eligible", (await evInv(A, invInside)).length === 1);
  check("★ (10) just outside the window is ineligible", (await evInv(A, invOutside)).length === 0);
  check("★ (11) already-expired is ineligible", (await evInv(A, invExpired)).length === 0);
  check("★ (12)(13)(14) accepted/revoked/declined are ineligible", (await evInv(A, invAccepted)).length === 0 && (await evInv(A, invRevoked)).length === 0 && (await evInv(A, invDeclined)).length === 0);
  check("★ (16) eventVersion encodes the canonical expiry", (await evInv(A, invInside))[0]!.eventVersion === invitationExpiringEventVersion(at(12 * HOUR).getTime()));
  // (17) repeated evaluation → one event; (18) concurrent evaluation → one event.
  await evaluateExpiringGuardianInvitations({ now: NOW });
  check("★ (17) repeated evaluation creates one event", (await evInv(A, invInside)).length === 1);
  await Promise.all([evaluateExpiringGuardianInvitations({ now: NOW }), evaluateExpiringGuardianInvitations({ now: NOW })]);
  check("★ (18) concurrent evaluation creates one event", (await evInv(A, invInside)).length === 1);
  // (19)(20) extension → new version; the row now has TWO events (old + new); stale handling proven in section 4.
  await systemDb.familyGuardianInvitation.update({ where: { id: invInside }, data: { expiresAt: at(20 * HOUR) } });
  await evaluateExpiringGuardianInvitations({ now: NOW });
  check("★ (19) an extended expiry creates a NEW eventVersion (2 events for the invitation)", (await evInv(A, invInside)).length === 2);
  // (21) token/email never in outbox.
  check("★ (21) invitation outbox event stores no token/email/message", (await evInv(A, invBoundary)).every((e) => Object.keys(e).every((k) => !/token|email|message|invitedEmail|content/i.test(k))));
  // (54) evaluator did not mutate the source (no warningSentAt).
  const invBoundaryRow = await systemDb.familyGuardianInvitation.findUnique({ where: { id: invBoundary }, select: { updatedAt: true } });
  await evaluateExpiringGuardianInvitations({ now: NOW });
  check("★ (54) evaluator does not mutate the source record", (await systemDb.familyGuardianInvitation.findUnique({ where: { id: invBoundary }, select: { updatedAt: true } }))!.updatedAt.getTime() === invBoundaryRow!.updatedAt.getTime());

  // ═════════ 3. Consent eligibility ═════════
  console.log("\n3. consent eligibility");
  const conBoundary = await mkConsent(at(CONSENT_WARNING_WINDOW_MS));  // exactly now+14d → eligible
  const conInside = await mkConsent(at(7 * DAY));                       // 7d out → eligible
  const conOutside = await mkConsent(at(15 * DAY));                     // 15d out → ineligible
  const conExpired = await mkConsent(at(-1 * DAY));                     // past → ineligible
  const conRevoked = await mkConsent(at(5 * DAY), "withdrawn");         // revoked → ineligible
  const conPending = await mkConsent(at(5 * DAY), "pending");           // pending → ineligible
  const conSuspended = await mkConsent(at(5 * DAY), "suspended");       // suspended (not active) → ineligible
  const conIndef = await mkConsent(null);                              // indefinite (no expiry) → ineligible
  await evaluateExpiringConsents({ now: NOW });
  check("★ (22) exact 14-day boundary is eligible", (await evCon(A, conBoundary)).length === 1);
  check("★ (23) just inside is eligible", (await evCon(A, conInside)).length === 1);
  check("★ (24) just outside is ineligible", (await evCon(A, conOutside)).length === 0);
  check("★ (25) expired is ineligible", (await evCon(A, conExpired)).length === 0);
  check("★ (26)(27)(28)(29) revoked/superseded(suspended)/rejected(pending)/pending ineligible", (await evCon(A, conRevoked)).length === 0 && (await evCon(A, conSuspended)).length === 0 && (await evCon(A, conPending)).length === 0);
  check("★ (30) indefinite (no expiry) is ineligible", (await evCon(A, conIndef)).length === 0);
  check("★ (consent eventVersion) encodes validUntil", (await evCon(A, conInside))[0]!.eventVersion === consentExpiringEventVersion(at(7 * DAY).getTime()));
  await evaluateExpiringConsents({ now: NOW });
  check("★ (31) repeated evaluation → one event", (await evCon(A, conInside)).length === 1);
  await Promise.all([evaluateExpiringConsents({ now: NOW }), evaluateExpiringConsents({ now: NOW })]);
  check("★ (32) concurrent evaluation → one event", (await evCon(A, conInside)).length === 1);
  check("★ (36) consent outbox event stores no scopes/notes/evidence/reason", (await evCon(A, conBoundary)).every((e) => Object.keys(e).every((k) => !/scope|note|evidence|reason(?!Code)|content/i.test(k))));
  // (35) renewed consent = a NEW record → distinct event/sourceId.
  const conRenewed = await mkConsent(at(10 * DAY));
  await evaluateExpiringConsents({ now: NOW });
  check("★ (35) a renewed consent (new record) creates a distinct event", (await evCon(A, conRenewed)).length === 1 && conRenewed !== conInside);

  // ═════════ 4. Authorization + stale (processing) ═════════
  console.log("\n4. authorization + stale (processing)");
  const drainAt = (now: Date) => (async () => { for (let i = 0; i < 20; i++) { const r = await processFamilyNotificationOutboxBatch({ batchSize: 200, now }); if (r.claimed === 0) break; } })();
  await drainAt(NOW);
  // (37)(38)(39) invitation warning → inviter (uGuard) + FamilyInvitationView managers (uOwner); overlap deduped.
  check("★ (37)(38) active inviter + current managers receive the invitation warning", (await notifOf(uGuard, "family_guardian_invitation_expiring", invBoundary)) === 1 && (await notifOf(uOwner, "family_guardian_invitation_expiring", invBoundary)) === 1);
  check("★ (39)(46)(47) overlap → one row each; viewer (no manager cap) receives none", (await notifOf(uView, "family_guardian_invitation_expiring", invBoundary)) === 0);
  // (42)(43) consent warning → ConsentManage managers (uOwner); viewer none.
  check("★ (42)(43) consent warning → ConsentManage managers (owner), viewer none", (await notifOf(uOwner, "family_consent_expiring", conBoundary)) === 1 && (await notifOf(uView, "family_consent_expiring", conBoundary)) === 0);
  // (20)/(34) STALE: the invitation's OLD (pre-extension) event now mismatches the current expiry → not_applicable.
  const invInsideEvents = await evInv(A, invInside);
  const staleEv = invInsideEvents.find((e) => e.eventVersion === invitationExpiringEventVersion(at(12 * HOUR).getTime()))!;
  const staleRow = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { id: staleEv.id }, select: { status: true, safeReasonCode: true } });
  check("★ (20)(34) a stale (extended-past) expiry event → completed not_applicable, no notification", staleRow?.status === "completed" && staleRow?.safeReasonCode === "not_applicable" && (await notifOf(uGuard, "family_guardian_invitation_expiring", invInside)) === 1);
  // (41) accepted-before-processing → none: enqueue then accept, then process.
  const invLate = await mkInvite(at(6 * HOUR));
  await evaluateExpiringGuardianInvitations({ now: NOW });
  await systemDb.familyGuardianInvitation.update({ where: { id: invLate }, data: { status: "accepted", acceptedAt: NOW } });
  await drainAt(NOW);
  check("★ (41) invitation accepted before processing → no warning notification", (await notifOf(uGuard, "family_guardian_invitation_expiring", invLate)) === 0 && (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: invLate, notificationType: "family_guardian_invitation_expiring" as never } }))?.safeReasonCode === "not_applicable");
  // (45) consent revoked before processing → none.
  const conLate = await mkConsent(at(5 * DAY));
  await evaluateExpiringConsents({ now: NOW });
  await systemDb.consentRecord.update({ where: { id: conLate }, data: { consentStatus: "withdrawn", revokedAt: NOW } });
  await drainAt(NOW);
  check("★ (45) consent revoked before processing → no warning; event not_applicable", (await notifOf(uOwner, "family_consent_expiring", conLate)) === 0 && (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: conLate, notificationType: "family_consent_expiring" as never } }))?.safeReasonCode === "not_applicable");

  // ═════════ 5. Evaluator determinism / bounds / ordering ═════════
  console.log("\n5. evaluator determinism / bounds / ordering");
  const r49 = await evaluateExpiringConsents({ now: NOW });
  check("★ (49)(53) explicit now → deterministic aggregate-only result", typeof r49.scanned === "number" && Object.values(r49).every((v) => typeof v === "number"));
  const r50 = await evaluateExpiringConsents({ now: NOW, batchSize: 1 });
  check("★ (50) bounded batch size (batchSize=1 scans ≤1)", r50.scanned <= 1);
  const r50b = await evaluateExpiringConsents({ now: NOW, batchSize: 99999 });
  check("★ (50b) batch is hard-capped (huge request does not scan unbounded)", r50b.scanned <= 500);
  // (55) wrong-tenant: a tenant-scoped (tamanor_app) enqueue with a mismatched tenant is RLS-rejected.
  let xThrew = false; try { await withTenant(A, (tx) => enqueueFamilyNotificationOutboxEventTx(tx, { tenantId: B, notificationType: "family_consent_expiring", source: { consentRecordId: conInside }, eventVersion: consentExpiringEventVersion(NOW.getTime()), occurredAt: NOW })); } catch { xThrew = true; }
  check("★ (55) cross-tenant enqueue rejected (RLS)", xThrew);
  check("★ (56) evaluator uses narrow projections (event carries only bounded routing columns)", (await evCon(A, conBoundary))[0] !== undefined && Object.keys((await evCon(A, conBoundary))[0]!).every((k) => !/scope|note|email|token|content|narrative/i.test(k)));

  // ═════════ 6. Processor ═════════
  console.log("\n6. processor");
  // (57) both types use createAuthorizedFamilyNotification — proven by delivery above (owner/guard received rows).
  check("★ (57) both expiry types delivered via the authorized path (rows exist)", (await notifOf(uGuard, "family_guardian_invitation_expiring", invBoundary)) >= 1 && (await notifOf(uOwner, "family_consent_expiring", conBoundary)) >= 1);
  // (58) crash-window reprocessing → no duplicate.
  const conCrashEv = (await evCon(A, conBoundary))[0]!;
  const beforeCrash = await notifOf(uOwner, "family_consent_expiring", conBoundary);
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: conCrashEv.id }, data: { status: "processing", lockExpiresAt: at(-60_000) } });
  await drainAt(NOW);
  check("★ (58)(59)(60) crash/lease-expiry reprocessing → no duplicate; completed not reclaimed", (await notifOf(uOwner, "family_consent_expiring", conBoundary)) === beforeCrash && (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { id: conCrashEv.id } }))?.status === "completed");
  // (62) malformed expiry event dead-letters.
  await systemDb.familyNotificationOutboxEvent.create({ data: { tenantId: A, notificationType: "family_consent_expiring" as never, sourceType: "safety_signal", sourceId: `bad_${sfx}`, eventVersion: "b1", dedupeKey: `${sfx}_badexp`, occurredAt: NOW, nextAttemptAt: at(-1000), updatedAt: NOW } });
  await drainAt(NOW);
  const badExp = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: `bad_${sfx}` } });
  check("★ (62)(63) malformed expiry event → dead_letter, bounded code (no raw text)", badExp?.status === "dead_letter" && badExp?.lastErrorCode === "malformed_event");
  // (64) no authorization_pending for expiry: a no-recipient expiry event completes (never pending).
  check("★ (64) expiry events never enter authorization_pending", (await systemDb.familyNotificationOutboxEvent.count({ where: { tenantId: A, notificationType: { in: ["family_guardian_invitation_expiring", "family_consent_expiring"] as never }, lastErrorCode: "authorization_pending" } })) === 0);

  // ═════════ 7. Health ═════════
  console.log("\n7. health");
  const health: FamilyNotificationSchedulerHealth = await getFamilyNotificationSchedulerHealth(NOW);
  check("★ (health) aggregate-only, includes warning-window counts + lease state (no ids)", typeof health.invitationsInWindow === "number" && typeof health.consentsInWindow === "number" && ["free", "active", "expired"].includes(health.schedulerLease) && Object.values(health).every((v) => typeof v === "number" || typeof v === "string"));
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    for (const t of [`xa_${sfx}`, `xb_${sfx}`]) {
      await systemDb.familyNotificationOutboxEvent.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.notification.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.familyGuardianInvitation.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.consentRecord.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.tenant.delete({ where: { id: t } }).catch(() => {});
    }
    for (const u of [`xu_o_${sfx}`, `xu_g_${sfx}`, `xu_v_${sfx}`]) await systemDb.user.delete({ where: { id: u } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications expiry: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
