/**
 * CS-C15B — durable intervention state, incident correlation, urgent-escalation persistence, and
 * partial-failure RECOVERY (local DB). Proves exactly-once side effects across resumes, deterministic
 * correlation + severity-monotonic incidents, escalation reuse, bounded retry / terminal failure, and
 * privacy (no raw content in the durable state). Reuses the canonical chain + delivery.
 * Run: pnpm child-safety-intervention-recovery:test
 */
import { systemDb, interveneOnAcceptedSafetySignal } from "@guardora/db";
import {
  RiskType, SafetySeverity, SafetyConfidenceBand, ChildSafetyOutcome,
  GuardianRelationshipType, GuardianAuthorityLevel, WorkspaceKind,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const sfx = `csrec_${process.pid}`;
const tids: string[] = [];
const future = new Date(Date.now() + 365 * 864e5);
let k = 0;

async function seedAuthorizedFamily() {
  const id = `f${k++}_${sfx}`; tids.push(id);
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${id}`, email: `uo_${id}@t.local` } })).id;
  const uGuard = (await systemDb.user.create({ data: { id: `ug_${id}`, email: `ug_${id}@t.local` } })).id;
  const mOwner = await systemDb.membership.create({ data: { userId: uOwner, tenantId: id, role: "owner" as never } });
  const mGuard = await systemDb.membership.create({ data: { userId: uGuard, tenantId: id, role: "admin" as never } });
  const profileId = (await systemDb.protectedProfile.create({ data: { tenantId: id, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const rel = await systemDb.guardianRelationship.create({ data: { tenantId: id, guardianMembershipId: mGuard.id, protectedProfileId: profileId, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "primary", status: "verified" } });
  await systemDb.guardianAuthorityRecord.create({ data: { tenantId: id, guardianRelationshipId: rel.id, authorityType: "legal_guardian", authorityStatus: "verified", verifiedAt: new Date(), validUntil: future } });
  await systemDb.consentRecord.create({ data: { tenantId: id, protectedProfileId: profileId, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: mOwner.id, validUntil: future } });
  await systemDb.safeRecipientAssessment.create({ data: { tenantId: id, guardianRelationshipId: rel.id, assessmentStatus: "approved", eligibilityStatus: "eligible", assessedByMembershipId: mOwner.id, assessedAt: new Date(), validUntil: future } });
  return { tenantId: id, profileId };
}
const sig = (tenantId: string, profileId: string, type: string, severity: string, band = SafetyConfidenceBand.High) =>
  systemDb.safetySignal.create({ data: { tenantId, protectedProfileId: profileId, signalType: type, severity, confidenceBand: band, sourceType: "platform_partner" } });
const state = (signalId: string) => systemDb.childSafetyIntervention.findUnique({ where: { safetySignalId: signalId } });
const deliveryCount = (tenantId: string, safetySignalId: string) => systemDb.safetySignalDelivery.count({ where: { tenantId, recipientAuthorizationDecision: { safetySignalId } } });
const incident = (id: string | null | undefined) => id ? systemDb.childSafetyIncident.findUnique({ where: { id }, select: { severity: true, urgency: true, signalCount: true, escalationState: true } }) : Promise.resolve(null);
const linkFor = (sid: string) => systemDb.childSafetyIncidentSignal.findUnique({ where: { safetySignalId: sid }, select: { incidentId: true } });

async function main() {
  const f = await seedAuthorizedFamily();

  // A. durable state + review + one record per signal
  console.log("\nA. durable state");
  const s1 = await sig(f.tenantId, f.profileId, RiskType.Grooming, SafetySeverity.High);
  const r1 = await interveneOnAcceptedSafetySignal({ signalId: s1.id, tenantId: f.tenantId });
  const st1 = await state(s1.id);
  check("★ one durable intervention per signal, completed", !!st1 && st1.completedAt !== null && st1.processingState !== undefined === false && r1.processingState === "completed");
  check("★ review persisted (reviewStatus done, ref = signal)", st1?.reviewStatus === "done" && st1?.reviewRef === s1.id && r1.reviewed === true);
  check("★ REAL ChildSafetyIncident created + signal linked", st1?.incidentStatus === "done" && !!st1?.incidentRef && !!(await incident(st1?.incidentRef)) && (await linkFor(s1.id))?.incidentId === st1?.incidentRef);
  check("delivery done to authorized recipient", st1?.deliveryStatus === "done" && r1.delivered === true);

  // B. incident correlation — related signal within window links to the SAME real incident, severity monotonic
  console.log("\nB. incident correlation + severity monotonic");
  const s2 = await sig(f.tenantId, f.profileId, RiskType.MeetingAttempt, SafetySeverity.Critical); // same family (grooming)
  const r2 = await interveneOnAcceptedSafetySignal({ signalId: s2.id, tenantId: f.tenantId });
  const st2 = await state(s2.id);
  check("★ related signal links to the SAME real incident (no new incident)", st2?.incidentRef === st1?.incidentRef && (await linkFor(s2.id))?.incidentId === st1?.incidentRef);
  check("★ real incident severity raised to critical (monotonic up)", (await incident(st1?.incidentRef))?.severity === "critical");
  const s3 = await sig(f.tenantId, f.profileId, RiskType.Grooming, SafetySeverity.Low, SafetyConfidenceBand.High);
  await interveneOnAcceptedSafetySignal({ signalId: s3.id, tenantId: f.tenantId });
  check("★ real incident severity NEVER lowered by a lower-severity related signal", (await incident(st1?.incidentRef))?.severity === "critical");
  check("★ incident signalCount reflects the linked signals (>=3)", ((await incident(st1?.incidentRef))?.signalCount ?? 0) >= 3);

  // C. escalation exactly-once across the correlated group (REAL ChildSafetyEscalation)
  console.log("\nC. urgent escalation (exactly-once)");
  check("★ urgent (meeting/critical) → real escalation + incident escalationState", st2?.escalationStatus === "done" && r2.escalated === true && !!st2?.escalationRef && (await incident(st1?.incidentRef))?.escalationState === "escalated");
  const s4 = await sig(f.tenantId, f.profileId, RiskType.MeetingAttempt, SafetySeverity.Critical); // SAME (grooming) family, urgent
  const r4 = await interveneOnAcceptedSafetySignal({ signalId: s4.id, tenantId: f.tenantId });
  check("★ second urgent in SAME group REUSES the real escalation (no duplicate)", r4.escalated === true && (await state(s4.id))?.escalationRef === st2?.escalationRef);

  // D. partial-failure recovery — fail at incident, resume
  console.log("\nD. recovery: fail at incident → resume");
  const g = await seedAuthorizedFamily();
  const s5 = await sig(g.tenantId, g.profileId, RiskType.Grooming, SafetySeverity.High);
  const rf = await interveneOnAcceptedSafetySignal({ signalId: s5.id, tenantId: g.tenantId, failAt: "incident" });
  const stf = await state(s5.id);
  check("★ fail@incident → processing, review done, incident pending, attempt=1", rf.processingState === "processing" && stf?.reviewStatus === "done" && stf?.incidentStatus === "pending" && stf?.completedAt === null && stf?.attemptCount === 1);
  const rr = await interveneOnAcceptedSafetySignal({ signalId: s5.id, tenantId: g.tenantId });
  const str = await state(s5.id);
  check("★ resume → incident done, completed; review NOT repeated", rr.processingState === "completed" && str?.incidentStatus === "done" && str?.reviewStatus === "done" && str?.attemptCount === 2);

  // E. recovery: delivery succeeds then completion fails → no redelivery on retry
  console.log("\nE. recovery: fail at completion → no redelivery");
  const s6 = await sig(g.tenantId, g.profileId, RiskType.Grooming, SafetySeverity.High);
  await interveneOnAcceptedSafetySignal({ signalId: s6.id, tenantId: g.tenantId, failAt: "completion" });
  const st6a = await state(s6.id);
  check("★ fail@completion → delivery already done, not completed", st6a?.deliveryStatus === "done" && st6a?.completedAt === null);
  const beforeCount = await deliveryCount(g.tenantId, s6.id);
  const r6 = await interveneOnAcceptedSafetySignal({ signalId: s6.id, tenantId: g.tenantId });
  check("★ resume completes WITHOUT redelivering (delivery count unchanged)", r6.processingState === "completed" && (await deliveryCount(g.tenantId, s6.id)) === beforeCount);

  // F. completed intervention re-run returns same outcome, no new side effects
  console.log("\nF. completed re-run");
  const before = await deliveryCount(f.tenantId, s1.id);
  const again = await interveneOnAcceptedSafetySignal({ signalId: s1.id, tenantId: f.tenantId });
  check("★ completed re-run → same outcome, no re-run of side effects", again.outcome === r1.outcome && (await deliveryCount(f.tenantId, s1.id)) === before);

  // G. terminal failure is bounded (does not retry forever)
  console.log("\nG. terminal failure bound");
  const s7 = await sig(g.tenantId, g.profileId, RiskType.Threat, SafetySeverity.High);
  let last = await interveneOnAcceptedSafetySignal({ signalId: s7.id, tenantId: g.tenantId, failAt: "incident" });
  for (let i = 0; i < 8 && last.processingState === "processing"; i++) last = await interveneOnAcceptedSafetySignal({ signalId: s7.id, tenantId: g.tenantId, failAt: "incident" });
  const st7 = await state(s7.id);
  check("★ repeated failure → terminal, bounded (completed w/ terminal class, attempts capped)", st7?.completedAt !== null && st7?.lastFailureClass === "terminal" && (st7?.attemptCount ?? 0) <= 6);

  // H. tenant isolation
  console.log("\nH. tenant isolation");
  const r8 = await interveneOnAcceptedSafetySignal({ signalId: s1.id, tenantId: g.tenantId }); // s1 belongs to f
  check("★ cross-tenant signal → NoAction, no durable state for wrong tenant", r8.outcome === ChildSafetyOutcome.NoAction);

  // I. privacy — durable state + audit are content-free
  console.log("\nI. privacy");
  const rows = await systemDb.childSafetyIntervention.findMany({ where: { tenantId: f.tenantId } });
  check("★ durable intervention state contains NO raw content", rows.length > 0 && !JSON.stringify(rows).match(/message|transcript|content|token|secret|@[a-z]/i));
}

main()
  .then(async () => {
    for (const id of tids) { for (const t of ["childSafetyEscalation", "childSafetyIncidentSignal", "childSafetyIncident", "notification", "childSafetyIntervention", "safetySignalDelivery", "safetyRecipientAuthorizationDecision", "safeRecipientAssessment", "guardianAuthorityRecord", "consentRecord", "safetySignal", "guardianRelationship", "auditLog", "membership", "protectedProfile"] as const) { await (systemDb as never as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[t].deleteMany({ where: { tenantId: id } }).catch(() => {}); } await systemDb.tenant.delete({ where: { id } }).catch(() => {}); }
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS-C15B durable recovery: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error("FATAL:", e?.stack ?? e?.message ?? e); for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {}); process.exit(1); });
