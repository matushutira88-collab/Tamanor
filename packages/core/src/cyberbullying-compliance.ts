/**
 * Cyberbullying Protection — C11 Reporting & Compliance (domain).
 *
 * PURE + crypto-free (client-safe via the `@guardora/core/cyberbullying-compliance`
 * subpath): the versioned, typed snapshot SCHEMA CONTRACT, the enum vocabulary
 * (report type / status / redaction / classification / omission reason / verification),
 * the canonical (stable-key) JSON serializer used for hashing, and the hard limits.
 * No IO, no crypto (SHA-256 lives in @guardora/db). A Compliance Report is an
 * IMMUTABLE snapshot of an incident at a point in time — it never mutates the case.
 */

export const COMPLIANCE_SCHEMA_VERSION = "1.0.0";
export const COMPLIANCE_CANONICALIZATION_VERSION = "canonical-json-v1";
export const COMPLIANCE_HASH_ALGORITHM = "sha256";
export const SUPPORTED_COMPLIANCE_SCHEMA_VERSIONS: readonly string[] = [COMPLIANCE_SCHEMA_VERSION];

export enum ComplianceReportType {
  CaseSummary = "cyberbullying_case_summary",
  EvidencePackage = "cyberbullying_evidence_package",
}
export const ALL_COMPLIANCE_REPORT_TYPES: readonly ComplianceReportType[] = Object.values(ComplianceReportType);
export function isComplianceReportType(x: unknown): x is ComplianceReportType {
  return typeof x === "string" && (ALL_COMPLIANCE_REPORT_TYPES as readonly string[]).includes(x);
}

/** C11 is append-only: every snapshot is READY (latest is derived from max version). */
export enum ComplianceReportStatus { Ready = "ready" }

/** C11 produces only the internal, unredacted snapshot; the redaction pipeline is future. */
export enum RedactionState {
  UnredactedInternal = "unredacted_internal",
  RedactionRequired = "redaction_required",
  Redacted = "redacted",
}

/** Field classification — foundation for a future redaction pipeline (no auto-redaction in C11). */
export enum FieldClassification {
  PublicSafe = "public_safe",
  Internal = "internal",
  Sensitive = "sensitive",
  HighlySensitive = "highly_sensitive",
}

/** Machine-readable reason a sensitive field was deliberately omitted (never the content). */
export enum OmissionReason {
  IncidentSummaryExcluded = "INCIDENT_SUMMARY_EXCLUDED",
  ProtectionNotesExcluded = "PROTECTION_NOTES_EXCLUDED",
  ProtectionObjectiveExcluded = "PROTECTION_OBJECTIVE_EXCLUDED",
  FollowUpNotesExcluded = "FOLLOW_UP_NOTES_EXCLUDED",
  TaskDescriptionExcluded = "TASK_DESCRIPTION_EXCLUDED",
  ConfidentialEscalationNoteExcluded = "CONFIDENTIAL_ESCALATION_NOTE_EXCLUDED",
  OriginalFilenameExcluded = "ORIGINAL_FILENAME_EXCLUDED",
  RawDetectionEvidenceExcluded = "RAW_DETECTION_EVIDENCE_EXCLUDED",
  EvidenceContentExcluded = "EVIDENCE_CONTENT_EXCLUDED",
  PersonalContactDataExcluded = "PERSONAL_CONTACT_DATA_EXCLUDED",
  ChronologyTruncated = "CHRONOLOGY_TRUNCATED",
  EvidenceInventoryTruncated = "EVIDENCE_INVENTORY_TRUNCATED",
  UnsupportedField = "UNSUPPORTED_FIELD",
}

export enum ChronologyCategory {
  IncidentTimeline = "incident_timeline",
  DetectionTriage = "detection_triage",
  EvidenceCustody = "evidence_custody",
  CaseManagement = "case_management",
  Sla = "sla",
  Escalation = "escalation",
}

export enum ComplianceVerificationStatus {
  Verified = "verified",
  Invalid = "invalid",
  UnsupportedSchema = "unsupported_schema",
  ChainIncomplete = "chain_incomplete",
}

/** Bounded limits — the builder fails LOUD or records a truncation omission, never silent. */
export const COMPLIANCE_LIMITS = {
  maxEvidence: 500,
  maxChronology: 2000,
  maxTasks: 500,
  maxDetections: 500,
  maxParticipants: 200,
  maxCustody: 2000,
} as const;

// --- Typed payload sections -------------------------------------------------

export interface OmissionEntry { path: string; reason: OmissionReason }

export interface ReportMetadataSection {
  reportType: ComplianceReportType;
  schemaVersion: string;
  version: number;
  generatedAt: string;
  generatedByUserId: string;
  tenantTimezone: string;
  sourceIncidentUpdatedAt: string | null;
  sourceSystems: string[];
}
export interface IncidentSection {
  incidentId: string; domain: string; status: string; severity: string; category: string;
  reportSource: string | null; createdAt: string; resolvedAt: string | null;
}
export interface ProtectedSubjectSection {
  protectedSubjectId: string | null; subjectType: string | null; displayLabel: string | null; active: boolean | null; relationToIncident: string; createdAt: string | null;
}
export interface AssignmentSection {
  primaryReviewerUserId: string | null;
  participants: { role: string; userId: string | null; subjectLabel: string | null; hasExternalRef: boolean; createdAt: string }[];
  history: { action: string; assigneeUserId: string | null; previousAssigneeUserId: string | null; assignedByUserId: string; occurredAt: string }[];
}
export interface DetectionSection {
  detectionId: string; detectedAt: string; source: string | null; kind: string; severity: string; subjectType: string; occurrenceCount: number; reasonCode: string | null; confidence: number | null; triageStatus: string; linkedIncidentId: string | null;
}
export interface EvidenceInventoryItem {
  evidenceId: string; evidenceType: string; sourceType: string; captureMethod: string; capturedAt: string; createdAt: string;
  storageObjectId: string; mimeType: string | null; sizeBytes: number; contentHash: string; hashAlgorithm: string;
  integrityStatus: string; scanStatus: string; retentionUntil: string | null; legalHold: boolean; submittedByUserId: string | null; incidentId: string | null;
}
export interface CustodyEntry {
  custodyEventId: string; evidenceId: string; eventType: string; occurredAt: string; actorUserId: string | null; actorRole: string | null; previousHash: string | null; resultingHash: string | null;
}
export interface ChronologyEntry {
  occurredAt: string; category: ChronologyCategory; type: string; actorUserId: string | null; entityRef: string | null; eventId: string; metadata: Record<string, string | number | boolean>;
}
export interface CaseManagementSection {
  protection: { protectionStatus: string; riskLevel: string | null; updatedAt: string | null } | null;
  tasks: { taskId: string; status: string; assigneeUserId: string | null; dueDate: string | null; createdAt: string; completedAt: string | null }[];
  followUp: { nextReviewAt: string | null; lastReviewAt: string | null; updatedAt: string | null } | null;
  milestones: { key: string; achieved: boolean; achievedAt: string | null }[];
}
export interface SlaEscalationSection {
  firstReview: string; criticalRisk: string; followUp: string; taskOverdue: number; taskDueSoon: number; nearestDeadline: string | null; oldestOverdue: string | null;
  activeEscalation: { status: string; severity: string; reasonCode: string; targetUserId: string | null; targetRole: string | null; escalatedByUserId: string; escalatedAt: string; resolvedAt: string | null } | null;
}
export interface IntegritySection {
  previousSnapshotHash: string | null; hashAlgorithm: string; canonicalizationVersion: string; schemaVersion: string;
  evidenceHashCoverage: number; evidenceIntegrityVerified: number; evidenceIntegrityFailed: number;
}

export interface CompliancePayload {
  reportMetadata: ReportMetadataSection;
  incident: IncidentSection;
  protectedSubject: ProtectedSubjectSection;
  assignments: AssignmentSection;
  detections: DetectionSection[];
  evidenceInventory: EvidenceInventoryItem[];
  custodySummary: CustodyEntry[];
  chronology: ChronologyEntry[];
  caseManagement: CaseManagementSection;
  slaAndEscalation: SlaEscalationSection;
  integrity: IntegritySection;
  omissions: OmissionEntry[];
}

// --- Canonical serialization (stable key order; deterministic) --------------

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    return out;
  }
  return value; // primitives; Dates MUST be pre-serialized to ISO strings by the builder
}

/** Deterministic canonical JSON — key order is stable regardless of insertion order. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/** The exact input object that gets hashed (snapshotHash is stored OUTSIDE the payload). */
export interface ComplianceHashInput {
  tenantSafeIdentity: string; // e.g. `${reportType}:${incidentId}:${version}` (no tenant secret)
  incidentId: string;
  reportType: ComplianceReportType;
  version: number;
  schemaVersion: string;
  generatedAt: string;
  sourceIncidentUpdatedAt: string | null;
  previousSnapshotHash: string | null;
  snapshotPayload: CompliancePayload;
}

export function buildComplianceHashInput(payload: CompliancePayload, previousSnapshotHash: string | null): ComplianceHashInput {
  const m = payload.reportMetadata;
  return {
    tenantSafeIdentity: `${m.reportType}:${payload.incident.incidentId}:${m.version}`,
    incidentId: payload.incident.incidentId,
    reportType: m.reportType,
    version: m.version,
    schemaVersion: m.schemaVersion,
    generatedAt: m.generatedAt,
    sourceIncidentUpdatedAt: m.sourceIncidentUpdatedAt,
    previousSnapshotHash,
    snapshotPayload: payload,
  };
}

export function isSupportedComplianceSchema(schemaVersion: string): boolean {
  return SUPPORTED_COMPLIANCE_SCHEMA_VERSIONS.includes(schemaVersion);
}
