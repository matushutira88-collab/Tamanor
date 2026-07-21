import { ActorKind, Prisma } from "@prisma/client";
import {
  Permission, Role, can, CYBERBULLYING_AUDIT_EVENTS, IncidentCategory, IncidentTimelineEventType,
  ComplianceReportType, RedactionState, COMPLIANCE_SCHEMA_VERSION, ComplianceVerificationStatus, computeCanonical,
  RedactionDraftStatus, RedactionAction, RedactionReasonCode, RedactionRejectionReason, redactionReasonRequiresNote,
  ExportAuthorizationStatus, ExportPurposeCode, RecipientType, ExportPackageStatus, EXPORT_AUTHORIZATION_TTL_HOURS,
  isRedactionRejectionReason, isExportPurpose, isRecipientType,
  validateRedactionRule, applyComplianceRedactions, computeUnresolvedSensitiveFields, diffSummaryFrom,
  buildRedactionRuleSetHashInput, buildAuthorizationHashInput, buildManifestHashInput,
  type RedactionRuleSpec, type CompliancePayload, type IncidentActorContext,
} from "@guardora/core";
import { withTenant } from "./repositories";
import { computeSha256Hex } from "./evidence-integrity";
import { computeComplianceHashHex, verifyComplianceSnapshotPayload } from "./cyberbullying-compliance";

/**
 * C12 — Manual redaction, four-eyes approval & export package preparation. Every
 * write is permission-checked, tenant + incident + report scoped, transactional,
 * mirrored into append-only history, and produces a SANITIZED audit + timeline
 * event. The source snapshot is NEVER mutated. Four-eyes is enforced server-side
 * (author ≠ approver / requester ≠ approver) — UI hiding is not relied on. No source
 * values / notes / recipient PII ever reach the snapshot, timeline, audit, or manifest.
 */

type Tx = Prisma.TransactionClient;
const DOMAIN = IncidentCategory.Cyberbullying;

export type RedactionErrorCode =
  | "forbidden" | "not_found" | "invalid_status" | "invalid_field" | "invalid_action" | "invalid_reason" | "missing_note"
  | "self_approval" | "unresolved_sensitive" | "source_stale" | "report_not_redacted" | "authorization_invalid" | "expired" | "duplicate";
export class RedactionError extends Error {
  constructor(public readonly code: RedactionErrorCode) { super(`redaction: ${code}`); this.name = "RedactionError"; }
}

// --- Shared helpers ---------------------------------------------------------

async function assertIncidentScope(db: Tx, actor: IncidentActorContext, incidentId: string): Promise<void> {
  const inc = await db.incident.findFirst({ where: { id: incidentId, tenantId: actor.tenantId, domain: DOMAIN }, select: { id: true, cyberbullyingDetail: { select: { assignedReviewerUserId: true } }, participants: { where: { userId: actor.userId }, select: { id: true } } } });
  if (!inc) throw new RedactionError("not_found");
  const role = actor.role as Role;
  if (role === Role.Owner || role === Role.Admin) return;
  if (inc.participants.length === 0 && inc.cyberbullyingDetail?.assignedReviewerUserId !== actor.userId) throw new RedactionError("forbidden");
}
async function loadReport(db: Tx, tenantId: string, reportId: string) {
  const r = await db.complianceReportSnapshot.findFirst({ where: { id: reportId, tenantId }, select: { id: true, incidentId: true, reportType: true, schemaVersion: true, snapshotHash: true, previousSnapshotHash: true, redactionState: true, snapshotPayload: true } });
  if (!r) throw new RedactionError("not_found");
  return r;
}
async function history(db: Tx, actor: IncidentActorContext, incidentId: string, entityType: string, entityId: string, eventType: string, metadata: Record<string, string | number> = {}): Promise<void> {
  await db.complianceApprovalHistoryEvent.create({ data: { tenantId: actor.tenantId, incidentId, entityType, entityId, eventType, actorUserId: actor.userId, metadata: metadata as never } });
}
async function timeline(db: Tx, actor: IncidentActorContext, incidentId: string, eventType: IncidentTimelineEventType, reason?: string): Promise<void> {
  await db.incidentTimelineEvent.create({ data: { tenantId: actor.tenantId, incidentId, eventType, actorUserId: actor.userId, reason: reason ?? null } });
}
async function audit(db: Tx, actor: IncidentActorContext, event: string, entityType: string, entityId: string, metadata: Record<string, string | number>): Promise<void> {
  await db.auditLog.create({ data: { tenantId: actor.tenantId, event, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: entityType, targetId: entityId, metadata: metadata as never } });
}

async function loadRuleSpecs(db: Tx, tenantId: string, draftId: string): Promise<{ specs: RedactionRuleSpec[]; paths: string[] }> {
  const rules = await db.complianceRedactionRule.findMany({ where: { draftId, tenantId }, orderBy: { order: "asc" }, select: { fieldPath: true, action: true, reasonCode: true, replacementMarkerKey: true, order: true } });
  return {
    specs: rules.map((r) => ({ fieldPath: r.fieldPath, action: r.action as RedactionAction, reasonCode: r.reasonCode as RedactionReasonCode, replacementMarkerKey: r.replacementMarkerKey as never, order: r.order })),
    paths: rules.map((r) => r.fieldPath),
  };
}

// --- Draft operations -------------------------------------------------------

export interface DraftVM { draftId: string; incidentId: string; sourceReportId: string; status: string; revision: number; createdByUserId: string; producedReportId: string | null }
const DRAFT_SELECT = { id: true, incidentId: true, sourceReportId: true, status: true, revision: true, createdByUserId: true, submittedByUserId: true, producedReportId: true } as const;
function draftVM(d: { id: string; incidentId: string; sourceReportId: string; status: string; revision: number; createdByUserId: string; producedReportId: string | null }): DraftVM {
  return { draftId: d.id, incidentId: d.incidentId, sourceReportId: d.sourceReportId, status: d.status, revision: d.revision, createdByUserId: d.createdByUserId, producedReportId: d.producedReportId };
}

export async function createComplianceRedactionDraft(actor: IncidentActorContext, sourceReportId: string, opts: { idempotencyKey?: string | null } = {}): Promise<DraftVM & { duplicate?: boolean }> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceRedact)) throw new RedactionError("forbidden");
  const key = opts.idempotencyKey || null;
  return withTenant(actor.tenantId, async (db) => {
    const report = await loadReport(db, actor.tenantId, sourceReportId);
    await assertIncidentScope(db, actor, report.incidentId);
    if (report.redactionState === RedactionState.Redacted) throw new RedactionError("report_not_redacted"); // can't redact a redacted snapshot
    if (key) {
      const existing = await db.complianceRedactionDraft.findFirst({ where: { tenantId: actor.tenantId, createdByUserId: actor.userId, sourceReportId, idempotencyKey: key }, select: DRAFT_SELECT });
      if (existing) { await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.complianceIdempotentReplay, "draft", existing.id, { status: existing.status }); return { ...draftVM(existing), duplicate: true }; }
    }
    const draft = await db.complianceRedactionDraft.create({ data: { tenantId: actor.tenantId, incidentId: report.incidentId, sourceReportId, status: RedactionDraftStatus.Draft, createdByUserId: actor.userId, idempotencyKey: key }, select: DRAFT_SELECT });
    await history(db, actor, report.incidentId, "draft", draft.id, "draft_created", { sourceReportId });
    await timeline(db, actor, report.incidentId, IncidentTimelineEventType.ComplianceRedactionDraftCreated, `draft:${draft.id}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.redactionDraftCreated, "draft", draft.id, { sourceReportId });
    return { ...draftVM(draft), duplicate: false };
  });
}

async function loadEditableDraft(db: Tx, actor: IncidentActorContext, draftId: string) {
  const d = await db.complianceRedactionDraft.findFirst({ where: { id: draftId, tenantId: actor.tenantId }, select: { id: true, incidentId: true, sourceReportId: true, status: true, createdByUserId: true, submittedByUserId: true, revision: true } });
  if (!d) throw new RedactionError("not_found");
  await assertIncidentScope(db, actor, d.incidentId);
  return d;
}

export async function addComplianceRedactionRule(actor: IncidentActorContext, draftId: string, input: { fieldPath: string; action: string; reasonCode: string; reasonNote?: string | null; replacementMarkerKey?: string | null; order?: number }): Promise<{ ruleId: string }> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceRedact)) throw new RedactionError("forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const draft = await loadEditableDraft(db, actor, draftId);
    if (draft.status !== RedactionDraftStatus.Draft) throw new RedactionError("invalid_status");
    const report = await loadReport(db, actor.tenantId, draft.sourceReportId);
    const err = validateRedactionRule({ fieldPath: input.fieldPath, action: input.action, reasonCode: input.reasonCode, reasonNote: input.reasonNote, reportType: report.reportType as ComplianceReportType, schemaVersion: report.schemaVersion });
    if (err) throw new RedactionError(err === "unknown_field" ? "invalid_field" : err === "action_not_allowed" || err === "required_field_remove" ? "invalid_action" : err === "missing_note" ? "missing_note" : "invalid_reason");
    const count = await db.complianceRedactionRule.count({ where: { draftId, tenantId: actor.tenantId } });
    const rule = await db.complianceRedactionRule.create({ data: { tenantId: actor.tenantId, draftId, fieldPath: input.fieldPath, action: input.action, reasonCode: input.reasonCode, reasonNote: redactionReasonRequiresNote(input.reasonCode as RedactionReasonCode) ? (input.reasonNote?.trim() || null) : null, replacementMarkerKey: input.replacementMarkerKey || null, order: input.order ?? count, createdByUserId: actor.userId } });
    await history(db, actor, draft.incidentId, "draft", draftId, "rule_added", { fieldPath: input.fieldPath, action: input.action, reasonCode: input.reasonCode });
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.redactionRuleAdded, "draft", draftId, { fieldPath: input.fieldPath, action: input.action, reasonCode: input.reasonCode });
    return { ruleId: rule.id };
  });
}

export async function removeComplianceRedactionRule(actor: IncidentActorContext, draftId: string, ruleId: string): Promise<void> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceRedact)) throw new RedactionError("forbidden");
  await withTenant(actor.tenantId, async (db) => {
    const draft = await loadEditableDraft(db, actor, draftId);
    if (draft.status !== RedactionDraftStatus.Draft) throw new RedactionError("invalid_status");
    const rule = await db.complianceRedactionRule.findFirst({ where: { id: ruleId, draftId, tenantId: actor.tenantId }, select: { id: true } });
    if (!rule) throw new RedactionError("not_found");
    await db.complianceRedactionRule.delete({ where: { id: ruleId } });
    await history(db, actor, draft.incidentId, "draft", draftId, "rule_removed", { ruleId });
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.redactionRuleRemoved, "draft", draftId, { ruleId });
  });
}

export interface RedactionPreview { isPreview: true; diff: ReturnType<typeof diffSummaryFrom>; unresolvedHighlySensitive: string[]; unresolvedSensitive: string[] }
export async function previewComplianceRedaction(actor: IncidentActorContext, draftId: string): Promise<RedactionPreview> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceRedact)) throw new RedactionError("forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const draft = await loadEditableDraft(db, actor, draftId);
    const report = await loadReport(db, actor.tenantId, draft.sourceReportId);
    const { specs, paths } = await loadRuleSpecs(db, actor.tenantId, draftId);
    const source = report.snapshotPayload as unknown as CompliancePayload;
    const { summary } = applyComplianceRedactions(source, specs); // preview only — nothing stored
    const unresolved = computeUnresolvedSensitiveFields(source, paths);
    return { isPreview: true, diff: diffSummaryFrom(summary, unresolved.highlySensitive.length + unresolved.sensitive.length), unresolvedHighlySensitive: unresolved.highlySensitive, unresolvedSensitive: unresolved.sensitive };
  });
}

export async function submitComplianceRedactionDraft(actor: IncidentActorContext, draftId: string): Promise<DraftVM> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceRedact)) throw new RedactionError("forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const draft = await loadEditableDraft(db, actor, draftId);
    if (draft.status !== RedactionDraftStatus.Draft) throw new RedactionError("invalid_status");
    const report = await loadReport(db, actor.tenantId, draft.sourceReportId);
    const { paths } = await loadRuleSpecs(db, actor.tenantId, draftId);
    const unresolved = computeUnresolvedSensitiveFields(report.snapshotPayload as unknown as CompliancePayload, paths);
    if (unresolved.highlySensitive.length > 0) throw new RedactionError("unresolved_sensitive"); // must resolve highly-sensitive before submit
    const updated = await db.complianceRedactionDraft.update({ where: { id: draftId }, data: { status: RedactionDraftStatus.Submitted, submittedByUserId: actor.userId, submittedAt: new Date() }, select: DRAFT_SELECT });
    await history(db, actor, draft.incidentId, "draft", draftId, "submitted", {});
    await timeline(db, actor, draft.incidentId, IncidentTimelineEventType.ComplianceRedactionSubmitted, `draft:${draftId}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.redactionSubmitted, "draft", draftId, {});
    return draftVM(updated);
  });
}

export async function cancelComplianceRedactionDraft(actor: IncidentActorContext, draftId: string): Promise<void> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceRedact)) throw new RedactionError("forbidden");
  await withTenant(actor.tenantId, async (db) => {
    const draft = await loadEditableDraft(db, actor, draftId);
    if (draft.status === RedactionDraftStatus.Approved || draft.status === RedactionDraftStatus.Cancelled) throw new RedactionError("invalid_status");
    await db.complianceRedactionDraft.update({ where: { id: draftId }, data: { status: RedactionDraftStatus.Cancelled } });
    await history(db, actor, draft.incidentId, "draft", draftId, "cancelled", {});
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.redactionDraftCancelled, "draft", draftId, {});
  });
}

// --- Four-eyes approval / rejection -----------------------------------------

export async function rejectComplianceRedactionDraft(actor: IncidentActorContext, draftId: string, reasonCode: string): Promise<void> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceApprove)) throw new RedactionError("forbidden");
  if (!isRedactionRejectionReason(reasonCode)) throw new RedactionError("invalid_reason");
  await withTenant(actor.tenantId, async (db) => {
    const draft = await loadEditableDraft(db, actor, draftId);
    if (draft.status !== RedactionDraftStatus.Submitted) throw new RedactionError("invalid_status");
    if (draft.createdByUserId === actor.userId || draft.submittedByUserId === actor.userId) throw new RedactionError("self_approval");
    await db.complianceRedactionDraft.update({ where: { id: draftId }, data: { status: RedactionDraftStatus.Rejected, rejectedByUserId: actor.userId, rejectedAt: new Date(), rejectionReasonCode: reasonCode } });
    await history(db, actor, draft.incidentId, "draft", draftId, "rejected", { reasonCode });
    await timeline(db, actor, draft.incidentId, IncidentTimelineEventType.ComplianceRedactionRejected, `draft:${draftId}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.redactionRejected, "draft", draftId, { reasonCode });
  });
}

export interface ApprovalResult { draftId: string; producedReportId: string; version: number; snapshotHash: string; ruleSetHash: string; potentiallyStale: boolean; duplicate?: boolean }

/** Four-eyes approve: re-validates, re-checks unresolved sensitive, transforms, and
 *  creates a NEW immutable REDACTED snapshot — all in ONE transaction. */
export async function approveComplianceRedactionDraft(actor: IncidentActorContext, draftId: string): Promise<ApprovalResult> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceApprove)) throw new RedactionError("forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const draft = await db.complianceRedactionDraft.findFirst({ where: { id: draftId, tenantId: actor.tenantId }, select: { id: true, incidentId: true, sourceReportId: true, status: true, revision: true, createdByUserId: true, submittedByUserId: true, producedReportId: true } });
    if (!draft) throw new RedactionError("not_found");
    await assertIncidentScope(db, actor, draft.incidentId);
    // Idempotent replay — an already-approved draft returns its produced snapshot.
    if (draft.status === RedactionDraftStatus.Approved && draft.producedReportId) {
      const prod = await db.complianceReportSnapshot.findFirst({ where: { id: draft.producedReportId, tenantId: actor.tenantId }, select: { version: true, snapshotHash: true, redactionRuleSetHash: true } });
      return { draftId, producedReportId: draft.producedReportId, version: prod?.version ?? 0, snapshotHash: prod?.snapshotHash ?? "", ruleSetHash: prod?.redactionRuleSetHash ?? "", potentiallyStale: false, duplicate: true };
    }
    if (draft.status !== RedactionDraftStatus.Submitted) throw new RedactionError("invalid_status");
    // FOUR-EYES — the author/submitter can NEVER approve their own draft (server-enforced).
    if (draft.createdByUserId === actor.userId || draft.submittedByUserId === actor.userId) throw new RedactionError("self_approval");

    // Re-read the source snapshot + staleness checks.
    const report = await loadReport(db, actor.tenantId, draft.sourceReportId);
    if (verifyComplianceSnapshotPayload(report.snapshotPayload as unknown as CompliancePayload, report.snapshotHash, report.previousSnapshotHash, report.schemaVersion) !== ComplianceVerificationStatus.Verified) throw new RedactionError("source_stale");
    const newerExists = await db.complianceReportSnapshot.findFirst({ where: { tenantId: actor.tenantId, incidentId: report.incidentId, reportType: report.reportType, version: { gt: (await db.complianceReportSnapshot.findFirst({ where: { id: report.id }, select: { version: true } }))!.version } }, select: { id: true } });
    const potentiallyStale = !!newerExists;

    // Re-validate rules + re-check unresolved sensitive.
    const { specs, paths } = await loadRuleSpecs(db, actor.tenantId, draftId);
    for (const s of specs) { const e = validateRedactionRule({ fieldPath: s.fieldPath, action: s.action, reasonCode: s.reasonCode, reportType: report.reportType as ComplianceReportType, schemaVersion: report.schemaVersion }); if (e) throw new RedactionError("invalid_field"); }
    if (computeUnresolvedSensitiveFields(report.snapshotPayload as unknown as CompliancePayload, paths).highlySensitive.length > 0) throw new RedactionError("unresolved_sensitive");

    // Transform + provenance.
    const { payload: transformed, summary } = applyComplianceRedactions(report.snapshotPayload as unknown as CompliancePayload, specs);
    const ruleSetHash = computeSha256Hex(computeCanonical(buildRedactionRuleSetHashInput({ sourceReportId: report.id, sourceSnapshotHash: report.snapshotHash, draftRevision: draft.revision, rules: specs })));
    // New immutable REDACTED snapshot — continues the incident+reportType version chain.
    const last = await db.complianceReportSnapshot.findFirst({ where: { tenantId: actor.tenantId, incidentId: report.incidentId, reportType: report.reportType }, orderBy: { version: "desc" }, select: { version: true, snapshotHash: true } });
    const version = (last?.version ?? 0) + 1;
    const previousHash = last?.snapshotHash ?? null;
    transformed.reportMetadata.version = version;
    transformed.integrity.previousSnapshotHash = previousHash;
    const snapshotHash = computeComplianceHashHex(transformed, previousHash);
    const generatedAt = new Date();
    const produced = await db.complianceReportSnapshot.create({ data: {
      tenantId: actor.tenantId, incidentId: report.incidentId, reportType: report.reportType, version, schemaVersion: COMPLIANCE_SCHEMA_VERSION, status: "ready", redactionState: RedactionState.Redacted,
      generatedByUserId: actor.userId, generatedAt, sourceIncidentUpdatedAt: generatedAt, snapshotHash, previousSnapshotHash: previousHash, snapshotPayload: transformed as never,
      sourceReportId: report.id, sourceSnapshotHash: report.snapshotHash, redactionDraftId: draftId, redactionRuleSetHash: ruleSetHash, approvedByUserId: actor.userId, approvedAt: generatedAt, redactionSummary: summary as never,
    }, select: { id: true } });

    await db.complianceRedactionDraft.update({ where: { id: draftId }, data: { status: RedactionDraftStatus.Approved, approvedByUserId: actor.userId, approvedAt: generatedAt, producedReportId: produced.id } });
    await history(db, actor, report.incidentId, "draft", draftId, "approved", { producedReportId: produced.id, ruleCount: specs.length });
    await history(db, actor, report.incidentId, "draft", draftId, "snapshot_created", { producedReportId: produced.id, version });
    await timeline(db, actor, report.incidentId, IncidentTimelineEventType.ComplianceRedactionApproved, `draft:${draftId}`);
    await timeline(db, actor, report.incidentId, IncidentTimelineEventType.ComplianceRedactedSnapshotCreated, `report:${produced.id}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.redactionApproved, "draft", draftId, { producedReportId: produced.id, ruleCount: specs.length });
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.redactionSnapshotCreated, "compliance_report", produced.id, { version, reportType: report.reportType });
    return { draftId, producedReportId: produced.id, version, snapshotHash, ruleSetHash, potentiallyStale, duplicate: false };
  });
}

// --- Export authorization (dual control) ------------------------------------

export interface AuthorizationVM { authorizationId: string; incidentId: string; reportId: string; status: string; purposeCode: string; recipientType: string; requestedByUserId: string; approvedByUserId: string | null; expiresAt: string }
const AUTH_SELECT = { id: true, incidentId: true, reportId: true, status: true, purposeCode: true, recipientType: true, requestedByUserId: true, approvedByUserId: true, expiresAt: true, recipientLabel: true, requestedAt: true, approvedAt: true } as const;
function authVM(a: { id: string; incidentId: string; reportId: string; status: string; purposeCode: string; recipientType: string; requestedByUserId: string; approvedByUserId: string | null; expiresAt: Date }): AuthorizationVM {
  return { authorizationId: a.id, incidentId: a.incidentId, reportId: a.reportId, status: a.status, purposeCode: a.purposeCode, recipientType: a.recipientType, requestedByUserId: a.requestedByUserId, approvedByUserId: a.approvedByUserId, expiresAt: a.expiresAt.toISOString() };
}

export async function requestComplianceExportAuthorization(actor: IncidentActorContext, reportId: string, input: { purposeCode: string; recipientType: string; recipientLabel?: string | null; purposeNote?: string | null; idempotencyKey?: string | null }): Promise<AuthorizationVM & { duplicate?: boolean }> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceExportAuthorize) && !can(actor.role as Role, Permission.CyberbullyingComplianceRedact)) throw new RedactionError("forbidden");
  if (!isExportPurpose(input.purposeCode) || !isRecipientType(input.recipientType)) throw new RedactionError("invalid_reason");
  const key = input.idempotencyKey || null;
  return withTenant(actor.tenantId, async (db) => {
    const report = await loadReport(db, actor.tenantId, reportId);
    await assertIncidentScope(db, actor, report.incidentId);
    if (report.redactionState !== RedactionState.Redacted) throw new RedactionError("report_not_redacted");
    if (key) {
      const ex = await db.complianceExportAuthorization.findFirst({ where: { tenantId: actor.tenantId, requestedByUserId: actor.userId, reportId, idempotencyKey: key }, select: AUTH_SELECT });
      if (ex) { await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.complianceIdempotentReplay, "export_authorization", ex.id, { status: ex.status }); return { ...authVM(ex), duplicate: true }; }
    }
    const expiresAt = new Date(Date.now() + EXPORT_AUTHORIZATION_TTL_HOURS * 3_600_000);
    const a = await db.complianceExportAuthorization.create({ data: { tenantId: actor.tenantId, incidentId: report.incidentId, reportId, status: ExportAuthorizationStatus.Requested, purposeCode: input.purposeCode, purposeNote: input.purposeCode === ExportPurposeCode.Other ? (input.purposeNote?.trim() || null) : null, recipientType: input.recipientType, recipientLabel: input.recipientLabel?.trim() || null, requestedByUserId: actor.userId, expiresAt, idempotencyKey: key }, select: AUTH_SELECT });
    await history(db, actor, report.incidentId, "export_authorization", a.id, "requested", { purposeCode: input.purposeCode, recipientType: input.recipientType });
    await timeline(db, actor, report.incidentId, IncidentTimelineEventType.ComplianceExportAuthorizationRequested, `auth:${a.id}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.exportAuthorizationRequested, "export_authorization", a.id, { purposeCode: input.purposeCode, recipientType: input.recipientType });
    return { ...authVM(a), duplicate: false };
  });
}

async function loadAuth(db: Tx, actor: IncidentActorContext, authorizationId: string) {
  const a = await db.complianceExportAuthorization.findFirst({ where: { id: authorizationId, tenantId: actor.tenantId }, select: { id: true, incidentId: true, reportId: true, status: true, purposeCode: true, recipientType: true, requestedByUserId: true, approvedByUserId: true, requestedAt: true, approvedAt: true, expiresAt: true } });
  if (!a) throw new RedactionError("not_found");
  await assertIncidentScope(db, actor, a.incidentId);
  return a;
}

export async function approveComplianceExportAuthorization(actor: IncidentActorContext, authorizationId: string): Promise<void> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceExportAuthorize)) throw new RedactionError("forbidden");
  await withTenant(actor.tenantId, async (db) => {
    const a = await loadAuth(db, actor, authorizationId);
    if (a.status !== ExportAuthorizationStatus.Requested) throw new RedactionError("invalid_status");
    if (a.requestedByUserId === actor.userId) throw new RedactionError("self_approval"); // dual control
    if (a.expiresAt.getTime() <= Date.now()) throw new RedactionError("expired");
    const report = await loadReport(db, actor.tenantId, a.reportId);
    if (report.redactionState !== RedactionState.Redacted) throw new RedactionError("report_not_redacted");
    if (verifyComplianceSnapshotPayload(report.snapshotPayload as unknown as CompliancePayload, report.snapshotHash, report.previousSnapshotHash, report.schemaVersion) !== ComplianceVerificationStatus.Verified) throw new RedactionError("authorization_invalid");
    await db.complianceExportAuthorization.update({ where: { id: authorizationId }, data: { status: ExportAuthorizationStatus.Approved, approvedByUserId: actor.userId, approvedAt: new Date() } });
    await history(db, actor, a.incidentId, "export_authorization", authorizationId, "approved", {});
    await timeline(db, actor, a.incidentId, IncidentTimelineEventType.ComplianceExportAuthorizationApproved, `auth:${authorizationId}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.exportAuthorizationApproved, "export_authorization", authorizationId, {});
  });
}

export async function rejectComplianceExportAuthorization(actor: IncidentActorContext, authorizationId: string, reasonCode: string): Promise<void> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceExportAuthorize)) throw new RedactionError("forbidden");
  await withTenant(actor.tenantId, async (db) => {
    const a = await loadAuth(db, actor, authorizationId);
    if (a.status !== ExportAuthorizationStatus.Requested) throw new RedactionError("invalid_status");
    if (a.requestedByUserId === actor.userId) throw new RedactionError("self_approval");
    await db.complianceExportAuthorization.update({ where: { id: authorizationId }, data: { status: ExportAuthorizationStatus.Rejected, rejectedByUserId: actor.userId, rejectedAt: new Date(), rejectionReasonCode: reasonCode || "OTHER" } });
    await history(db, actor, a.incidentId, "export_authorization", authorizationId, "rejected", { reasonCode: reasonCode || "OTHER" });
    await timeline(db, actor, a.incidentId, IncidentTimelineEventType.ComplianceExportAuthorizationRejected, `auth:${authorizationId}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.exportAuthorizationRejected, "export_authorization", authorizationId, {});
  });
}

export async function cancelComplianceExportAuthorization(actor: IncidentActorContext, authorizationId: string): Promise<void> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceExportAuthorize) && !can(actor.role as Role, Permission.CyberbullyingComplianceRedact)) throw new RedactionError("forbidden");
  await withTenant(actor.tenantId, async (db) => {
    const a = await loadAuth(db, actor, authorizationId);
    if (a.status !== ExportAuthorizationStatus.Requested && a.status !== ExportAuthorizationStatus.Approved) throw new RedactionError("invalid_status");
    await db.complianceExportAuthorization.update({ where: { id: authorizationId }, data: { status: ExportAuthorizationStatus.Cancelled, cancelledAt: new Date() } });
    await history(db, actor, a.incidentId, "export_authorization", authorizationId, "cancelled", {});
    await timeline(db, actor, a.incidentId, IncidentTimelineEventType.ComplianceExportAuthorizationCancelled, `auth:${authorizationId}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.exportAuthorizationCancelled, "export_authorization", authorizationId, {});
  });
}

// --- Package manifest preparation -------------------------------------------

export interface ManifestVM { manifestId: string; incidentId: string; reportId: string; authorizationId: string; packageVersion: number; status: string; manifestHash: string; previousManifestHash: string | null; verification: string }

export async function prepareComplianceExportPackageManifest(actor: IncidentActorContext, authorizationId: string, opts: { idempotencyKey?: string | null } = {}): Promise<ManifestVM & { duplicate?: boolean }> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceExportAuthorize)) throw new RedactionError("forbidden");
  const key = opts.idempotencyKey || null;
  return withTenant(actor.tenantId, async (db) => {
    const a = await loadAuth(db, actor, authorizationId);
    if (a.status !== ExportAuthorizationStatus.Approved) throw new RedactionError("authorization_invalid");
    if (a.expiresAt.getTime() <= Date.now()) throw new RedactionError("expired");
    if (key) {
      const ex = await db.complianceExportPackageManifest.findFirst({ where: { tenantId: actor.tenantId, preparedByUserId: actor.userId, authorizationId, idempotencyKey: key }, select: { id: true, incidentId: true, reportId: true, authorizationId: true, packageVersion: true, status: true, manifestHash: true, previousManifestHash: true } });
      if (ex) { await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.complianceIdempotentReplay, "manifest", ex.id, { packageVersion: ex.packageVersion }); return { manifestId: ex.id, incidentId: ex.incidentId, reportId: ex.reportId, authorizationId: ex.authorizationId, packageVersion: ex.packageVersion, status: ex.status, manifestHash: ex.manifestHash, previousManifestHash: ex.previousManifestHash, verification: ComplianceVerificationStatus.Verified, duplicate: true }; }
    }
    const report = await db.complianceReportSnapshot.findFirst({ where: { id: a.reportId, tenantId: actor.tenantId }, select: { id: true, schemaVersion: true, snapshotHash: true, previousSnapshotHash: true, redactionState: true, redactionRuleSetHash: true, snapshotPayload: true } });
    if (!report) throw new RedactionError("not_found");
    if (report.redactionState !== RedactionState.Redacted) throw new RedactionError("report_not_redacted");
    const payload = report.snapshotPayload as unknown as CompliancePayload;
    if (verifyComplianceSnapshotPayload(payload, report.snapshotHash, report.previousSnapshotHash, report.schemaVersion) !== ComplianceVerificationStatus.Verified) throw new RedactionError("authorization_invalid");

    // Deterministic authorization hash (no internal notes).
    const authorizationHash = computeSha256Hex(computeCanonical(buildAuthorizationHashInput({ authorizationId: a.id, reportId: a.reportId, reportHash: report.snapshotHash, purposeCode: a.purposeCode, recipientType: a.recipientType, requestedByUserId: a.requestedByUserId, approvedByUserId: a.approvedByUserId, requestedAt: a.requestedAt.toISOString(), approvedAt: a.approvedAt?.toISOString() ?? null, expiresAt: a.expiresAt.toISOString(), status: a.status })));

    const last = await db.complianceExportPackageManifest.findFirst({ where: { tenantId: actor.tenantId, incidentId: a.incidentId, reportId: a.reportId }, orderBy: { packageVersion: "desc" }, select: { packageVersion: true, manifestHash: true } });
    const packageVersion = (last?.packageVersion ?? 0) + 1;
    const previousManifestHash = last?.manifestHash ?? null;
    const preparedAt = new Date();

    // Manifest payload — SAFE metadata only (no report payload, no file, no recipient PII).
    const manifestPayload = {
      packageId: `pkg:${a.incidentId}:${a.reportId}:${packageVersion}`, packageVersion, schemaVersion: COMPLIANCE_SCHEMA_VERSION,
      sourceReportId: a.reportId, sourceReportHash: report.snapshotHash, redactionState: report.redactionState, redactionRuleSetHash: report.redactionRuleSetHash,
      authorizationId: a.id, authorizationPurpose: a.purposeCode, recipientType: a.recipientType, authorizationExpiry: a.expiresAt.toISOString(),
      preparedAt: preparedAt.toISOString(), preparedByUserId: actor.userId, reportSchemaVersion: report.schemaVersion,
      includedSections: ["reportMetadata", "incident", "protectedSubject", "assignments", "detections", "evidenceInventory", "custodySummary", "chronology", "caseManagement", "slaAndEscalation", "integrity", "omissions"],
      excludedSections: [] as string[],
      evidenceItemCount: payload.evidenceInventory.length, custodyEventCount: payload.custodySummary.length, chronologyEventCount: payload.chronology.length,
      integritySummary: { evidenceHashCoverage: payload.integrity.evidenceHashCoverage, evidenceIntegrityVerified: payload.integrity.evidenceIntegrityVerified, evidenceIntegrityFailed: payload.integrity.evidenceIntegrityFailed },
      verificationResult: ComplianceVerificationStatus.Verified,
    };
    const manifestHash = computeSha256Hex(computeCanonical(buildManifestHashInput({ manifestIdentity: manifestPayload.packageId, reportHash: report.snapshotHash, authorizationHash, redactionRuleSetHash: report.redactionRuleSetHash, purposeCode: a.purposeCode, recipientType: a.recipientType, preparedAt: preparedAt.toISOString(), packageVersion, previousManifestHash, manifestPayload })));

    const m = await db.complianceExportPackageManifest.create({ data: {
      tenantId: actor.tenantId, incidentId: a.incidentId, reportId: a.reportId, authorizationId: a.id, packageVersion, schemaVersion: COMPLIANCE_SCHEMA_VERSION, status: ExportPackageStatus.Prepared,
      purposeCode: a.purposeCode, recipientType: a.recipientType, preparedByUserId: actor.userId, preparedAt, reportSnapshotHash: report.snapshotHash, redactionRuleSetHash: report.redactionRuleSetHash, authorizationHash, manifestHash, previousManifestHash, manifestPayload: manifestPayload as never, idempotencyKey: key,
    }, select: { id: true } });
    await history(db, actor, a.incidentId, "manifest", m.id, "prepared", { packageVersion });
    await timeline(db, actor, a.incidentId, IncidentTimelineEventType.ComplianceExportPackagePrepared, `manifest:${m.id}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.exportPackageManifestPrepared, "manifest", m.id, { packageVersion, purposeCode: a.purposeCode, recipientType: a.recipientType });
    return { manifestId: m.id, incidentId: a.incidentId, reportId: a.reportId, authorizationId: a.id, packageVersion, status: ExportPackageStatus.Prepared, manifestHash, previousManifestHash, verification: ComplianceVerificationStatus.Verified, duplicate: false };
  });
}

/** Verify a manifest: report hash match, authorization hash, payload hash, chain, schema. */
export async function verifyComplianceExportPackageManifest(actor: IncidentActorContext, manifestId: string): Promise<ComplianceVerificationStatus> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceExportAuthorize) && !can(actor.role as Role, Permission.CyberbullyingComplianceRedact)) throw new RedactionError("forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const m = await db.complianceExportPackageManifest.findFirst({ where: { id: manifestId, tenantId: actor.tenantId }, select: { incidentId: true, reportId: true, authorizationId: true, packageVersion: true, schemaVersion: true, reportSnapshotHash: true, redactionRuleSetHash: true, authorizationHash: true, manifestHash: true, previousManifestHash: true, manifestPayload: true, purposeCode: true, recipientType: true, preparedAt: true } });
    if (!m) throw new RedactionError("not_found");
    await assertIncidentScope(db, actor, m.incidentId);
    if (m.schemaVersion !== COMPLIANCE_SCHEMA_VERSION) return ComplianceVerificationStatus.UnsupportedSchema;
    const report = await db.complianceReportSnapshot.findFirst({ where: { id: m.reportId, tenantId: actor.tenantId }, select: { snapshotHash: true } });
    if (!report || report.snapshotHash !== m.reportSnapshotHash) return ComplianceVerificationStatus.Invalid;
    const recomputed = computeSha256Hex(computeCanonical(buildManifestHashInput({ manifestIdentity: (m.manifestPayload as Record<string, unknown>).packageId as string, reportHash: m.reportSnapshotHash, authorizationHash: m.authorizationHash, redactionRuleSetHash: m.redactionRuleSetHash, purposeCode: m.purposeCode, recipientType: m.recipientType, preparedAt: m.preparedAt.toISOString(), packageVersion: m.packageVersion, previousManifestHash: m.previousManifestHash, manifestPayload: m.manifestPayload })));
    return recomputed === m.manifestHash ? ComplianceVerificationStatus.Verified : ComplianceVerificationStatus.Invalid;
  });
}

// --- Read models ------------------------------------------------------------

export async function getComplianceRedactionDraft(actor: IncidentActorContext, draftId: string): Promise<(DraftVM & { rules: { ruleId: string; fieldPath: string; action: string; reasonCode: string; replacementMarkerKey: string | null; order: number }[] }) | null> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceRedact)) throw new RedactionError("forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const d = await db.complianceRedactionDraft.findFirst({ where: { id: draftId, tenantId: actor.tenantId }, select: { ...DRAFT_SELECT, rules: { orderBy: { order: "asc" }, select: { id: true, fieldPath: true, action: true, reasonCode: true, replacementMarkerKey: true, order: true } } } });
    if (!d) return null;
    await assertIncidentScope(db, actor, d.incidentId);
    return { ...draftVM(d), rules: d.rules.map((r) => ({ ruleId: r.id, fieldPath: r.fieldPath, action: r.action, reasonCode: r.reasonCode, replacementMarkerKey: r.replacementMarkerKey, order: r.order })) };
  });
}

export async function listIncidentComplianceWorkflow(actor: IncidentActorContext, incidentId: string): Promise<{ drafts: DraftVM[]; authorizations: AuthorizationVM[]; manifests: ManifestVM[] }> {
  if (!can(actor.role as Role, Permission.CyberbullyingComplianceRedact)) throw new RedactionError("forbidden");
  return withTenant(actor.tenantId, async (db) => {
    await assertIncidentScope(db, actor, incidentId);
    const [drafts, auths, manifests] = await Promise.all([
      db.complianceRedactionDraft.findMany({ where: { tenantId: actor.tenantId, incidentId }, orderBy: { createdAt: "desc" }, take: 100, select: DRAFT_SELECT }),
      db.complianceExportAuthorization.findMany({ where: { tenantId: actor.tenantId, incidentId }, orderBy: { requestedAt: "desc" }, take: 100, select: AUTH_SELECT }),
      db.complianceExportPackageManifest.findMany({ where: { tenantId: actor.tenantId, incidentId }, orderBy: { packageVersion: "desc" }, take: 100, select: { id: true, incidentId: true, reportId: true, authorizationId: true, packageVersion: true, status: true, manifestHash: true, previousManifestHash: true } }),
    ]);
    return {
      drafts: drafts.map(draftVM), authorizations: auths.map(authVM),
      manifests: manifests.map((m) => ({ manifestId: m.id, incidentId: m.incidentId, reportId: m.reportId, authorizationId: m.authorizationId, packageVersion: m.packageVersion, status: m.status, manifestHash: m.manifestHash, previousManifestHash: m.previousManifestHash, verification: ComplianceVerificationStatus.Verified })),
    };
  });
}
