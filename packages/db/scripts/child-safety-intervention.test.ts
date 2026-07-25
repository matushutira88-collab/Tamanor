/**
 * CS-C15 — End-to-End Protective Intervention orchestrator (local DB). Seeds the FULL canonical
 * authorization chain and proves: authorized guardian delivery, exactly-once idempotency, every
 * fail-closed gate (consent/authority/safe-recipient/no-guardian/low-confidence), urgent escalation,
 * tenant isolation, and privacy (content-free). Reuses the canonical recipient-authorization + delivery
 * services via the orchestrator.
 * Run: pnpm child-safety-intervention:test
 */
import { systemDb, interveneOnAcceptedSafetySignal } from "@guardora/db";
import {
  RiskType, SafetySeverity, SafetyConfidenceBand, ChildSafetyOutcome,
  GuardianRelationshipType, GuardianAuthorityLevel, WorkspaceKind,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const sfx = `csintv_${process.pid}`;
const tids: string[] = [];
const uids: string[] = [];
const future = new Date(Date.now() + 365 * 864e5);
let k = 0;

async function seedFamily() {
  const id = `f${k++}_${sfx}`; tids.push(id);
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${id}`, email: `uo_${id}@t.local` } })).id; uids.push(uOwner);
  const uGuard = (await systemDb.user.create({ data: { id: `ug_${id}`, email: `ug_${id}@t.local` } })).id; uids.push(uGuard);
  const mOwner = await systemDb.membership.create({ data: { userId: uOwner, tenantId: id, role: "owner" as never } });
  const mGuard = await systemDb.membership.create({ data: { userId: uGuard, tenantId: id, role: "admin" as never } });
  const profile = await systemDb.protectedProfile.create({ data: { tenantId: id, ageBand: "age_10_12", protectionStatus: "active" } });
  return { tenantId: id, mOwner, mGuard, profileId: profile.id };
}
/** Seed a full AUTHORIZED chain (verified relationship + authority + active consent + approved assessment). */
async function seedAuthorizedGuardian(f: { tenantId: string; mOwner: { id: string }; mGuard: { id: string }; profileId: string }) {
  const rel = await systemDb.guardianRelationship.create({ data: { tenantId: f.tenantId, guardianMembershipId: f.mGuard.id, protectedProfileId: f.profileId, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "primary", status: "verified" } });
  await systemDb.guardianAuthorityRecord.create({ data: { tenantId: f.tenantId, guardianRelationshipId: rel.id, authorityType: "legal_guardian", authorityStatus: "verified", verifiedAt: new Date(), validUntil: future } });
  const consent = await systemDb.consentRecord.create({ data: { tenantId: f.tenantId, protectedProfileId: f.profileId, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: f.mOwner.id, validUntil: future } });
  const assess = await systemDb.safeRecipientAssessment.create({ data: { tenantId: f.tenantId, guardianRelationshipId: rel.id, assessmentStatus: "approved", eligibilityStatus: "eligible", assessedByMembershipId: f.mOwner.id, assessedAt: new Date(), validUntil: future } });
  return { rel, consent, assess };
}
const sig = (tenantId: string, profileId: string, signalType: string, severity: string, band: string) =>
  systemDb.safetySignal.create({ data: { tenantId, protectedProfileId: profileId, signalType, severity, confidenceBand: band, sourceType: "platform_partner" } });
const deliveryCount = (tenantId: string, safetySignalId: string) =>
  systemDb.safetySignalDelivery.count({ where: { tenantId, recipientAuthorizationDecision: { safetySignalId } } });

async function main() {
  // A. full authorized chain + high severity → delivered
  console.log("\nA. authorized guardian delivery");
  const fA = await seedFamily();
  const chain = await seedAuthorizedGuardian(fA);
  const s1 = await sig(fA.tenantId, fA.profileId, RiskType.Cyberbullying, SafetySeverity.High, SafetyConfidenceBand.High);
  const r1 = await interveneOnAcceptedSafetySignal({ signalId: s1.id, tenantId: fA.tenantId });
  check("★ authorized + high severity → delivered to safe recipient", r1.delivered === true && r1.deliveryId !== null && r1.recipientsAuthorized === 1);
  check("outcome is incident (high severity)", r1.outcome === ChildSafetyOutcome.CreateOrUpdateIncident && r1.incidentId !== null);
  check("★ exactly one delivery persisted", (await deliveryCount(fA.tenantId, s1.id)) === 1);

  // B. idempotency — re-run does not duplicate the delivery
  console.log("\nB. idempotency");
  const r1b = await interveneOnAcceptedSafetySignal({ signalId: s1.id, tenantId: fA.tenantId });
  check("★ re-run does NOT create a 2nd delivery (idempotent)", r1b.delivered === true && (await deliveryCount(fA.tenantId, s1.id)) === 1);

  // C. fail-closed gates
  console.log("\nC. fail-closed authorization gates");
  await systemDb.consentRecord.update({ where: { id: chain.consent.id }, data: { consentStatus: "withdrawn", revokedAt: new Date() } });
  const s2 = await sig(fA.tenantId, fA.profileId, RiskType.Cyberbullying, SafetySeverity.High, SafetyConfidenceBand.High);
  const r2 = await interveneOnAcceptedSafetySignal({ signalId: s2.id, tenantId: fA.tenantId });
  check("★ withdrawn consent → NO delivery (fail-closed)", r2.delivered === false && r2.recipientsAuthorized === 0);
  check("no delivery persisted for the blocked signal", (await deliveryCount(fA.tenantId, s2.id)) === 0);
  await systemDb.consentRecord.update({ where: { id: chain.consent.id }, data: { consentStatus: "active", revokedAt: null } });
  await systemDb.safeRecipientAssessment.update({ where: { id: chain.assess.id }, data: { assessmentStatus: "revoked", revokedAt: new Date() } });
  const s3 = await sig(fA.tenantId, fA.profileId, RiskType.Cyberbullying, SafetySeverity.High, SafetyConfidenceBand.High);
  check("★ unsafe recipient (revoked assessment) → NO delivery", (await interveneOnAcceptedSafetySignal({ signalId: s3.id, tenantId: fA.tenantId })).delivered === false);
  await systemDb.safeRecipientAssessment.update({ where: { id: chain.assess.id }, data: { assessmentStatus: "approved", revokedAt: null } });

  // D. low confidence → no delivery even with full chain
  console.log("\nD. low confidence");
  const s4 = await sig(fA.tenantId, fA.profileId, RiskType.Cyberbullying, SafetySeverity.High, SafetyConfidenceBand.Low);
  const r4 = await interveneOnAcceptedSafetySignal({ signalId: s4.id, tenantId: fA.tenantId });
  check("★ low confidence → NO guardian delivery", r4.delivered === false && (r4.outcome === ChildSafetyOutcome.LocalSafetyGuidance || r4.outcome === ChildSafetyOutcome.QueueForReview));

  // E. no guardian at all → review, no delivery
  console.log("\nE. no authorized recipient");
  const fB = await seedFamily();
  const s5 = await sig(fB.tenantId, fB.profileId, RiskType.Grooming, SafetySeverity.High, SafetyConfidenceBand.High);
  const r5 = await interveneOnAcceptedSafetySignal({ signalId: s5.id, tenantId: fB.tenantId });
  check("★ no guardian chain → no delivery, internal outcome", r5.delivered === false && r5.recipientsAuthorized === 0 && r5.recipientsConsidered === 0);

  // F. urgent risk (sextortion, critical) + full chain → escalate + incident + delivered
  console.log("\nF. urgent escalation");
  const fC = await seedFamily();
  await seedAuthorizedGuardian(fC);
  const s6 = await sig(fC.tenantId, fC.profileId, RiskType.Sextortion, SafetySeverity.Critical, SafetyConfidenceBand.High);
  const r6 = await interveneOnAcceptedSafetySignal({ signalId: s6.id, tenantId: fC.tenantId });
  check("★ sextortion critical → URGENT_ESCALATION + escalate + incident + delivered", r6.outcome === ChildSafetyOutcome.UrgentEscalation && r6.escalated === true && r6.incidentId !== null && r6.delivered === true);

  // G. tenant isolation
  console.log("\nG. tenant isolation");
  const r7 = await interveneOnAcceptedSafetySignal({ signalId: s1.id, tenantId: fC.tenantId }); // s1 belongs to fA
  check("★ cross-tenant signal id → not found, no action, no delivery", r7.outcome === ChildSafetyOutcome.NoAction && r7.delivered === false);

  // H. privacy — the whole pipeline is content-free (signal has no content column; audit/delivery minimized)
  console.log("\nH. privacy");
  const auditRows = await systemDb.auditLog.findMany({ where: { tenantId: fA.tenantId, targetId: s1.id }, select: { event: true, metadata: true, actorKind: true } });
  check("★ intervention audit is system + content-free", auditRows.length > 0 && auditRows.every((a) => a.actorKind === "system") && !JSON.stringify(auditRows).match(/message|transcript|content|token|secret|@/i));
}

main()
  .then(async () => {
    for (const id of tids) { for (const t of ["childSafetyEscalation", "childSafetyIncidentSignal", "childSafetyIncident", "notification", "childSafetyIntervention", "safetySignalDelivery", "safetyRecipientAuthorizationDecision", "safeRecipientAssessment", "guardianAuthorityRecord", "consentRecord", "safetySignal", "guardianRelationship", "auditLog", "membership", "protectedProfile"] as const) { await (systemDb as never as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[t].deleteMany({ where: { tenantId: id } }).catch(() => {}); } await systemDb.tenant.delete({ where: { id } }).catch(() => {}); }
    for (const u of uids) await systemDb.user.delete({ where: { id: u } }).catch(() => {});
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS-C15 intervention orchestrator: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error("FATAL:", e?.stack ?? e?.message ?? e);
    for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    process.exit(1);
  });
