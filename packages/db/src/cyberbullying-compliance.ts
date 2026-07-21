import { ActorKind, Prisma } from "@prisma/client";
import {
  Permission, Role, can, CYBERBULLYING_AUDIT_EVENTS, IncidentCategory, IncidentTimelineEventType,
  ComplianceReportType, RedactionState, OmissionReason, ChronologyCategory, ComplianceVerificationStatus,
  COMPLIANCE_SCHEMA_VERSION, COMPLIANCE_CANONICALIZATION_VERSION, COMPLIANCE_HASH_ALGORITHM, COMPLIANCE_LIMITS,
  isComplianceReportType, isSupportedComplianceSchema, canonicalStringify, buildComplianceHashInput,
  firstReviewSlaState, criticalRiskSlaState, taskSlaState, followUpSlaState, SlaState, CaseRiskLevel, CaseMilestoneKey, CaseTaskStatus,
  type CompliancePayload, type OmissionEntry, type ChronologyEntry, type EvidenceInventoryItem, type IncidentActorContext,
} from "@guardora/core";
import { withTenant } from "./repositories";
import { computeSha256Hex } from "./evidence-integrity";

/**
 * C11 — Compliance report snapshots. Builds an IMMUTABLE, versioned, hashed snapshot
 * of an incident. The builder reads server-side via explicit selects (never raw
 * Prisma rows as the contract), sanitizes every field (confidential summary/notes/
 * objective/task-description/escalation-note/evidence-content are OMITTED with a
 * machine-readable reason), and NEVER reads evidence content. Nothing here mutates
 * the incident. Immutability is enforced at the DB privilege level (SELECT+INSERT
 * only); the snapshot hash chains to the previous version.
 */

type Tx = Prisma.TransactionClient;
const DOMAIN = IncidentCategory.Cyberbullying;
const ACTIVE = ["open", "under_review", "acknowledged", "confirmed", "action_required"];
const REVIEW_EVENTS = [IncidentTimelineEventType.ReviewStarted, IncidentTimelineEventType.Acknowledged] as string[];

export type ComplianceErrorCode = "forbidden" | "not_found" | "unsupported_type" | "source_too_large" | "duplicate_version" | "error";
export class ComplianceError extends Error {
  constructor(public readonly code: ComplianceErrorCode) { super(`compliance: ${code}`); this.name = "ComplianceError"; }
}

async function authorizeScope(db: Tx, actor: IncidentActorContext, incidentId: string): Promise<{ status: string; severity: string; category: string; createdAt: Date; resolvedAt: Date | null }> {
  const inc = await db.incident.findFirst({
    where: { id: incidentId, tenantId: actor.tenantId, domain: DOMAIN },
    select: { id: true, status: true, severity: true, category: true, createdAt: true, resolvedAt: true, cyberbullyingDetail: { select: { assignedReviewerUserId: true } }, participants: { where: { userId: actor.userId }, select: { id: true } } },
  });
  if (!inc) throw new ComplianceError("not_found");
  const role = actor.role as Role;
  const tenantWide = role === Role.Owner || role === Role.Admin;
  const inScope = inc.participants.length > 0 || inc.cyberbullyingDetail?.assignedReviewerUserId === actor.userId;
  if (!tenantWide && !inScope) throw new ComplianceError("forbidden");
  return { status: inc.status, severity: inc.severity, category: inc.category, createdAt: inc.createdAt, resolvedAt: inc.resolvedAt };
}

// --- Builder ----------------------------------------------------------------

/** Build the canonical, sanitized snapshot payload. No mutation, no evidence content. */
export async function buildCyberbullyingComplianceSnapshot(
  db: Tx, actor: IncidentActorContext, incidentId: string, reportType: ComplianceReportType,
  ctx: { version: number; previousHash: string | null; generatedAt: Date; tenantTimezone: string },
): Promise<CompliancePayload> {
  const inc = await authorizeScope(db, actor, incidentId);
  const now = ctx.generatedAt;
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const omissions: OmissionEntry[] = [];

  const detail = await db.cyberbullyingIncidentDetail.findFirst({ where: { incidentId, tenantId: actor.tenantId }, select: {
    reportSource: true, protectedSubjectId: true, subject: { select: { id: true, subjectType: true, displayLabel: true, active: true, createdAt: true } },
  } });
  omissions.push({ path: "incident.summary", reason: OmissionReason.IncidentSummaryExcluded });
  omissions.push({ path: "protectedSubject.contact", reason: OmissionReason.PersonalContactDataExcluded });

  const participants = await db.incidentParticipant.findMany({ where: { incidentId, tenantId: actor.tenantId }, take: COMPLIANCE_LIMITS.maxParticipants, orderBy: { createdAt: "asc" }, select: { role: true, userId: true, externalReference: true, createdAt: true, subject: { select: { displayLabel: true } } } });
  const assignmentEvents = await db.incidentAssignmentEvent.findMany({ where: { incidentId, tenantId: actor.tenantId }, orderBy: { createdAt: "asc" }, take: 200, select: { action: true, assigneeUserId: true, previousAssigneeUserId: true, assignedByUserId: true, createdAt: true } });
  const planRow = await db.cyberbullyingProtectionPlan.findFirst({ where: { incidentId, tenantId: actor.tenantId }, select: {
    protectionStatus: true, riskLevel: true, updatedAt: true, nextReviewAt: true, lastReviewAt: true, criticalRiskSetAt: true,
    milestoneInitialReviewAt: true, milestoneEvidenceCollectedAt: true, milestoneVictimContactedAt: true, milestoneProtectionActiveAt: true, milestoneResolvedAt: true,
  } });
  const tasksRaw = await db.cyberbullyingCaseTask.findMany({ where: { incidentId, tenantId: actor.tenantId }, take: COMPLIANCE_LIMITS.maxTasks, orderBy: { createdAt: "asc" }, select: { id: true, status: true, assigneeUserId: true, dueDate: true, createdAt: true, completedAt: true } });
  const detLinks = await db.incidentDetectionLink.findMany({ where: { incidentId, tenantId: actor.tenantId }, take: COMPLIANCE_LIMITS.maxDetections, select: { detection: { select: { id: true, detectedAt: true, source: true, kind: true, severity: true, subjectType: true, occurrenceCount: true, reasonCode: true, confidence: true, cyberbullyingTriage: { select: { status: true } } } } } });
  const evidenceRaw = await db.incidentEvidence.findMany({ where: { incidentId, tenantId: actor.tenantId }, take: COMPLIANCE_LIMITS.maxEvidence + 1, orderBy: { createdAt: "asc" }, select: {
    id: true, evidenceType: true, sourceType: true, captureMethod: true, capturedAt: true, createdAt: true, storageObjectId: true, mimeType: true, sizeBytes: true, contentHash: true, hashAlgorithm: true, integrityStatus: true, scanStatus: true, retentionUntil: true, legalHold: true, submittedByUserId: true, incidentId: true,
    custodyEvents: { take: COMPLIANCE_LIMITS.maxCustody, orderBy: { createdAt: "asc" }, select: { id: true, eventType: true, createdAt: true, actorUserId: true, actorRole: true, previousHash: true, resultingHash: true } },
  } });
  const escalation = await db.cyberbullyingEscalation.findFirst({ where: { incidentId, tenantId: actor.tenantId, status: "active" }, orderBy: { escalatedAt: "desc" }, select: { status: true, severity: true, reasonCode: true, targetUserId: true, targetRole: true, escalatedByUserId: true, escalatedAt: true, resolvedAt: true } });
  const timeline = await db.incidentTimelineEvent.findMany({ where: { incidentId, tenantId: actor.tenantId }, orderBy: { createdAt: "asc" }, take: COMPLIANCE_LIMITS.maxChronology + 1, select: { id: true, eventType: true, actorUserId: true, reason: true, createdAt: true } });

  // Truncation policy — LOUD, never silent.
  const evidence = evidenceRaw.slice(0, COMPLIANCE_LIMITS.maxEvidence);
  if (evidenceRaw.length > COMPLIANCE_LIMITS.maxEvidence) omissions.push({ path: "evidenceInventory", reason: OmissionReason.EvidenceInventoryTruncated });
  omissions.push({ path: "evidenceInventory.content", reason: OmissionReason.EvidenceContentExcluded });
  omissions.push({ path: "evidenceInventory.originalFilename", reason: OmissionReason.OriginalFilenameExcluded });
  omissions.push({ path: "detections.rawEvidence", reason: OmissionReason.RawDetectionEvidenceExcluded });
  if (planRow) { omissions.push({ path: "caseManagement.protection.objective", reason: OmissionReason.ProtectionObjectiveExcluded }); omissions.push({ path: "caseManagement.protection.notes", reason: OmissionReason.ProtectionNotesExcluded }); omissions.push({ path: "caseManagement.followUp.notes", reason: OmissionReason.FollowUpNotesExcluded }); }
  if (tasksRaw.length) omissions.push({ path: "caseManagement.tasks.description", reason: OmissionReason.TaskDescriptionExcluded });
  if (escalation) omissions.push({ path: "slaAndEscalation.activeEscalation.note", reason: OmissionReason.ConfidentialEscalationNoteExcluded });

  // Evidence inventory (SANITIZED — no storageKey / filename / content).
  const evidenceInventory: EvidenceInventoryItem[] = evidence.map((e) => ({
    evidenceId: e.id, evidenceType: e.evidenceType, sourceType: e.sourceType, captureMethod: e.captureMethod, capturedAt: e.capturedAt.toISOString(), createdAt: e.createdAt.toISOString(),
    storageObjectId: e.storageObjectId, mimeType: e.mimeType, sizeBytes: e.sizeBytes, contentHash: e.contentHash, hashAlgorithm: e.hashAlgorithm,
    integrityStatus: e.integrityStatus, scanStatus: e.scanStatus, retentionUntil: iso(e.retentionUntil), legalHold: e.legalHold, submittedByUserId: e.submittedByUserId, incidentId: e.incidentId,
  }));
  const custodySummary = evidence.flatMap((e) => e.custodyEvents.map((c) => ({ custodyEventId: c.id, evidenceId: e.id, eventType: c.eventType, occurredAt: c.createdAt.toISOString(), actorUserId: c.actorUserId, actorRole: c.actorRole, previousHash: c.previousHash, resultingHash: c.resultingHash })))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.custodyEventId.localeCompare(b.custodyEventId));

  // Chronology — merged, deterministically ordered (occurredAt, category, eventId). No free text.
  const chron: ChronologyEntry[] = [];
  const tlSlice = timeline.slice(0, COMPLIANCE_LIMITS.maxChronology);
  if (timeline.length > COMPLIANCE_LIMITS.maxChronology) omissions.push({ path: "chronology", reason: OmissionReason.ChronologyTruncated });
  for (const t of tlSlice) chron.push({ occurredAt: t.createdAt.toISOString(), category: ChronologyCategory.IncidentTimeline, type: t.eventType, actorUserId: t.actorUserId, entityRef: incidentId, eventId: `tl:${t.id}`, metadata: {} });
  for (const c of custodySummary) chron.push({ occurredAt: c.occurredAt, category: ChronologyCategory.EvidenceCustody, type: c.eventType, actorUserId: c.actorUserId, entityRef: c.evidenceId, eventId: `cust:${c.custodyEventId}`, metadata: {} });
  if (escalation) chron.push({ occurredAt: escalation.escalatedAt.toISOString(), category: ChronologyCategory.Escalation, type: "escalation_created", actorUserId: escalation.escalatedByUserId, entityRef: incidentId, eventId: `esc:${escalation.escalatedAt.toISOString()}`, metadata: { severity: escalation.severity, reasonCode: escalation.reasonCode } });
  chron.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.category.localeCompare(b.category) || a.eventId.localeCompare(b.eventId));

  // SLA — computed with generatedAt as `now` for reproducibility.
  const firstReviewAt = timeline.find((t) => REVIEW_EVENTS.includes(t.eventType))?.createdAt ?? null;
  let criticalRisk: string = SlaState.NotApplicable;
  if (planRow?.riskLevel === CaseRiskLevel.Critical && planRow.criticalRiskSetAt) {
    const respondedAt = timeline.find((t) => t.createdAt.getTime() > planRow.criticalRiskSetAt!.getTime())?.createdAt ?? null;
    criticalRisk = criticalRiskSlaState(planRow.criticalRiskSetAt, respondedAt, now);
  }
  const openTasks = tasksRaw.filter((tk) => (tk.status === CaseTaskStatus.Todo || tk.status === CaseTaskStatus.InProgress) && tk.dueDate);
  let taskOverdue = 0, taskDueSoon = 0; let nearest: Date | null = null; let oldestOverdue: Date | null = null;
  for (const tk of openTasks) {
    const s = taskSlaState(tk.dueDate, false, now);
    if (s === SlaState.Overdue) { taskOverdue++; if (!oldestOverdue || tk.dueDate! < oldestOverdue) oldestOverdue = tk.dueDate!; }
    else if (s === SlaState.DueSoon) taskDueSoon++;
    if (tk.dueDate && tk.dueDate.getTime() > now.getTime() && (!nearest || tk.dueDate < nearest)) nearest = tk.dueDate;
  }
  const evVerified = evidence.filter((e) => e.integrityStatus === "verified").length;
  const evFailed = evidence.filter((e) => e.integrityStatus === "failed").length;
  const sourceIncidentUpdatedAt = timeline.length ? timeline[timeline.length - 1]!.createdAt : inc.createdAt;

  const payload: CompliancePayload = {
    reportMetadata: {
      reportType, schemaVersion: COMPLIANCE_SCHEMA_VERSION, version: ctx.version, generatedAt: now.toISOString(), generatedByUserId: actor.userId,
      tenantTimezone: ctx.tenantTimezone, sourceIncidentUpdatedAt: sourceIncidentUpdatedAt.toISOString(), sourceSystems: ["tamanor-cyberbullying"],
    },
    incident: { incidentId, domain: DOMAIN, status: inc.status, severity: inc.severity, category: inc.category, reportSource: detail?.reportSource ?? null, createdAt: inc.createdAt.toISOString(), resolvedAt: iso(inc.resolvedAt) },
    protectedSubject: { protectedSubjectId: detail?.protectedSubjectId ?? null, subjectType: detail?.subject?.subjectType ?? null, displayLabel: detail?.subject?.displayLabel ?? null, active: detail?.subject?.active ?? null, relationToIncident: "protected_subject", createdAt: iso(detail?.subject?.createdAt ?? null) },
    assignments: {
      primaryReviewerUserId: null, // filled below
      participants: participants.map((p) => ({ role: p.role, userId: p.userId, subjectLabel: p.subject?.displayLabel ?? null, hasExternalRef: !!p.externalReference, createdAt: p.createdAt.toISOString() })),
      history: assignmentEvents.map((a) => ({ action: a.action, assigneeUserId: a.assigneeUserId, previousAssigneeUserId: a.previousAssigneeUserId, assignedByUserId: a.assignedByUserId, occurredAt: a.createdAt.toISOString() })),
    },
    detections: detLinks.map((l) => ({ detectionId: l.detection.id, detectedAt: l.detection.detectedAt.toISOString(), source: l.detection.source, kind: l.detection.kind, severity: String(l.detection.severity), subjectType: l.detection.subjectType, occurrenceCount: l.detection.occurrenceCount, reasonCode: l.detection.reasonCode, confidence: l.detection.confidence, triageStatus: l.detection.cyberbullyingTriage?.status ?? "new", linkedIncidentId: incidentId })),
    evidenceInventory,
    custodySummary,
    chronology: chron,
    caseManagement: {
      protection: planRow ? { protectionStatus: planRow.protectionStatus, riskLevel: planRow.riskLevel, updatedAt: iso(planRow.updatedAt) } : null,
      tasks: tasksRaw.map((tk) => ({ taskId: tk.id, status: tk.status, assigneeUserId: tk.assigneeUserId, dueDate: iso(tk.dueDate), createdAt: tk.createdAt.toISOString(), completedAt: iso(tk.completedAt) })),
      followUp: planRow ? { nextReviewAt: iso(planRow.nextReviewAt), lastReviewAt: iso(planRow.lastReviewAt), updatedAt: iso(planRow.updatedAt) } : null,
      milestones: [
        { key: CaseMilestoneKey.InitialReview, achieved: !!planRow?.milestoneInitialReviewAt, achievedAt: iso(planRow?.milestoneInitialReviewAt ?? null) },
        { key: CaseMilestoneKey.EvidenceCollected, achieved: !!planRow?.milestoneEvidenceCollectedAt, achievedAt: iso(planRow?.milestoneEvidenceCollectedAt ?? null) },
        { key: CaseMilestoneKey.VictimContacted, achieved: !!planRow?.milestoneVictimContactedAt, achievedAt: iso(planRow?.milestoneVictimContactedAt ?? null) },
        { key: CaseMilestoneKey.ProtectionActive, achieved: !!planRow?.milestoneProtectionActiveAt, achievedAt: iso(planRow?.milestoneProtectionActiveAt ?? null) },
        { key: CaseMilestoneKey.Resolved, achieved: !!planRow?.milestoneResolvedAt, achievedAt: iso(planRow?.milestoneResolvedAt ?? null) },
      ],
    },
    slaAndEscalation: {
      firstReview: firstReviewSlaState(inc.createdAt, firstReviewAt, now), criticalRisk, followUp: followUpSlaState(planRow?.nextReviewAt ?? null, now),
      taskOverdue, taskDueSoon, nearestDeadline: iso(nearest), oldestOverdue: iso(oldestOverdue),
      activeEscalation: escalation ? { status: escalation.status, severity: escalation.severity, reasonCode: escalation.reasonCode, targetUserId: escalation.targetUserId, targetRole: escalation.targetRole, escalatedByUserId: escalation.escalatedByUserId, escalatedAt: escalation.escalatedAt.toISOString(), resolvedAt: iso(escalation.resolvedAt) } : null,
    },
    integrity: {
      previousSnapshotHash: ctx.previousHash, hashAlgorithm: COMPLIANCE_HASH_ALGORITHM, canonicalizationVersion: COMPLIANCE_CANONICALIZATION_VERSION, schemaVersion: COMPLIANCE_SCHEMA_VERSION,
      evidenceHashCoverage: evidence.filter((e) => !!e.contentHash).length, evidenceIntegrityVerified: evVerified, evidenceIntegrityFailed: evFailed,
    },
    omissions,
  };
  // primary reviewer = the assignee (from detail).
  const assignee = await db.cyberbullyingIncidentDetail.findFirst({ where: { incidentId, tenantId: actor.tenantId }, select: { assignedReviewerUserId: true } });
  payload.assignments.primaryReviewerUserId = assignee?.assignedReviewerUserId ?? null;
  return payload;
}

/** Deterministic SHA-256 over the canonical hash input (snapshotHash stored OUTSIDE the payload). */
export function computeComplianceHashHex(payload: CompliancePayload, previousHash: string | null): string {
  return computeSha256Hex(canonicalStringify(buildComplianceHashInput(payload, previousHash)));
}

// --- Create -----------------------------------------------------------------

export interface ComplianceReportVM {
  reportId: string; incidentId: string; reportType: string; version: number; schemaVersion: string; status: string; redactionState: string;
  generatedAt: string; generatedByUserId: string; snapshotHash: string; previousSnapshotHash: string | null; verificationStatus: string;
  duplicate?: boolean;
}
function listVM(row: { id: string; incidentId: string; reportType: string; version: number; schemaVersion: string; status: string; redactionState: string; generatedAt: Date; generatedByUserId: string; snapshotHash: string; previousSnapshotHash: string | null }, verification: string): ComplianceReportVM {
  return { reportId: row.id, incidentId: row.incidentId, reportType: row.reportType, version: row.version, schemaVersion: row.schemaVersion, status: row.status, redactionState: row.redactionState, generatedAt: row.generatedAt.toISOString(), generatedByUserId: row.generatedByUserId, snapshotHash: row.snapshotHash, previousSnapshotHash: row.previousSnapshotHash, verificationStatus: verification };
}

export async function createCyberbullyingComplianceReport(actor: IncidentActorContext, incidentId: string, input: { reportType: string; idempotencyKey?: string | null }): Promise<ComplianceReportVM> {
  if (!can(actor.role as Role, Permission.CyberbullyingReview)) throw new ComplianceError("forbidden");
  if (!isComplianceReportType(input.reportType)) throw new ComplianceError("unsupported_type");
  const reportType = input.reportType;
  const key = input.idempotencyKey || null;

  try {
    return await withTenant(actor.tenantId, async (db) => {
      await authorizeScope(db, actor, incidentId);
      // Idempotent replay — same (tenant,user,incident,type,key) returns the existing report.
      if (key) {
        const existing = await db.complianceReportSnapshot.findFirst({ where: { tenantId: actor.tenantId, generatedByUserId: actor.userId, incidentId, reportType, idempotencyKey: key }, select: SNAP_SELECT });
        if (existing) {
          await db.auditLog.create({ data: { tenantId: actor.tenantId, event: CYBERBULLYING_AUDIT_EVENTS.complianceReportIdempotentReplay, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: "compliance_report", targetId: existing.id, metadata: { reportType, version: existing.version } as never } });
          return { ...listVM(existing, ComplianceVerificationStatus.Verified), duplicate: true };
        }
      }
      const generatedAt = new Date();
      const last = await db.complianceReportSnapshot.findFirst({ where: { tenantId: actor.tenantId, incidentId, reportType }, orderBy: { version: "desc" }, select: { version: true, snapshotHash: true } });
      const version = (last?.version ?? 0) + 1;
      const previousHash = last?.snapshotHash ?? null;
      // No tenant-level timezone exists (timezone is per-brand); SLA derivation is
      // elapsed-time / timezone-agnostic, and DB timestamps are UTC.
      const payload = await buildCyberbullyingComplianceSnapshot(db, actor, incidentId, reportType, { version, previousHash, generatedAt, tenantTimezone: "UTC" });
      const snapshotHash = computeComplianceHashHex(payload, previousHash);

      const row = await db.complianceReportSnapshot.create({ data: {
        tenantId: actor.tenantId, incidentId, reportType, version, schemaVersion: COMPLIANCE_SCHEMA_VERSION, status: "ready", redactionState: RedactionState.UnredactedInternal,
        generatedByUserId: actor.userId, generatedAt, sourceIncidentUpdatedAt: new Date(payload.reportMetadata.sourceIncidentUpdatedAt ?? generatedAt),
        snapshotHash, previousSnapshotHash: previousHash, snapshotPayload: payload as never, idempotencyKey: key,
      }, select: SNAP_SELECT });

      await db.incidentTimelineEvent.create({ data: { tenantId: actor.tenantId, incidentId, eventType: IncidentTimelineEventType.ComplianceReportCreated, actorUserId: actor.userId, reason: `${reportType}:v${version}` } });
      await db.auditLog.create({ data: { tenantId: actor.tenantId, event: CYBERBULLYING_AUDIT_EVENTS.complianceReportCreated, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: "compliance_report", targetId: row.id, metadata: { incidentId, reportType, version, schemaVersion: COMPLIANCE_SCHEMA_VERSION, snapshotHash } as never } });
      return { ...listVM(row, ComplianceVerificationStatus.Verified), duplicate: false };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ComplianceError("duplicate_version");
    throw e;
  }
}

const SNAP_SELECT = { id: true, incidentId: true, reportType: true, version: true, schemaVersion: true, status: true, redactionState: true, generatedAt: true, generatedByUserId: true, snapshotHash: true, previousSnapshotHash: true } as const;

// --- Verify -----------------------------------------------------------------

/** Recompute the payload hash + schema support. Pure over a stored row's payload/hash. */
export function verifyComplianceSnapshotPayload(payload: CompliancePayload, storedHash: string, previousHash: string | null, schemaVersion: string): ComplianceVerificationStatus {
  if (!isSupportedComplianceSchema(schemaVersion)) return ComplianceVerificationStatus.UnsupportedSchema;
  return computeComplianceHashHex(payload, previousHash) === storedHash ? ComplianceVerificationStatus.Verified : ComplianceVerificationStatus.Invalid;
}

/** Verify a whole incident+type chain: payload hashes, previous-hash links, version continuity. */
export async function verifyComplianceReportChain(actor: IncidentActorContext, incidentId: string, reportType: string): Promise<ComplianceVerificationStatus> {
  if (!can(actor.role as Role, Permission.CyberbullyingReview)) throw new ComplianceError("forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const rows = await db.complianceReportSnapshot.findMany({ where: { tenantId: actor.tenantId, incidentId, reportType }, orderBy: { version: "asc" }, select: { version: true, schemaVersion: true, snapshotHash: true, previousSnapshotHash: true, snapshotPayload: true } });
    if (rows.length === 0) return ComplianceVerificationStatus.ChainIncomplete;
    let prevHash: string | null = null; let expectVersion = 1;
    for (const r of rows) {
      if (r.version !== expectVersion) return ComplianceVerificationStatus.ChainIncomplete;
      if (r.previousSnapshotHash !== prevHash) return ComplianceVerificationStatus.ChainIncomplete;
      const status = verifyComplianceSnapshotPayload(r.snapshotPayload as unknown as CompliancePayload, r.snapshotHash, r.previousSnapshotHash, r.schemaVersion);
      if (status !== ComplianceVerificationStatus.Verified) return status;
      prevHash = r.snapshotHash; expectVersion++;
    }
    return ComplianceVerificationStatus.Verified;
  });
}

// --- Read models ------------------------------------------------------------

export async function listIncidentComplianceReports(actor: IncidentActorContext, incidentId: string, opts: { page?: number; pageSize?: number } = {}): Promise<{ items: ComplianceReportVM[]; total: number; page: number; pageSize: number }> {
  if (!can(actor.role as Role, Permission.CyberbullyingReview)) throw new ComplianceError("forbidden");
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  return withTenant(actor.tenantId, async (db) => {
    await authorizeScope(db, actor, incidentId);
    const where = { tenantId: actor.tenantId, incidentId };
    const [rows, total] = await Promise.all([
      db.complianceReportSnapshot.findMany({ where, orderBy: [{ version: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: SNAP_SELECT }),
      db.complianceReportSnapshot.count({ where }),
    ]);
    return { items: rows.map((r) => listVM(r, ComplianceVerificationStatus.Verified)), total, page, pageSize };
  });
}

export interface ComplianceReportDetailVM extends ComplianceReportVM { payload: CompliancePayload }

export async function getComplianceReportDetail(actor: IncidentActorContext, reportId: string): Promise<ComplianceReportDetailVM | null> {
  if (!can(actor.role as Role, Permission.CyberbullyingReview)) throw new ComplianceError("forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const row = await db.complianceReportSnapshot.findFirst({ where: { id: reportId, tenantId: actor.tenantId }, select: { ...SNAP_SELECT, snapshotPayload: true } });
    if (!row) return null;
    await authorizeScope(db, actor, row.incidentId); // scope re-check
    const payload = row.snapshotPayload as unknown as CompliancePayload;
    const verification = verifyComplianceSnapshotPayload(payload, row.snapshotHash, row.previousSnapshotHash, row.schemaVersion);
    return { ...listVM(row, verification), payload };
  });
}
