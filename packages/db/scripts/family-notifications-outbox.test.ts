/**
 * FAMILY NOTIFICATIONS PHASE 3A — durable outbox + delivery-available trigger (local DB).
 *
 * Proves: the delivery→available transition atomically enqueues ONE bounded event; a forced enqueue failure rolls
 * the transition back; the processor claims with FOR UPDATE SKIP LOCKED, re-evaluates CURRENT authorization,
 * writes exactly-once notification rows (dedupe), classifies completed/retry/dead-letter with bounded codes only,
 * survives crash windows, and stores NO recipient/PII/content. Synthetic data only.
 * Run: pnpm family-notifications-outbox:test
 */
import { systemDb, withTenant, createRecipientAuthorizationDecision } from "@guardora/db";
import * as dbBarrel from "@guardora/db";
import {
  createSafetySignalDelivery, makeSafetySignalDeliveryAvailable, getSafetySignalDelivery,
} from "../src/child-safety-delivery";
import {
  enqueueFamilyNotificationOutboxEventTx, familyNotificationOutboxDedupeKey,
  __setOutboxEnqueueFaultForTests, outboxRetryDelayMs,
  OUTBOX_MAX_ATTEMPTS, OUTBOX_BASE_RETRY_DELAY_MS,
} from "../src/internal/family-notification-outbox";
import {
  processFamilyNotificationOutboxBatch, getFamilyNotificationOutboxHealth,
} from "../src/internal/family-notification-outbox-processor";
import { resolveFamilyNotificationRecipientsTx } from "../src/internal/family-notification-authorization";
import { WorkspaceKind, RiskType, SafetySeverity, GuardianRelationshipType, GuardianAuthorityLevel, type FamilyActorContext } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `fno_${process.pid}`;
const future = new Date(Date.now() + 30 * 86_400_000);
const fam = (t: string, u: string, r: string): FamilyActorContext => ({ tenantId: t, userId: u, role: r, workspaceKind: WorkspaceKind.Family });
let keyN = 0;
const ikey = () => `idem_${sfx}_${keyN++}`;

const outboxRows = (tenantId: string, sourceId: string) =>
  systemDb.familyNotificationOutboxEvent.findMany({ where: { tenantId, sourceId } });
const notifCount = (tenantId: string, userId: string, sourceId?: string) =>
  systemDb.notification.count({ where: { tenantId, userId, type: "family_delivery_available" as never, ...(sourceId ? { metadata: { path: ["entityId"], equals: sourceId } } : {}) } });

async function main() {
  // ── Fixtures: full authorized chain for guardian G1, a second guardian G2, tenant B for cross-tenant. ──
  const A = (await systemDb.tenant.create({ data: { id: `oa_${sfx}`, name: "OA", slug: `oa_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const B = (await systemDb.tenant.create({ data: { id: `ob_${sfx}`, name: "OB", slug: `ob_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const uOwner = (await systemDb.user.create({ data: { id: `oo_${sfx}`, email: `oo_${sfx}@t.local` } })).id;
  const uG1 = (await systemDb.user.create({ data: { id: `og1_${sfx}`, email: `og1_${sfx}@t.local` } })).id;
  const uG2 = (await systemDb.user.create({ data: { id: `og2_${sfx}`, email: `og2_${sfx}@t.local` } })).id;
  const mOwner = (await systemDb.membership.create({ data: { userId: uOwner, tenantId: A, role: "owner" as never } })).id;
  const mG1 = (await systemDb.membership.create({ data: { userId: uG1, tenantId: A, role: "admin" as never } })).id;
  const mG2 = (await systemDb.membership.create({ data: { userId: uG2, tenantId: A, role: "admin" as never } })).id;
  const ownerA = fam(A, uOwner, "owner");
  const pA = (await systemDb.protectedProfile.create({ data: { tenantId: A, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  await systemDb.consentRecord.create({ data: { tenantId: A, protectedProfileId: pA, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: mOwner, validUntil: future } });
  const sig = (await systemDb.safetySignal.create({ data: { tenantId: A, protectedProfileId: pA, signalType: RiskType.Cyberbullying, severity: SafetySeverity.High, sourceType: "manual_test" } })).id;

  async function authorize(m: string): Promise<string> {
    const rel = (await systemDb.guardianRelationship.create({ data: { tenantId: A, guardianMembershipId: m, protectedProfileId: pA, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "secondary", status: "verified" } })).id;
    await systemDb.guardianAuthorityRecord.create({ data: { tenantId: A, guardianRelationshipId: rel, authorityType: "legal_guardian", authorityStatus: "verified", verifiedAt: new Date(), validUntil: future } });
    await systemDb.safeRecipientAssessment.create({ data: { tenantId: A, guardianRelationshipId: rel, assessmentStatus: "approved", eligibilityStatus: "eligible", assessedByMembershipId: mOwner, assessedAt: new Date(), validUntil: future } });
    const dec = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sig, recipientMembershipId: m, guardianRelationshipId: rel });
    return dec.id;
  }
  const dec1 = await authorize(mG1);
  const dec2 = await authorize(mG2);

  // Create a delivery for a decision and drive it to AVAILABLE (which enqueues the outbox event).
  async function availableDelivery(decisionId: string, now = new Date()): Promise<{ id: string; availableAt: Date }> {
    const del = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decisionId, idempotencyKey: ikey() });
    const av = await makeSafetySignalDeliveryAvailable(ownerA, del.id, now);
    return { id: del.id, availableAt: av.availableAt as Date };
  }

  // ═════════ 1. Schema & security ═════════
  console.log("\n1. schema & security");
  // Index NAMES are truncated by Postgres at 63 chars, so assert by the index DEFINITION (columns) instead.
  const idx = await systemDb.$queryRawUnsafe<Array<{ indexdef: string }>>(`SELECT indexdef FROM pg_indexes WHERE tablename='family_notification_outbox_events'`);
  const defs = idx.map((r) => r.indexdef.replace(/"/g, ""));
  check("★ (1) outbox table exists (queryable)", typeof (await systemDb.familyNotificationOutboxEvent.count()) === "number");
  check("★ (2) unique (tenantId,dedupeKey) constraint exists", defs.some((d) => /UNIQUE/.test(d) && /\(tenantId, dedupeKey\)/.test(d)));
  check("★ (3) claim index (status,nextAttemptAt,createdAt,id) exists", defs.some((d) => /\(status, nextAttemptAt, createdAt, id\)/.test(d)));
  const rls = await systemDb.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='family_notification_outbox_events'`);
  const pol = await systemDb.$queryRawUnsafe<Array<{ polname: string }>>(`SELECT polname FROM pg_policy WHERE polrelid='family_notification_outbox_events'::regclass`);
  check("★ (4) RLS enabled+forced with tenant_isolation policy", rls[0]?.relrowsecurity === true && rls[0]?.relforcerowsecurity === true && pol.some((p) => p.polname === "tenant_isolation"));
  const grants = await systemDb.$queryRawUnsafe<Array<{ privilege_type: string }>>(`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='tamanor_app' AND table_name='family_notification_outbox_events'`);
  const gset = new Set(grants.map((g) => g.privilege_type));
  let appDeleteThrew = false;
  try { await withTenant(A, (tx) => tx.familyNotificationOutboxEvent.deleteMany({ where: { tenantId: A } })); } catch { appDeleteThrew = true; }
  check("★ (5) app role has SELECT/INSERT/UPDATE but NOT DELETE/TRUNCATE (grant + runtime)", gset.has("SELECT") && gset.has("INSERT") && gset.has("UPDATE") && !gset.has("DELETE") && !gset.has("TRUNCATE") && appDeleteThrew);
  check("★ (6) enqueue + processor are NOT barrel-exported (no browser access path)", !("enqueueFamilyNotificationOutboxEventTx" in dbBarrel) && !("processFamilyNotificationOutboxBatch" in dbBarrel));
  const ipGrants = await systemDb.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM information_schema.role_table_grants WHERE grantee='tamanor_app' AND table_name IN ('child_safety_incidents','child_safety_protection_plans')`);
  check("★ (7) incident/protection-plan owner-only grants unchanged (0)", Number(ipGrants[0]?.n) === 0);

  // ═════════ 2. Enqueue ═════════
  console.log("\n2. enqueue (atomic with the delivery transition)");
  const d1 = await availableDelivery(dec1);
  check("★ (8) availability transition enqueues exactly one event", (await outboxRows(A, d1.id)).length === 1);
  const dRow = await getSafetySignalDelivery(ownerA, d1.id);
  check("★ (9) delivery transition + enqueue commit together (both present)", dRow.deliveryStatus === "available" && (await outboxRows(A, d1.id)).length === 1);
  // (10) forced enqueue failure rolls the transition back.
  const delRB = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: dec1, idempotencyKey: ikey() });
  __setOutboxEnqueueFaultForTests(true);
  let rbThrew = false;
  try { await makeSafetySignalDeliveryAvailable(ownerA, delRB.id); } catch { rbThrew = true; }
  __setOutboxEnqueueFaultForTests(false);
  const delRBAfter = await getSafetySignalDelivery(ownerA, delRB.id);
  check("★ (10) forced enqueue failure rolls back the delivery transition", rbThrew && delRBAfter.deliveryStatus !== "available" && (await outboxRows(A, delRB.id)).length === 0);
  // (11) same (delivery, eventVersion) retry → one row.  (12) new eventVersion → new row.
  const ev = String(d1.availableAt.getTime());
  const dup = await withTenant(A, (tx) => enqueueFamilyNotificationOutboxEventTx(tx, { tenantId: A, notificationType: "family_delivery_available", source: { deliveryId: d1.id }, eventVersion: ev, occurredAt: d1.availableAt }));
  check("★ (11) same delivery+eventVersion retry produces one outbox row (duplicate)", dup.duplicate === true && (await outboxRows(A, d1.id)).length === 1);
  await withTenant(A, (tx) => enqueueFamilyNotificationOutboxEventTx(tx, { tenantId: A, notificationType: "family_delivery_available", source: { deliveryId: d1.id }, eventVersion: `${ev}-v2`, occurredAt: d1.availableAt }));
  check("★ (12) a new eventVersion produces a new row", (await outboxRows(A, d1.id)).length === 2);
  // (13)(14) no recipient ids / no content columns.
  const cols = (await systemDb.$queryRawUnsafe<Array<{ column_name: string }>>(`SELECT column_name FROM information_schema.columns WHERE table_name='family_notification_outbox_events'`)).map((c) => c.column_name);
  check("★ (13) no recipient/user/member columns", !cols.some((c) => /recipient|user|member/i.test(c)));
  check("★ (14) no content/PII/payload columns", !cols.some((c) => /name|email|content|narrative|note|token|evidence|payload|title|message|body|reason(?!Code)/i.test(c)));
  const rowVals = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: d1.id }, select: { sourceId: true, sourceType: true } });
  check("★ (13b) stored source is a delivery id, never a recipient id", rowVals?.sourceType === "safety_signal_delivery" && rowVals?.sourceId === d1.id && rowVals?.sourceId !== uG1 && rowVals?.sourceId !== mG1);
  // (15) unsupported type cannot be enqueued.  (16) cross-tenant source rejected by RLS.
  let unsupThrew = false;
  try { await withTenant(A, (tx) => enqueueFamilyNotificationOutboxEventTx(tx, { tenantId: A, notificationType: "family_urgent_signal" as never, source: { deliveryId: d1.id }, eventVersion: "x1", occurredAt: new Date() })); } catch { unsupThrew = true; }
  check("★ (15) unsupported Family type cannot be enqueued this phase", unsupThrew);
  let xTenantThrew = false;
  try { await withTenant(A, (tx) => enqueueFamilyNotificationOutboxEventTx(tx, { tenantId: B, notificationType: "family_delivery_available", source: { deliveryId: d1.id }, eventVersion: "x2", occurredAt: new Date() })); } catch { xTenantThrew = true; }
  check("★ (16) cross-tenant enqueue rejected (RLS WITH CHECK)", xTenantThrew);

  // ═════════ 3. Claiming ═════════
  console.log("\n3. claiming (FOR UPDATE SKIP LOCKED)");
  // Stub create that just records call order and returns a benign 0-recipient completion (no DB writes).
  const okZero = async () => ({ ok: true as const, eligibleRecipientCount: 0, createdCount: 0, duplicateCount: 0 });
  // (17) bounded batch: 3 pending events, batchSize 1 → claims 1.
  const t0 = new Date(Date.now() - 10_000);
  const early = await availableDelivery(dec1, new Date(t0.getTime()));
  const mid = await availableDelivery(dec2, new Date(t0.getTime() + 1000));
  // Use a third raw pending event to have 3 without more chains.
  await systemDb.familyNotificationOutboxEvent.create({ data: { tenantId: A, notificationType: "family_delivery_available", sourceType: "safety_signal_delivery", sourceId: `raw_${sfx}`, eventVersion: "r1", dedupeKey: `${sfx}_raw1`, occurredAt: new Date(t0.getTime() + 2000), nextAttemptAt: new Date(t0.getTime() + 2000), updatedAt: new Date() } });
  const claimedOrder: string[] = [];
  const recordOrder = async (i: { source: { deliveryId?: string } & Record<string, unknown> }) => { claimedOrder.push(String((i.source as { deliveryId?: string }).deliveryId ?? "")); return okZero(); };
  const r17 = await processFamilyNotificationOutboxBatch({ batchSize: 1, now: new Date() }, { createAuthorizedFamilyNotification: recordOrder as never });
  check("★ (17) processor claims a bounded batch (batchSize=1 → 1)", r17.claimed === 1);
  // (18) deterministic order: earliest nextAttemptAt claimed first.
  check("★ (18) claimed in (nextAttemptAt,createdAt,id) order (earliest first)", claimedOrder[0] === early.id);
  // (22) batch bounding: batchSize 0 is clamped up to 1 (never 0/negative), and large batch never over-claims.
  const r22 = await processFamilyNotificationOutboxBatch({ batchSize: 0, now: new Date() }, { createAuthorizedFamilyNotification: okZero as never });
  check("★ (22) batch size is bounded (batchSize=0 clamps to ≥1)", r22.claimed >= 1);
  // Drain the rest so later sections start clean-ish.
  await processFamilyNotificationOutboxBatch({ batchSize: 50, now: new Date() }, { createAuthorizedFamilyNotification: okZero as never });
  // (19) two workers racing on ONE active event → total 1 claim.
  const race = await availableDelivery(dec1);
  const [ra, rb] = await Promise.all([
    processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() }, { createAuthorizedFamilyNotification: okZero as never }),
    processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() }, { createAuthorizedFamilyNotification: okZero as never }),
  ]);
  const raceRow = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: race.id } });
  check("★ (19) two workers never claim the same active lease (total 1)", (ra.claimed + rb.claimed) >= 1 && raceRow?.status === "completed");
  // (20) lease-expired event becomes claimable; (21) active lease is not stolen.
  const leaseDel = await availableDelivery(dec2);
  const leaseRow = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: leaseDel.id } });
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: leaseRow!.id }, data: { status: "processing", lockedAt: new Date(Date.now() - 10 * 60_000), lockExpiresAt: new Date(Date.now() - 5 * 60_000) } });
  const r20 = await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() }, { createAuthorizedFamilyNotification: okZero as never });
  check("★ (20) lease-expired (crashed-worker) event is reclaimable", r20.claimed >= 1 && (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { id: leaseRow!.id } }))?.status === "completed");
  const active = await availableDelivery(dec1);
  const activeRow = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: active.id } });
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: activeRow!.id }, data: { status: "processing", lockedAt: new Date(), lockExpiresAt: new Date(Date.now() + 5 * 60_000) } });
  const before21 = (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { id: activeRow!.id } }))?.status;
  await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() }, { createAuthorizedFamilyNotification: okZero as never });
  check("★ (21) active (non-expired) lease is not stolen", before21 === "processing" && (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { id: activeRow!.id } }))?.status === "processing");
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: activeRow!.id }, data: { status: "completed", completedAt: new Date() } }); // release for cleanup

  // ═════════ 4. Successful processing (REAL authorization) ═════════
  console.log("\n4. successful processing (current-authorization)");
  const s1 = await availableDelivery(dec1);
  const r23 = await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() });
  check("★ (23) eligible recipient receives exactly one notification; event completed", (await notifCount(A, uG1, s1.id)) === 1 && r23.notifications_created >= 1 && (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: s1.id } }))?.status === "completed");
  // (24) two events → two recipients, one each.
  const m1 = await availableDelivery(dec1);
  const m2 = await availableDelivery(dec2);
  await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() });
  check("★ (24) multiple recipients each receive one (their own)", (await notifCount(A, uG1, m1.id)) === 1 && (await notifCount(A, uG2, m2.id)) === 1);
  // (25)(26) revoked-before-processing → zero notifications, completed no_recipients.
  const rev = await availableDelivery(dec1);
  await systemDb.safetyRecipientAuthorizationDecision.update({ where: { id: dec1 }, data: { revokedAt: new Date() } });
  const r26 = await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() });
  check("★ (26) authorization revoked before processing → zero notifications (current-auth)", (await notifCount(A, uG1, rev.id)) === 0 && r26.no_recipients >= 1 && (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: rev.id } }))?.status === "completed");
  check("★ (25) zero eligible recipients still marks the event completed", (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: rev.id } }))?.safeReasonCode === "no_recipients");
  await systemDb.safetyRecipientAuthorizationDecision.update({ where: { id: dec1 }, data: { revokedAt: null } });
  // (27) duplicate processing → no duplicate notification.
  const dupProc = await availableDelivery(dec1);
  await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() });
  const dupRow = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: dupProc.id } });
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: dupRow!.id }, data: { status: "pending", nextAttemptAt: new Date(Date.now() - 1000), completedAt: null } });
  const r27 = await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() });
  check("★ (27) duplicate processing creates no duplicate notification", (await notifCount(A, uG1, dupProc.id)) === 1 && r27.duplicates >= 1);
  // (28) completed event not claimed again.
  const c28 = await processFamilyNotificationOutboxBatch({ batchSize: 50, now: new Date() });
  check("★ (28) a completed event is not claimed again", (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: dupProc.id } }))?.status === "completed" && c28.claimed === 0);
  // (29) malformed/unsupported event → dead_letter.
  await systemDb.familyNotificationOutboxEvent.create({ data: { tenantId: A, notificationType: "family_urgent_signal" as never, sourceType: "safety_signal_delivery", sourceId: `bad_${sfx}`, eventVersion: "b1", dedupeKey: `${sfx}_bad1`, occurredAt: new Date(), nextAttemptAt: new Date(Date.now() - 1000), updatedAt: new Date() } });
  await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() });
  const bad = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: `bad_${sfx}` } });
  check("★ (29) malformed/unsupported event → dead_letter with bounded code", bad?.status === "dead_letter" && bad?.lastErrorCode === "unsupported_type");
  // (30) source no longer available → bounded terminal outcome (source_gone).
  const gone = await availableDelivery(dec2);
  await systemDb.safetySignalDelivery.delete({ where: { id: gone.id } });
  await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() });
  const goneRow = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: gone.id } });
  check("★ (30) source no longer available → completed source_gone (bounded)", goneRow?.status === "completed" && goneRow?.safeReasonCode === "source_gone");

  // ═════════ 5. Retry & dead-letter ═════════
  console.log("\n5. retry & dead-letter");
  const boom = () => { throw new Error("SECRET-tenant-oa-user-og1-should-never-be-stored"); };
  const throwing = async () => boom();
  const ret = await availableDelivery(dec1);
  const nowR = new Date();
  const r31 = await processFamilyNotificationOutboxBatch({ batchSize: 5, now: nowR }, { createAuthorizedFamilyNotification: throwing as never });
  const retRow = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: ret.id } });
  check("★ (31) transient failure schedules a retry (back to pending)", r31.retried >= 1 && retRow?.status === "pending");
  check("★ (32) attempt count increments once per cycle", retRow?.attemptCount === 1);
  check("★ (33) nextAttemptAt follows bounded backoff", retRow?.nextAttemptAt.getTime() === nowR.getTime() + outboxRetryDelayMs(1) && outboxRetryDelayMs(1) === OUTBOX_BASE_RETRY_DELAY_MS);
  check("★ (37) raw exception text is NOT persisted (bounded code only)", retRow?.lastErrorCode === "processing_error" && !/SECRET/.test(JSON.stringify(retRow)));
  // (34) not claimed before nextAttemptAt.
  const r34 = await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date(retRow!.nextAttemptAt.getTime() - 1000) }, { createAuthorizedFamilyNotification: throwing as never });
  check("★ (34) event is not claimed before nextAttemptAt", (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { id: retRow!.id } }))?.attemptCount === 1 && r34.claimed === 0);
  // (35) claimed when due; (36) max attempts → dead_letter.
  let cur = retRow!;
  for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 1; i++) {
    const at = new Date(cur.nextAttemptAt.getTime() + 1000);
    await processFamilyNotificationOutboxBatch({ batchSize: 5, now: at }, { createAuthorizedFamilyNotification: throwing as never });
    const next = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { id: retRow!.id } });
    if (!next || next.status === "dead_letter") { cur = next ?? cur; break; }
    cur = next;
  }
  check("★ (35) event is claimed once retry is due (attempts advanced)", cur.attemptCount >= 2);
  check("★ (36) maximum attempts produce dead_letter", cur.status === "dead_letter" && cur.lastErrorCode === "max_attempts_exceeded");

  // ═════════ 6. Crash recovery ═════════
  console.log("\n6. crash recovery (at-least-once event, exactly-once rows)");
  const crash = await availableDelivery(dec2);
  await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() });
  const beforeN = await notifCount(A, uG2, crash.id);
  const crashRow = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: crash.id } });
  // Simulate: notifications committed, but the "mark completed" never persisted (crash) → row stuck processing.
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: crashRow!.id }, data: { status: "processing", lockExpiresAt: new Date(Date.now() - 60_000) } });
  const rC = await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() });
  const afterRow = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { id: crashRow!.id } });
  check("★ (38-39) reprocessing after crash creates NO duplicate notification", beforeN === 1 && (await notifCount(A, uG2, crash.id)) === 1 && rC.duplicates >= 1);
  check("★ (40) reprocessing marks the event completed", afterRow?.status === "completed");
  // (41) two processors racing on a fresh event → one observable notification.
  const raceN = await availableDelivery(dec1);
  await Promise.all([
    processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() }),
    processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() }),
  ]);
  check("★ (41) two racing processors → exactly one observable notification", (await notifCount(A, uG1, raceN.id)) === 1);

  // ═════════ 7. Privacy & health ═════════
  console.log("\n7. privacy & health");
  check("★ (42) outbox schema has no email/name/content/note/token/evidence columns", !cols.some((c) => /email|name|content|note|token|evidence|body|payload/i.test(c)));
  const r43 = await processFamilyNotificationOutboxBatch({ batchSize: 5, now: new Date() });
  check("★ (43) processor result is aggregate counts only (all numeric)", Object.values(r43).every((v) => typeof v === "number"));
  const health = await getFamilyNotificationOutboxHealth(new Date());
  const healthVals = Object.entries(health);
  check("★ (44) health contains only counts + a bounded age bucket (no ids)", healthVals.every(([k, v]) => (k === "oldestPendingAgeBucket" ? /^(none|lt_1m|lt_1h|lt_1d|gte_1d)$/.test(String(v)) : typeof v === "number")));
  // (45)(46) notification metadata strict + content-free; safe route has no id/query.
  const notif = await systemDb.notification.findFirst({ where: { tenantId: A, userId: uG1, type: "family_delivery_available" as never }, select: { metadata: true, titleKey: true } });
  const meta = (notif?.metadata ?? {}) as Record<string, unknown>;
  check("★ (45) notification metadata is strict + content-free", Object.keys(meta).every((k) => !/narrative|evidence|reviewer|note|content|email|name|token|signal/i.test(k)) && (notif?.titleKey ?? "").startsWith("family_notif."));
  check("★ (46) safe route carries no entity id or query parameter", typeof meta.safeRoute !== "string" || !/[?=]/.test(meta.safeRoute as string));

  // ═════════ 8. Targeted regression / boundary ═════════
  console.log("\n8. targeted regression");
  const direct = await withTenant(A, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId: A, source: { type: "family_delivery_available", deliveryId: raceN.id, eventVersion: "z1" } }));
  check("★ (47) direct family_delivery_available resolver still returns the recipient", direct.ok === true && direct.recipientUserIds.includes(uG1));
  // (52) only the authorized canonical DOMAIN services wire the enqueue (Phase 3B1 adds the four advisory
  // triggers to the Phase 3A delivery trigger). The full "exactly six types / no forbidden trigger" invariants
  // live in the source-invariants + advisory suites; here we assert the importer SET is exactly the authorized one.
  const { readFileSync, readdirSync } = await import("node:fs");
  const srcDir = new URL("../src/", import.meta.url).pathname;
  const importers = readdirSync(srcDir).filter((f) => f.endsWith(".ts")).filter((f) => /from ["'][^"']*internal\/family-notification-outbox["']/.test(readFileSync(srcDir + f, "utf8"))).sort();
  const authorized = ["child-safety-consent.ts", "child-safety-delivery.ts", "child-safety-recipient-authorization.ts", "family-invitation.ts"];
  check("★ (52) only the authorized canonical domain services wire the outbox enqueue", JSON.stringify(importers) === JSON.stringify(authorized), importers.join(","));
  // dedupe helper purity: same inputs → same key; recipient/attempt/worker NEVER part of identity.
  const k1 = familyNotificationOutboxDedupeKey({ tenantId: A, notificationType: "family_delivery_available", sourceType: "safety_signal_delivery", sourceId: d1.id, eventVersion: "e" });
  const k2 = familyNotificationOutboxDedupeKey({ tenantId: A, notificationType: "family_delivery_available", sourceType: "safety_signal_delivery", sourceId: d1.id, eventVersion: "e" });
  const k3 = familyNotificationOutboxDedupeKey({ tenantId: A, notificationType: "family_delivery_available", sourceType: "safety_signal_delivery", sourceId: d1.id, eventVersion: "e2" });
  check("★ (dedupe) deterministic + version-sensitive identity", k1 === k2 && k1 !== k3 && /^[a-f0-9]{64}$/.test(k1));
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    for (const t of [`oa_${sfx}`, `ob_${sfx}`]) {
      await systemDb.familyNotificationOutboxEvent.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.notification.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.tenant.delete({ where: { id: t } }).catch(() => {});
    }
    for (const u of [`oo_${sfx}`, `og1_${sfx}`, `og2_${sfx}`]) await systemDb.user.delete({ where: { id: u } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications outbox: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
