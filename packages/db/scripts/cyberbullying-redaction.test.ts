/**
 * C12 — Redaction, four-eyes approval & export prep (local DB). Pure transformer,
 * draft workflow, four-eyes (author≠approver), redacted immutable snapshot,
 * export authorization dual control, package manifest + immutability, hashes,
 * permissions, and privacy. Run: pnpm cyberbullying-redaction:test
 */
import {
  systemDb, withTenant,
  createIncidentFromManualReport, assignReviewer, addIncidentParticipant,
  createCyberbullyingComplianceReport,
  createComplianceRedactionDraft, addComplianceRedactionRule, removeComplianceRedactionRule,
  previewComplianceRedaction, submitComplianceRedactionDraft, cancelComplianceRedactionDraft, approveComplianceRedactionDraft, rejectComplianceRedactionDraft,
  requestComplianceExportAuthorization, approveComplianceExportAuthorization, cancelComplianceExportAuthorization,
  prepareComplianceExportPackageManifest, verifyComplianceExportPackageManifest,
  RedactionError,
} from "../src/index";
import {
  ComplianceReportType, ComplianceVerificationStatus as VS, RedactionState, RedactionAction, RedactionReasonCode,
  RedactionRejectionReason, ExportPurposeCode, RecipientType, ReplacementMarker,
  IncidentParticipantRole, applyComplianceRedactions, computeUnresolvedSensitiveFields, maskIdentifier, canonicalStringify, buildRedactionRuleSetHashInput,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function reject(l: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) { const c = (e as { code?: string }).code; check(l, code ? c === code : true, `code=${c}`); }
}

const sfx = `cbrd_${process.pid}`;
const tA = `tenA_${sfx}`, tB = `tenB_${sfx}`;
const owner = { tenantId: tA, userId: "u_owner", role: "owner" };
const admin = { tenantId: tA, userId: "u_admin", role: "admin" };
const reviewer = { tenantId: tA, userId: "u_rev", role: "reviewer" };
const reviewer2 = { tenantId: tA, userId: "u_rev2", role: "reviewer" };
const viewer = { tenantId: tA, userId: "u_view", role: "viewer" };
const ownerB = { tenantId: tB, userId: "u_ownerB", role: "owner" };
const u = 0;
const SECRET_NOTE = `RNOTE-SECRET-${sfx}`;

async function mkMember(a: { tenantId: string; userId: string; role: string }) {
  await systemDb.user.upsert({ where: { id: a.userId }, update: {}, create: { id: a.userId, email: `${a.userId}-${sfx}@t.local` } });
  await systemDb.membership.upsert({ where: { userId_tenantId: { userId: a.userId, tenantId: a.tenantId } }, update: { role: a.role as never }, create: { userId: a.userId, tenantId: a.tenantId, role: a.role as never } });
}

async function main() {
  for (const id of [tA, tB]) await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });
  for (const a of [owner, admin, reviewer, reviewer2, viewer, ownerB]) await mkMember(a);

  const subj = await withTenant(tA, (db) => db.protectedSubject.create({ data: { tenantId: tA, publicIdentifier: `s-${sfx}`, displayLabel: `Alex-${sfx}`, subjectType: "individual" } }));
  const { incidentId } = await createIncidentFromManualReport(owner, { protectedSubjectId: subj.id, summary: "case for redaction" });
  await assignReviewer(owner, incidentId, reviewer.userId);
  await addIncidentParticipant(owner, incidentId, { role: IncidentParticipantRole.Reviewer, userId: reviewer2.userId });
  const source = await createCyberbullyingComplianceReport(owner, incidentId, { reportType: ComplianceReportType.CaseSummary });

  // === A. Pure transformer ================================================
  const payloadRow = await withTenant(tA, (db) => db.complianceReportSnapshot.findFirst({ where: { id: source.reportId }, select: { snapshotPayload: true } }));
  const srcPayload = payloadRow!.snapshotPayload as never;
  const t1 = applyComplianceRedactions(srcPayload, [{ fieldPath: "protectedSubject.displayLabel", action: RedactionAction.ReplaceWithLabel, reasonCode: RedactionReasonCode.MinorProtection, replacementMarkerKey: ReplacementMarker.MinorData, order: 0 }]);
  check("A: transformer replaces value with marker", (t1.payload.protectedSubject as { displayLabel: string }).displayLabel === ReplacementMarker.MinorData);
  check("A: transformer does NOT mutate source", (srcPayload as { protectedSubject: { displayLabel: string } }).protectedSubject.displayLabel === `Alex-${sfx}`);
  check("A: transformer deterministic (canonical equal)", canonicalStringify(t1.payload) === canonicalStringify(applyComplianceRedactions(srcPayload, [{ fieldPath: "protectedSubject.displayLabel", action: RedactionAction.ReplaceWithLabel, reasonCode: RedactionReasonCode.MinorProtection, replacementMarkerKey: ReplacementMarker.MinorData, order: 0 }]).payload));
  check("A: mask is deterministic + non-reversible", maskIdentifier("abcdef123456") === "abcd••••3456" && maskIdentifier("abcdef123456") === maskIdentifier("abcdef123456"));
  check("A: unresolved highly-sensitive detected when uncovered", computeUnresolvedSensitiveFields(srcPayload, []).highlySensitive.includes("protectedSubject.displayLabel"));
  check("A: covered field is resolved", computeUnresolvedSensitiveFields(srcPayload, ["protectedSubject.displayLabel"]).highlySensitive.length === 0);

  // === B. Draft workflow ==================================================
  const d = await createComplianceRedactionDraft(reviewer, source.reportId);
  check("B: draft created (draft status)", d.status === "draft");
  await reject("B: invalid field path rejected", () => addComplianceRedactionRule(reviewer, d.draftId, { fieldPath: "incident.secret", action: RedactionAction.Remove, reasonCode: RedactionReasonCode.PersonalData }), "invalid_field");
  await reject("B: disallowed action rejected", () => addComplianceRedactionRule(reviewer, d.draftId, { fieldPath: "detections[*].confidence", action: RedactionAction.MaskIdentifier, reasonCode: RedactionReasonCode.DataMinimization }), "invalid_action");
  await reject("B: OTHER reason without note rejected", () => addComplianceRedactionRule(reviewer, d.draftId, { fieldPath: "protectedSubject.displayLabel", action: RedactionAction.Remove, reasonCode: RedactionReasonCode.Other }), "missing_note");
  await reject("B: submit fails while highly-sensitive unresolved", () => submitComplianceRedactionDraft(reviewer, d.draftId), "unresolved_sensitive");
  const rule = await addComplianceRedactionRule(reviewer, d.draftId, { fieldPath: "protectedSubject.displayLabel", action: RedactionAction.ReplaceWithLabel, reasonCode: RedactionReasonCode.MinorProtection, replacementMarkerKey: ReplacementMarker.MinorData });
  await addComplianceRedactionRule(reviewer, d.draftId, { fieldPath: "assignments.primaryReviewerUserId", action: RedactionAction.MaskIdentifier, reasonCode: RedactionReasonCode.InternalSecurityData });
  const preview = await previewComplianceRedaction(reviewer, d.draftId);
  check("B: preview returns diff + no unresolved highly-sensitive", preview.isPreview && preview.unresolvedHighlySensitive.length === 0 && preview.diff.replacedCount === 1);
  await removeComplianceRedactionRule(reviewer, d.draftId, rule.ruleId);
  await reject("B: submit fails again after removing the covering rule", () => submitComplianceRedactionDraft(reviewer, d.draftId), "unresolved_sensitive");
  await addComplianceRedactionRule(reviewer, d.draftId, { fieldPath: "protectedSubject.displayLabel", action: RedactionAction.ReplaceWithLabel, reasonCode: RedactionReasonCode.MinorProtection, replacementMarkerKey: ReplacementMarker.MinorData });
  await submitComplianceRedactionDraft(reviewer, d.draftId);
  check("B: draft submitted", (await withTenant(tA, (db) => db.complianceRedactionDraft.findFirst({ where: { id: d.draftId }, select: { status: true } })))?.status === "submitted");
  await reject("B: editing a submitted draft rejected", () => addComplianceRedactionRule(reviewer, d.draftId, { fieldPath: "detections[*].confidence", action: RedactionAction.Remove, reasonCode: RedactionReasonCode.DataMinimization }), "invalid_status");

  // === C. Four-eyes approval ==============================================
  await reject("C: reviewer author (no approve perm) blocked at permission", () => approveComplianceRedactionDraft(reviewer, d.draftId), "forbidden");
  await reject("C: reviewer without approve permission cannot approve", () => approveComplianceRedactionDraft(reviewer2, d.draftId), "forbidden");
  // Self-approval blocked even for a user WITH approve permission (four-eyes core).
  const dSelf = await createComplianceRedactionDraft(admin, source.reportId);
  await addComplianceRedactionRule(admin, dSelf.draftId, { fieldPath: "protectedSubject.displayLabel", action: RedactionAction.ReplaceWithLabel, reasonCode: RedactionReasonCode.MinorProtection, replacementMarkerKey: ReplacementMarker.MinorData });
  await submitComplianceRedactionDraft(admin, dSelf.draftId);
  await reject("C: admin CANNOT approve their OWN submitted draft (self_approval)", () => approveComplianceRedactionDraft(admin, dSelf.draftId), "self_approval");
  await cancelComplianceRedactionDraft(admin, dSelf.draftId);
  const approval = await approveComplianceRedactionDraft(admin, d.draftId);
  check("C: admin approves → produces a redacted snapshot", !!approval.producedReportId && approval.version > source.version);
  const redacted = await withTenant(tA, (db) => db.complianceReportSnapshot.findFirst({ where: { id: approval.producedReportId }, select: { redactionState: true, sourceReportId: true, sourceSnapshotHash: true, redactionDraftId: true, redactionRuleSetHash: true, approvedByUserId: true, snapshotPayload: true } }));
  check("C: redacted snapshot has provenance", redacted?.redactionState === RedactionState.Redacted && redacted?.sourceReportId === source.reportId && redacted?.redactionDraftId === d.draftId && redacted?.approvedByUserId === admin.userId && !!redacted?.redactionRuleSetHash);
  check("C: redacted value replaced with marker", (redacted!.snapshotPayload as { protectedSubject: { displayLabel: string } }).protectedSubject.displayLabel === ReplacementMarker.MinorData);
  check("C: SOURCE snapshot unchanged", (await withTenant(tA, (db) => db.complianceReportSnapshot.findFirst({ where: { id: source.reportId }, select: { snapshotPayload: true } })).then((r) => (r!.snapshotPayload as { protectedSubject: { displayLabel: string } }).protectedSubject.displayLabel)) === `Alex-${sfx}`);
  const replay = await approveComplianceRedactionDraft(admin, d.draftId);
  check("C: approve replay is idempotent", replay.producedReportId === approval.producedReportId && replay.duplicate === true);

  // === F. Rule set hash determinism =======================================
  check("F: rule set hash input deterministic + excludes notes", canonicalStringify(buildRedactionRuleSetHashInput({ sourceReportId: "r", sourceSnapshotHash: "h", draftRevision: 1, rules: [{ fieldPath: "a", action: RedactionAction.Keep, reasonCode: RedactionReasonCode.Other, order: 0 }] })) === canonicalStringify(buildRedactionRuleSetHashInput({ sourceReportId: "r", sourceSnapshotHash: "h", draftRevision: 1, rules: [{ fieldPath: "a", action: RedactionAction.Keep, reasonCode: RedactionReasonCode.Other, order: 0 }] })) && !canonicalStringify(buildRedactionRuleSetHashInput({ sourceReportId: "r", sourceSnapshotHash: "h", draftRevision: 1, rules: [{ fieldPath: "a", action: RedactionAction.Keep, reasonCode: RedactionReasonCode.Other, order: 0 }] })).includes("reasonNote"));

  // === D. Reject workflow =================================================
  const d2 = await createComplianceRedactionDraft(reviewer, source.reportId);
  await addComplianceRedactionRule(reviewer, d2.draftId, { fieldPath: "protectedSubject.displayLabel", action: RedactionAction.Remove, reasonCode: RedactionReasonCode.DataMinimization });
  await submitComplianceRedactionDraft(reviewer, d2.draftId);
  await reject("D: author cannot reject own draft", () => rejectComplianceRedactionDraft(reviewer, d2.draftId, RedactionRejectionReason.IncompleteRedaction), "forbidden"); // reviewer lacks approve perm
  await rejectComplianceRedactionDraft(admin, d2.draftId, RedactionRejectionReason.ExcessiveRedaction);
  check("D: rejected terminal", (await withTenant(tA, (db) => db.complianceRedactionDraft.findFirst({ where: { id: d2.draftId }, select: { status: true } })))?.status === "rejected");
  await reject("D: approving a rejected draft rejected", () => approveComplianceRedactionDraft(admin, d2.draftId), "invalid_status");

  // === G. Export authorization (dual control) =============================
  const redactedReportId = approval.producedReportId;
  await reject("G: cannot authorize export of a non-redacted report", () => requestComplianceExportAuthorization(reviewer, source.reportId, { purposeCode: ExportPurposeCode.LegalReview, recipientType: RecipientType.LegalCounsel }), "report_not_redacted");
  const auth = await requestComplianceExportAuthorization(reviewer, redactedReportId, { purposeCode: ExportPurposeCode.Other, recipientType: RecipientType.LawEnforcement, recipientLabel: "Regional unit", purposeNote: SECRET_NOTE });
  check("G: authorization requested (future expiry)", auth.status === "requested" && new Date(auth.expiresAt).getTime() > Date.now());
  await reject("G: requester cannot approve own authorization (self_approval)", () => approveComplianceExportAuthorization(reviewer.role === "reviewer" ? { ...reviewer, role: "admin" } : reviewer, auth.authorizationId), "self_approval");
  await approveComplianceExportAuthorization(admin, auth.authorizationId);
  check("G: authorization approved by a different user", (await withTenant(tA, (db) => db.complianceExportAuthorization.findFirst({ where: { id: auth.authorizationId }, select: { status: true, approvedByUserId: true } })))?.approvedByUserId === admin.userId);

  // === H. Package manifest + immutability =================================
  const manifest = await prepareComplianceExportPackageManifest(admin, auth.authorizationId, { idempotencyKey: `pk-${sfx}` });
  check("H: manifest prepared + verifiable", manifest.status === "prepared" && manifest.verification === VS.Verified && (await verifyComplianceExportPackageManifest(admin, manifest.manifestId)) === VS.Verified);
  const mPayload = await withTenant(tA, (db) => db.complianceExportPackageManifest.findFirst({ where: { id: manifest.manifestId }, select: { manifestPayload: true } }));
  const mDump = JSON.stringify(mPayload!.manifestPayload);
  check("H: manifest payload has NO file/path/url/recipient-label/secret note", !/filePath|downloadUrl|\.zip|\.pdf/i.test(mDump) && !mDump.includes("Regional unit") && !mDump.includes(SECRET_NOTE));
  await reject("H: manifest UPDATE rejected (privilege)", () => withTenant(tA, (db) => db.complianceExportPackageManifest.update({ where: { id: manifest.manifestId }, data: { manifestHash: "x" } })));
  await reject("H: manifest DELETE rejected (privilege)", () => withTenant(tA, (db) => db.complianceExportPackageManifest.delete({ where: { id: manifest.manifestId } })));
  const replayM = await prepareComplianceExportPackageManifest(admin, auth.authorizationId, { idempotencyKey: `pk-${sfx}` });
  check("H: manifest idempotent replay", replayM.manifestId === manifest.manifestId && replayM.duplicate === true);

  // === I. Permissions + cross-tenant ======================================
  await reject("I: viewer cannot create a draft", () => createComplianceRedactionDraft(viewer, source.reportId), "forbidden");
  await reject("I: reviewer cannot approve (no approve perm — permission-first)", () => approveComplianceRedactionDraft(reviewer, d.draftId), "forbidden");
  await reject("I: cross-tenant draft create denied", () => createComplianceRedactionDraft(ownerB, source.reportId), "not_found");

  // === J. Privacy / history append-only ===================================
  const historyRows = await withTenant(tA, (db) => db.complianceApprovalHistoryEvent.findMany({ where: { tenantId: tA } }));
  const auditRows = await withTenant(tA, (db) => db.auditLog.findMany({ where: { tenantId: tA, event: { startsWith: "cyberbullying.compliance_" } } }));
  const tlRows = await withTenant(tA, (db) => db.incidentTimelineEvent.findMany({ where: { tenantId: tA, eventType: { startsWith: "compliance_" } } }));
  const allDump = JSON.stringify(historyRows) + JSON.stringify(auditRows) + JSON.stringify(tlRows) + mDump;
  check("J: confidential notes never in history/audit/timeline/manifest", !allDump.includes(SECRET_NOTE));
  check("J: history + audit record the workflow", historyRows.some((r) => r.eventType === "approved") && auditRows.some((r) => r.event === "cyberbullying.compliance_redaction.approved") && auditRows.some((r) => r.event === "cyberbullying.compliance_export.package_manifest_prepared"));
  await reject("J: history UPDATE rejected (append-only privilege)", () => withTenant(tA, (db) => db.complianceApprovalHistoryEvent.updateMany({ where: { tenantId: tA }, data: { eventType: "x" } })));

  check("cross-tenant: tenant B has no drafts/manifests", (await withTenant(tB, (db) => db.complianceRedactionDraft.count())) === 0 && (await withTenant(tB, (db) => db.complianceExportPackageManifest.count())) === 0);

  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });
  await systemDb.user.deleteMany({ where: { id: { in: [owner.userId, admin.userId, reviewer.userId, reviewer2.userId, viewer.userId, ownerB.userId] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — cyberbullying redaction/approval/export: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
