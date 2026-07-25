/**
 * CS-C15C — the canonical child-safety INCIDENT + internal ESCALATION + notification domain (local DB).
 * Proves the domain records are REAL (not ledger references): incidents correlate + persist, signals
 * link exactly-once, severity/urgency/signalCount are monotonic, escalations fire exactly-once per
 * (incident, type) with exactly one internal notification, everything is content-free, tenant isolation
 * is enforced at the DB level (composite FKs), and recovery is canonical-record-aware.
 * Run: pnpm child-safety-incident-domain:test
 */
import {
  systemDb, interveneOnAcceptedSafetySignal,
  correlateAndLinkSignal, getChildSafetyIncident, findIncidentForSignal, findActiveGroupIncident,
  createOrReuseEscalation, getChildSafetyEscalation,
} from "@guardora/db";
import {
  RiskType, SafetySeverity, SafetyConfidenceBand, ChildSafetyOutcome, ChildSafetyEscalationType,
  GuardianRelationshipType, GuardianAuthorityLevel, WorkspaceKind, riskFamilyOf, INCIDENT_CORRELATION_WINDOW_MS,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const sfx = `csdom_${process.pid}`;
const tids: string[] = [];
const future = new Date(Date.now() + 365 * 864e5);
let k = 0;

/** Family with a FULL authorized guardian chain (so urgent signals can also deliver). */
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
/** Family with NO guardian chain (urgent still escalates internally; nothing can be delivered). */
async function seedBareFamily() {
  const id = `f${k++}_${sfx}`; tids.push(id);
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${id}`, email: `uo_${id}@t.local` } })).id;
  await systemDb.membership.create({ data: { userId: uOwner, tenantId: id, role: "owner" as never } });
  const profileId = (await systemDb.protectedProfile.create({ data: { tenantId: id, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  return { tenantId: id, profileId };
}
const sig = (tenantId: string, profileId: string, type: string, severity: string, band = SafetyConfidenceBand.High) =>
  systemDb.safetySignal.create({ data: { tenantId, protectedProfileId: profileId, signalType: type, severity, confidenceBand: band, sourceType: "platform_partner" } });
const incidentRow = (id: string) => systemDb.childSafetyIncident.findUnique({ where: { id } });
const linkFor = (sid: string) => systemDb.childSafetyIncidentSignal.findUnique({ where: { safetySignalId: sid }, select: { incidentId: true, tenantId: true } });
const escRows = (tenantId: string, incidentId: string) => systemDb.childSafetyEscalation.findMany({ where: { tenantId, incidentId } });
const notifRows = (tenantId: string, escalationId: string) => systemDb.notification.findMany({ where: { tenantId, dedupeKey: `cs_escalation:${escalationId}` } });
const groomFam = riskFamilyOf(RiskType.Grooming);
const linkOne = (t: string, p: string, sid: string, sev: string, urg: string, fam = groomFam) =>
  correlateAndLinkSignal({ tenantId: t, protectedProfileId: p, safetySignalId: sid, riskFamily: fam, severity: sev, urgency: urg, signalAt: new Date(), windowMs: INCIDENT_CORRELATION_WINDOW_MS });

async function main() {
  // ───────────────────────── INCIDENT DOMAIN ─────────────────────────
  console.log("\n1. incident domain — real records");
  const f = await seedAuthorizedFamily();
  const a1 = await sig(f.tenantId, f.profileId, RiskType.Grooming, SafetySeverity.High);
  const r1 = await linkOne(f.tenantId, f.profileId, a1.id, "high", "elevated");
  const inc1 = await incidentRow(r1.incidentId);
  check("★ REAL ChildSafetyIncident row persisted (tenant + profile relation)", !!inc1 && inc1.tenantId === f.tenantId && inc1.protectedProfileId === f.profileId && inc1.riskFamily === groomFam);
  check("★ incident row is content-free (no raw message/transcript/evidence columns)", !!inc1 && !JSON.stringify(inc1).match(/message|transcript|content|evidence|token|@[a-z]/i));
  check("★ REAL signal↔incident link (safetySignalId, same tenant)", (await linkFor(a1.id))?.incidentId === r1.incidentId && (await linkFor(a1.id))?.tenantId === f.tenantId);
  check("★ findIncidentForSignal resolves the canonical incident", (await findIncidentForSignal(f.tenantId, a1.id)) === r1.incidentId);

  console.log("\n2. one signal → one incident (idempotent re-link)");
  const r1b = await linkOne(f.tenantId, f.profileId, a1.id, "high", "elevated");
  check("★ re-link same signal → SAME incident, no 2nd link created", r1b.incidentId === r1.incidentId && r1b.linkCreated === false);
  check("★ exactly one link row for the signal", (await systemDb.childSafetyIncidentSignal.count({ where: { safetySignalId: a1.id } })) === 1);

  console.log("\n3. same-family correlation reuse + monotonic elevation");
  const a2 = await sig(f.tenantId, f.profileId, RiskType.MeetingAttempt, SafetySeverity.Critical); // same (grooming) family
  const r2 = await linkOne(f.tenantId, f.profileId, a2.id, "critical", "immediate");
  check("★ same-family signal reuses the SAME incident (no new incident)", r2.incidentId === r1.incidentId && r2.createdIncident === false);
  check("★ severity raised high→critical (monotonic up)", (await incidentRow(r1.incidentId))?.severity === "critical");
  check("★ urgency raised elevated→immediate (monotonic up)", (await incidentRow(r1.incidentId))?.urgency === "immediate");
  check("★ signalCount incremented to 2 (once per distinct signal)", (await incidentRow(r1.incidentId))?.signalCount === 2);
  const a3 = await sig(f.tenantId, f.profileId, RiskType.Grooming, SafetySeverity.Low);
  await linkOne(f.tenantId, f.profileId, a3.id, "low", "routine");
  check("★ severity NEVER lowered by a lower-severity related signal", (await incidentRow(r1.incidentId))?.severity === "critical" && (await incidentRow(r1.incidentId))?.urgency === "immediate");

  console.log("\n4. incompatible family → separate incident");
  const b1 = await sig(f.tenantId, f.profileId, RiskType.Cyberbullying, SafetySeverity.High);
  const rb = await linkOne(f.tenantId, f.profileId, b1.id, "high", "elevated", riskFamilyOf(RiskType.Cyberbullying));
  check("★ different risk family → NEW incident (no cross-family correlation)", rb.incidentId !== r1.incidentId && rb.createdIncident === true);

  console.log("\n5. terminal incident is not reused");
  await systemDb.childSafetyIncident.update({ where: { id: r1.incidentId }, data: { status: "closed", closedAt: new Date() } });
  check("★ closed incident is not returned as an active group incident", (await findActiveGroupIncident(f.tenantId, f.profileId, groomFam, INCIDENT_CORRELATION_WINDOW_MS)) === null);
  const a4 = await sig(f.tenantId, f.profileId, RiskType.Grooming, SafetySeverity.High);
  const r4 = await linkOne(f.tenantId, f.profileId, a4.id, "high", "elevated");
  check("★ new same-family signal after close → brand-new incident", r4.incidentId !== r1.incidentId && r4.createdIncident === true);

  console.log("\n6. retry + concurrency converge to one incident/link");
  const a5 = await sig(f.tenantId, f.profileId, RiskType.Grooming, SafetySeverity.High);
  const [c1, c2] = await Promise.all([linkOne(f.tenantId, f.profileId, a5.id, "high", "elevated"), linkOne(f.tenantId, f.profileId, a5.id, "high", "elevated")]);
  check("★ concurrent correlation of the SAME signal → ONE incident, ONE link", c1.incidentId === c2.incidentId && (await systemDb.childSafetyIncidentSignal.count({ where: { safetySignalId: a5.id } })) === 1);
  const beforeCount = (await incidentRow(r4.incidentId))?.signalCount ?? 0;
  await linkOne(f.tenantId, f.profileId, a4.id, "high", "elevated"); // retry an already-linked signal
  check("★ retry of an already-linked signal does NOT double-count signalCount", (await incidentRow(r4.incidentId))?.signalCount === beforeCount);

  console.log("\n7. cross-tenant linking is impossible (composite FK)");
  const g = await seedAuthorizedFamily();
  const xSig = await sig(g.tenantId, g.profileId, RiskType.Grooming, SafetySeverity.High);
  let fkBlocked = false;
  try { await systemDb.childSafetyIncidentSignal.create({ data: { tenantId: g.tenantId, incidentId: r4.incidentId, safetySignalId: xSig.id } }); }
  catch { fkBlocked = true; }
  check("★ linking tenant-G signal to a tenant-F incident is rejected by the DB", fkBlocked && (await findIncidentForSignal(g.tenantId, xSig.id)) === null);

  // ───────────────────────── ESCALATION DOMAIN ─────────────────────────
  console.log("\n8. escalation domain — real records, exactly-once");
  const eInc = r4.incidentId;
  const e1 = await createOrReuseEscalation({ tenantId: f.tenantId, incidentId: eInc, escalationType: ChildSafetyEscalationType.UrgentInternal, urgency: "immediate", reasonCode: "urgent_risk_type", riskFamily: groomFam, severity: "critical" });
  const eRow = await getChildSafetyEscalation(f.tenantId, e1.escalationId);
  check("★ REAL ChildSafetyEscalation row references the real incident", !!eRow && eRow.incidentId === eInc && e1.createdEscalation === true);
  check("★ escalation flips incident.escalationState → 'escalated'", (await incidentRow(eInc))?.escalationState === "escalated");
  const e2 = await createOrReuseEscalation({ tenantId: f.tenantId, incidentId: eInc, escalationType: ChildSafetyEscalationType.UrgentInternal, urgency: "immediate", reasonCode: "urgent_risk_type", riskFamily: groomFam, severity: "critical" });
  check("★ duplicate escalation for (incident,type) REUSES (exactly-once)", e2.escalationId === e1.escalationId && e2.createdEscalation === false && (await escRows(f.tenantId, eInc)).length === 1);
  const [ec1, ec2] = await Promise.all([
    createOrReuseEscalation({ tenantId: f.tenantId, incidentId: r4.incidentId, escalationType: "second_type", urgency: "immediate", reasonCode: "urgent", riskFamily: groomFam, severity: "critical" }),
    createOrReuseEscalation({ tenantId: f.tenantId, incidentId: r4.incidentId, escalationType: "second_type", urgency: "immediate", reasonCode: "urgent", riskFamily: groomFam, severity: "critical" }),
  ]);
  check("★ concurrent escalation of the same (incident,type) → ONE escalation", ec1.escalationId === ec2.escalationId && (await systemDb.childSafetyEscalation.count({ where: { tenantId: f.tenantId, incidentId: r4.incidentId, escalationType: "second_type" } })) === 1);

  console.log("\n9. escalation fail-closed + cross-tenant");
  let escXBlocked = false;
  try { await createOrReuseEscalation({ tenantId: g.tenantId, incidentId: eInc, escalationType: ChildSafetyEscalationType.UrgentInternal, urgency: "immediate", reasonCode: "urgent", riskFamily: groomFam, severity: "critical" }); }
  catch { escXBlocked = true; }
  check("★ escalating another tenant's incident is refused (fail-closed)", escXBlocked && (await escRows(g.tenantId, eInc)).length === 0);

  // ───────────────────────── INTERNAL NOTIFICATION ─────────────────────────
  console.log("\n10. internal notification — one canonical, minimized, reused");
  const nRows = await notifRows(f.tenantId, e1.escalationId);
  check("★ exactly ONE internal notification for the escalation", nRows.length === 1 && nRows[0]!.type === "child_safety_escalation" && nRows[0]!.severity === "critical");
  check("★ notification payload is MINIMIZED (coarse fields only, no raw content)", !!nRows[0] && !JSON.stringify(nRows[0]!.metadata).match(/message|transcript|content|token|secret|@[a-z]|recipient|guardian|email/i) && Object.keys(nRows[0]!.metadata as object).sort().join(",") === "escalationRef,incidentRef,reasonCode,riskFamily,severity,urgency");
  check("★ re-escalation does NOT create a 2nd notification (dedupe)", (await notifRows(f.tenantId, e1.escalationId)).length === 1);

  // ───────────────────────── ORCHESTRATED END-TO-END ─────────────────────────
  console.log("\n11. urgent WITHOUT a guardian still escalates internally");
  const bare = await seedBareFamily();
  const u1 = await sig(bare.tenantId, bare.profileId, RiskType.Sextortion, SafetySeverity.Critical);
  const ru = await interveneOnAcceptedSafetySignal({ signalId: u1.id, tenantId: bare.tenantId });
  const uInc = await findIncidentForSignal(bare.tenantId, u1.id);
  check("★ urgent + no authorized recipient → escalated + real incident, NO delivery", ru.outcome === ChildSafetyOutcome.UrgentEscalation && ru.escalated === true && !!uInc && ru.delivered === false);
  check("★ the internal escalation exists for that incident", (await escRows(bare.tenantId, uInc!)).length === 1);

  console.log("\n12. non-urgent → incident, NO escalation");
  const h = await seedAuthorizedFamily();
  const n1 = await sig(h.tenantId, h.profileId, RiskType.Cyberbullying, SafetySeverity.High); // high but not urgent
  const rn = await interveneOnAcceptedSafetySignal({ signalId: n1.id, tenantId: h.tenantId });
  const nInc = await findIncidentForSignal(h.tenantId, n1.id);
  check("★ non-urgent high → incident created, escalated === false", rn.outcome === ChildSafetyOutcome.CreateOrUpdateIncident && !!nInc && rn.escalated === false && (await escRows(h.tenantId, nInc!)).length === 0);

  // ───────────────────────── RECOVERY (canonical-record-aware) ─────────────────────────
  console.log("\n13. recovery: ledger says done but canonical record is missing → repair");
  const rec = await seedAuthorizedFamily();
  const d1 = await sig(rec.tenantId, rec.profileId, RiskType.Grooming, SafetySeverity.High);
  await interveneOnAcceptedSafetySignal({ signalId: d1.id, tenantId: rec.tenantId });
  const realInc = await findIncidentForSignal(rec.tenantId, d1.id);
  // Corrupt the ledger: point it at a bogus incidentRef while keeping status "done".
  await systemDb.childSafetyIntervention.update({ where: { safetySignalId: d1.id }, data: { incidentRef: "bogus_incident_ref", completedAt: null } });
  const rr = await interveneOnAcceptedSafetySignal({ signalId: d1.id, tenantId: rec.tenantId });
  const repaired = await systemDb.childSafetyIntervention.findUnique({ where: { safetySignalId: d1.id }, select: { incidentRef: true } });
  check("★ ledger 'done' with a missing canonical record is DETECTED + repaired to the real incident", rr.processingState === "completed" && repaired?.incidentRef === realInc && repaired?.incidentRef !== "bogus_incident_ref");
  check("★ repair did NOT create a duplicate incident/link for the signal", (await systemDb.childSafetyIncidentSignal.count({ where: { safetySignalId: d1.id } })) === 1);

  console.log("\n14. two recovery attempts converge, no duplicate side effects");
  const beforeInc = await systemDb.childSafetyIncident.count({ where: { tenantId: rec.tenantId } });
  await interveneOnAcceptedSafetySignal({ signalId: d1.id, tenantId: rec.tenantId });
  await interveneOnAcceptedSafetySignal({ signalId: d1.id, tenantId: rec.tenantId });
  check("★ repeated completed re-runs create NO new incidents", (await systemDb.childSafetyIncident.count({ where: { tenantId: rec.tenantId } })) === beforeInc);

  // ───────────────────────── PRIVACY / RLS ─────────────────────────
  console.log("\n15. privacy — the whole domain is content-free");
  const allInc = await systemDb.childSafetyIncident.findMany({ where: { tenantId: f.tenantId } });
  const allEsc = await systemDb.childSafetyEscalation.findMany({ where: { tenantId: f.tenantId } });
  const allLnk = await systemDb.childSafetyIncidentSignal.findMany({ where: { tenantId: f.tenantId } });
  const audits = await systemDb.auditLog.findMany({ where: { tenantId: f.tenantId, targetType: { in: ["child_safety_incident", "child_safety_escalation"] } }, select: { event: true, metadata: true, actorKind: true } });
  const blob = JSON.stringify({ allInc, allEsc, allLnk, audits });
  check("★ incidents/links/escalations/audit carry NO raw content", !blob.match(/message|transcript|content|secret|password|@[a-z]/i));
  check("★ all domain audit events are system actor", audits.length > 0 && audits.every((a) => a.actorKind === "system"));
  check("★ no evidence records were auto-created for the child-safety incident domain", (await systemDb.incidentEvidence.count({ where: { tenantId: f.tenantId } }).catch(() => 0)) === 0);

  console.log("\n16. tenant isolation on reads");
  check("★ cross-tenant incident read returns nothing (explicit tenantId scope)", (await getChildSafetyIncident(g.tenantId, r4.incidentId)) === null);
  check("★ cross-tenant escalation read returns nothing", (await getChildSafetyEscalation(g.tenantId, e1.escalationId)) === null);
}

main()
  .then(async () => {
    for (const id of tids) { for (const t of ["childSafetyEscalation", "childSafetyIncidentSignal", "childSafetyIncident", "notification", "childSafetyIntervention", "safetySignalDelivery", "safetyRecipientAuthorizationDecision", "safeRecipientAssessment", "guardianAuthorityRecord", "consentRecord", "safetySignal", "guardianRelationship", "auditLog", "membership", "protectedProfile"] as const) { await (systemDb as never as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[t].deleteMany({ where: { tenantId: id } }).catch(() => {}); } await systemDb.tenant.delete({ where: { id } }).catch(() => {}); }
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS-C15C incident/escalation domain: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error("FATAL:", e?.stack ?? e?.message ?? e); for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {}); process.exit(1); });
