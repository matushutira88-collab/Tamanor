/**
 * Child Safety Release-Candidate END-TO-END (local DB). Proves the complete canonical workflow from a
 * content-free safety signal to a resolved incident with a completed protection plan, across every domain:
 *   signal → dedupe → correlate → severity/urgency → escalate → intervene → guardian delivery →
 *   reviewer surfacing → assign → under-review → append-only note → evidence → integrity verify →
 *   protection plan create/activate → progress actions → complete plan → resolve incident →
 *   dashboard aggregates → deterministic timeline + audit.
 * Also asserts: tenant isolation, content minimization, exactly-once / no-duplicate canonical records,
 * append-only custody, and safe concurrency at the high-risk steps.
 * Run: pnpm child-safety-e2e:test
 */
import {
  systemDb, interveneOnAcceptedSafetySignal,
  listChildSafetyIncidents, getChildSafetyIncidentDetail, assignChildSafetyIncident, setChildSafetyReviewStatus,
  addChildSafetyReviewerNote, getChildSafetyReviewerDashboard,
  createChildSafetyEvidence, verifyChildSafetyEvidenceIntegrity, listChildSafetyEvidence,
  createDraftProtectionPlan, activateProtectionPlan, completeProtectionPlan, getProtectionPlanForIncident,
  completeProtectionAction, skipProtectionAction, getProtectionPlanTimeline,
  findIncidentForSignal,
  type ReviewerActor, type EvidenceActor, type ProtectionActor,
} from "@guardora/db";
import {
  RiskType, SafetySeverity, SafetyConfidenceBand, ChildSafetyOutcome, ChildSafetyReviewStatus,
  ChildSafetyEvidenceType, GuardianRelationshipType, GuardianAuthorityLevel, WorkspaceKind, Role,
} from "@guardora/core";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sha = (b: Uint8Array) => createHash("sha256").update(Buffer.from(b)).digest("hex");

const sfx = `cse2e_${process.pid}`;
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
  return { tenantId: id, ownerUserId: uOwner, profileId };
}
const sig = (tenantId: string, profileId: string, type: string, severity: string, band = SafetyConfidenceBand.High) =>
  systemDb.safetySignal.create({ data: { tenantId, protectedProfileId: profileId, signalType: type, severity, confidenceBand: band, sourceType: "platform_partner" } });

async function main() {
  const f = await seedAuthorizedFamily();
  const actor = { tenantId: f.tenantId, userId: f.ownerUserId, role: Role.Owner };
  const rev = actor as ReviewerActor, ev = actor as EvidenceActor, pp = actor as ProtectionActor;

  // 1-7. signal → intervention (correlate + severity/urgency + escalate + intervene + guardian delivery)
  console.log("\n[1-7] signal → correlate → escalate → intervene → deliver");
  const s1 = await sig(f.tenantId, f.profileId, RiskType.Sextortion, SafetySeverity.Critical);
  const r1 = await interveneOnAcceptedSafetySignal({ signalId: s1.id, tenantId: f.tenantId });
  check("★ urgent signal → URGENT_ESCALATION + real incident + escalated + guardian delivered", r1.outcome === ChildSafetyOutcome.UrgentEscalation && !!r1.incidentId && r1.escalated === true && r1.delivered === true);
  const incidentId = r1.incidentId!;
  // 2. dedupe/idempotency — re-run does not create a second incident or delivery
  const r1b = await interveneOnAcceptedSafetySignal({ signalId: s1.id, tenantId: f.tenantId });
  check("★ replay is idempotent — same incident, no duplicate canonical incident", r1b.incidentId === incidentId && (await systemDb.childSafetyIncident.count({ where: { tenantId: f.tenantId } })) === 1);
  check("★ exactly-once escalation for the incident", (await systemDb.childSafetyEscalation.count({ where: { tenantId: f.tenantId, incidentId } })) === 1);
  check("★ exactly-once intervention ledger for the signal", (await systemDb.childSafetyIntervention.count({ where: { tenantId: f.tenantId, safetySignalId: s1.id } })) === 1);
  // a second SAME-FAMILY signal (SexualSolicitation ← same 'sexual' family as Sextortion) joins the SAME incident
  const s2 = await sig(f.tenantId, f.profileId, RiskType.SexualSolicitation, SafetySeverity.Critical);
  await interveneOnAcceptedSafetySignal({ signalId: s2.id, tenantId: f.tenantId });
  check("★ correlated same-family 2nd signal joins the SAME incident (no duplicate)", (await findIncidentForSignal(f.tenantId, s2.id)) === incidentId && (await systemDb.childSafetyIncident.count({ where: { tenantId: f.tenantId } })) === 1);

  // 8-11. reviewer surfacing → assign → under review → append-only note
  console.log("\n[8-11] reviewer workspace: surface → assign → under review → note");
  check("★ incident surfaces in the reviewer list", (await listChildSafetyIncidents(rev, {})).items.some((i) => i.id === incidentId));
  await assignChildSafetyIncident(rev, incidentId, f.ownerUserId);
  check("★ under_review transition", (await setChildSafetyReviewStatus(rev, incidentId, ChildSafetyReviewStatus.UnderReview)).status === "under_review");
  const note = await addChildSafetyReviewerNote(rev, incidentId, "E2E internal note — protected.");
  check("★ append-only note persisted; body NOT in audit", !!note.noteId && !JSON.stringify(await systemDb.auditLog.findMany({ where: { tenantId: f.tenantId, targetId: incidentId } })).includes("protected."));

  // 12-13. evidence + integrity verify + custody chain
  console.log("\n[12-13] evidence + integrity + custody");
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
  const evd = await createChildSafetyEvidence(ev, { incidentId, type: ChildSafetyEvidenceType.UploadedFile, bytes, mimeType: "image/png", label: "e2e" });
  check("★ evidence created + hash = sha256(bytes) + custody 'created'", (await systemDb.childSafetyEvidence.findUnique({ where: { id: evd.evidenceId } }))?.contentHash === sha(bytes) && (await systemDb.childSafetyEvidenceCustodyEvent.count({ where: { evidenceId: evd.evidenceId, eventType: "created" } })) === 1);
  check("★ integrity verify → verified (re-read storage matches)", (await verifyChildSafetyEvidenceIntegrity(ev, evd.evidenceId)).integrityStatus === "verified");
  check("★ evidence list exposes NO storage key", !JSON.stringify(await listChildSafetyEvidence(ev, incidentId)).includes("storageKey"));

  // 14-17. protection plan create/activate → progress actions → complete plan
  console.log("\n[14-17] protection plan: create → activate → actions → complete");
  const draft = await createDraftProtectionPlan(pp, incidentId, { fromRecommendation: true });
  check("★ draft plan created from deterministic recommendation with actions", (await getProtectionPlanForIncident(pp, incidentId))!.actions.length > 0);
  check("★ activate plan → active", (await activateProtectionPlan(pp, draft.planId)).status === "active");
  const planActions = (await getProtectionPlanForIncident(pp, incidentId))!.actions;
  await Promise.resolve();
  for (const a of planActions) { if (a.sequence % 2 === 0) await skipProtectionAction(pp, a.id); else await completeProtectionAction(pp, a.id, "done"); }
  check("★ complete plan once all actions resolved (fail-closed gate satisfied)", (await completeProtectionPlan(pp, draft.planId, "resolved")).status === "completed");

  // 18. resolve incident
  console.log("\n[18] resolve incident");
  check("★ incident resolved", (await setChildSafetyReviewStatus(rev, incidentId, ChildSafetyReviewStatus.Resolved)).status === "resolved");

  // 19. dashboard aggregates
  console.log("\n[19] dashboard aggregates");
  const dash = await getChildSafetyReviewerDashboard(rev);
  check("★ reviewer dashboard aggregates computed", typeof dash.openIncidents === "number" && dash.escalated >= 1 && dash.resolvedToday >= 1);

  // 20. deterministic timeline + audit history
  console.log("\n[20] deterministic timeline + audit");
  const detail = await getChildSafetyIncidentDetail(rev, incidentId);
  check("★ incident timeline chronological + content-free", detail.timeline.every((e, i) => i === 0 || Date.parse(detail.timeline[i - 1]!.at) <= Date.parse(e.at)) && !JSON.stringify(detail.timeline).match(/protected\.|transcript|message body/i));
  check("★ plan timeline deterministic", JSON.stringify(await getProtectionPlanTimeline(pp, draft.planId)) === JSON.stringify(await getProtectionPlanTimeline(pp, draft.planId)));
  const audits = await systemDb.auditLog.findMany({ where: { tenantId: f.tenantId } });
  check("★ audit is content-free (no note body / raw content)", !JSON.stringify(audits).match(/protected\.|transcript|secret|@[a-z].*\.local.*message/i));

  // TENANT ISOLATION — a second tenant sees none of this
  console.log("\n[iso] tenant isolation");
  const g = await seedAuthorizedFamily();
  const gRev = { tenantId: g.tenantId, userId: g.ownerUserId, role: Role.Owner } as ReviewerActor;
  check("★ cross-tenant incident list excludes tenant-f incident", !(await listChildSafetyIncidents(gRev, {})).items.some((i) => i.id === incidentId));
  let denied = false; try { await getChildSafetyIncidentDetail(gRev, incidentId); } catch { denied = true; }
  check("★ cross-tenant incident detail → not found (fail-closed)", denied);

  // CONCURRENCY at a high-risk step — concurrent resolve/reopen guarded (stale transition fails closed)
  console.log("\n[conc] concurrent status transition is guarded");
  const cf = await seedAuthorizedFamily();
  const cs = await sig(cf.tenantId, cf.profileId, RiskType.Grooming, SafetySeverity.High);
  const cr = await interveneOnAcceptedSafetySignal({ signalId: cs.id, tenantId: cf.tenantId });
  const cActor = { tenantId: cf.tenantId, userId: cf.ownerUserId, role: Role.Owner } as ReviewerActor;
  const races = await Promise.allSettled(Array.from({ length: 4 }, () => setChildSafetyReviewStatus(cActor, cr.incidentId!, ChildSafetyReviewStatus.UnderReview)));
  check("★ concurrent identical transition → exactly ONE succeeds (others fail closed)", races.filter((x) => x.status === "fulfilled").length === 1);
}

main()
  .then(async () => {
    for (const id of tids) { for (const t of ["childSafetyProtectionActionEvent", "childSafetyProtectionAction", "childSafetyProtectionPlan", "childSafetyEvidenceCustodyEvent", "childSafetyEvidence", "childSafetyReviewEvent", "childSafetyReviewerNote", "childSafetyEscalation", "childSafetyIncidentSignal", "childSafetyIncident", "notification", "safetySignalDelivery", "safetyRecipientAuthorizationDecision", "childSafetyIntervention", "safeRecipientAssessment", "guardianAuthorityRecord", "consentRecord", "safetySignal", "guardianRelationship", "auditLog", "membership", "protectedProfile"] as const) { await (systemDb as never as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[t].deleteMany({ where: { tenantId: id } }).catch(() => {}); } await systemDb.user.deleteMany({ where: { email: { endsWith: `_${id}@t.local` } } }).catch(() => {}); await systemDb.tenant.delete({ where: { id } }).catch(() => {}); }
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Release-Candidate E2E: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error("FATAL:", e?.stack ?? e?.message ?? e); for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {}); process.exit(1); });
