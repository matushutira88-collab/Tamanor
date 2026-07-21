/**
 * Cyberbullying Protection — C12 Redaction, Four-Eyes Approval & Export Prep (domain).
 *
 * PURE + crypto-free (client-safe via the `@guardora/core/cyberbullying-redaction`
 * subpath): the redaction/approval/export vocabulary, the CENTRAL redactable-field
 * registry (a strict allowlist of stable schema field paths — no client JSONPath),
 * the pure deterministic redaction transformer, deterministic identifier masking,
 * the unresolved-sensitive-field check, and the canonical hash inputs. No IO, no
 * crypto, no auto-decisions. The source snapshot is NEVER mutated.
 */

import { FieldClassification, ComplianceReportType, canonicalStringify, OmissionReason, type CompliancePayload } from "./cyberbullying-compliance";

// --- Vocabulary -------------------------------------------------------------

export enum RedactionDraftStatus { Draft = "draft", Submitted = "submitted", Approved = "approved", Rejected = "rejected", Superseded = "superseded", Cancelled = "cancelled" }

export enum RedactionAction { Remove = "remove", ReplaceWithLabel = "replace_with_label", MaskIdentifier = "mask_identifier", Keep = "keep" }
export const ALL_REDACTION_ACTIONS: readonly RedactionAction[] = Object.values(RedactionAction);
export function isRedactionAction(x: unknown): x is RedactionAction { return typeof x === "string" && (ALL_REDACTION_ACTIONS as readonly string[]).includes(x); }

export enum RedactionReasonCode {
  PersonalData = "PERSONAL_DATA", MinorProtection = "MINOR_PROTECTION", ContactData = "CONTACT_DATA", LocationData = "LOCATION_DATA",
  ConfidentialNote = "CONFIDENTIAL_NOTE", AllegedActorData = "ALLEGED_ACTOR_DATA", InternalSecurityData = "INTERNAL_SECURITY_DATA",
  LegalRestriction = "LEGAL_RESTRICTION", DataMinimization = "DATA_MINIMIZATION", OutOfScope = "OUT_OF_SCOPE", Other = "OTHER",
}
export const ALL_REDACTION_REASONS: readonly RedactionReasonCode[] = Object.values(RedactionReasonCode);
export function isRedactionReason(x: unknown): x is RedactionReasonCode { return typeof x === "string" && (ALL_REDACTION_REASONS as readonly string[]).includes(x); }
export function redactionReasonRequiresNote(r: RedactionReasonCode): boolean { return r === RedactionReasonCode.Other; }

export enum RedactionRejectionReason {
  IncompleteRedaction = "INCOMPLETE_REDACTION", ExcessiveRedaction = "EXCESSIVE_REDACTION", WrongRecipientScope = "WRONG_RECIPIENT_SCOPE",
  RequiredFieldRemoved = "REQUIRED_FIELD_REMOVED", SensitiveFieldUnresolved = "SENSITIVE_FIELD_UNRESOLVED", IncorrectReason = "INCORRECT_REASON",
  SourceReportOutdated = "SOURCE_REPORT_OUTDATED", Other = "OTHER",
}
export function isRedactionRejectionReason(x: unknown): x is RedactionRejectionReason { return typeof x === "string" && Object.values(RedactionRejectionReason).includes(x as RedactionRejectionReason); }

export enum ExportAuthorizationStatus { Requested = "requested", Approved = "approved", Rejected = "rejected", Cancelled = "cancelled", Expired = "expired", Consumed = "consumed" }
export enum ExportPurposeCode {
  InternalCaseReview = "INTERNAL_CASE_REVIEW", LegalReview = "LEGAL_REVIEW", LawEnforcementRequest = "LAW_ENFORCEMENT_REQUEST", SchoolSafetyReview = "SCHOOL_SAFETY_REVIEW",
  GuardianRequest = "GUARDIAN_REQUEST", PlatformReporting = "PLATFORM_REPORTING", RegulatoryRequest = "REGULATORY_REQUEST", Other = "OTHER",
}
export function isExportPurpose(x: unknown): x is ExportPurposeCode { return typeof x === "string" && Object.values(ExportPurposeCode).includes(x as ExportPurposeCode); }
export enum RecipientType {
  InternalAuthorizedUser = "INTERNAL_AUTHORIZED_USER", LegalCounsel = "LEGAL_COUNSEL", LawEnforcement = "LAW_ENFORCEMENT", SchoolAuthority = "SCHOOL_AUTHORITY",
  Guardian = "GUARDIAN", PlatformTrustSafety = "PLATFORM_TRUST_SAFETY", Regulator = "REGULATOR", Other = "OTHER",
}
export function isRecipientType(x: unknown): x is RecipientType { return typeof x === "string" && Object.values(RecipientType).includes(x as RecipientType); }
export const EXPORT_AUTHORIZATION_TTL_HOURS = 168; // 7 days
export enum ExportPackageStatus { Prepared = "prepared", Revoked = "revoked" }

/** Language-independent redaction markers (the DB never stores a translated string). */
export enum ReplacementMarker {
  PersonalData = "REDACTED_PERSONAL_DATA", MinorData = "REDACTED_MINOR_DATA", Confidential = "REDACTED_CONFIDENTIAL",
  Internal = "REDACTED_INTERNAL", Contact = "REDACTED_CONTACT", Location = "REDACTED_LOCATION",
}

// --- Redactable-field registry (strict allowlist over the C11 payload) -------

export interface RedactableField {
  fieldPath: string;
  classification: FieldClassification;
  allowedActions: RedactionAction[];
  requiredInFinal: boolean; // REMOVE is rejected for required fields
  defaultMarker: ReplacementMarker;
  displayLabelKey: string;
  applicableReportTypes: ComplianceReportType[];
  schemaVersions: string[];
}

const BOTH = [ComplianceReportType.CaseSummary, ComplianceReportType.EvidencePackage];
const V1 = ["1.0.0"];
const R = RedactionAction;

export const COMPLIANCE_REDACTABLE_FIELDS: readonly RedactableField[] = [
  { fieldPath: "protectedSubject.displayLabel", classification: FieldClassification.HighlySensitive, allowedActions: [R.Remove, R.ReplaceWithLabel, R.MaskIdentifier, R.Keep], requiredInFinal: false, defaultMarker: ReplacementMarker.MinorData, displayLabelKey: "protectedSubject", applicableReportTypes: BOTH, schemaVersions: V1 },
  { fieldPath: "assignments.primaryReviewerUserId", classification: FieldClassification.Internal, allowedActions: [R.MaskIdentifier, R.ReplaceWithLabel, R.Keep], requiredInFinal: false, defaultMarker: ReplacementMarker.Internal, displayLabelKey: "primaryReviewer", applicableReportTypes: BOTH, schemaVersions: V1 },
  { fieldPath: "assignments.participants[*].userId", classification: FieldClassification.Internal, allowedActions: [R.MaskIdentifier, R.ReplaceWithLabel, R.Keep], requiredInFinal: false, defaultMarker: ReplacementMarker.Internal, displayLabelKey: "participantUser", applicableReportTypes: BOTH, schemaVersions: V1 },
  { fieldPath: "assignments.participants[*].subjectLabel", classification: FieldClassification.Sensitive, allowedActions: [R.Remove, R.ReplaceWithLabel, R.MaskIdentifier, R.Keep], requiredInFinal: false, defaultMarker: ReplacementMarker.PersonalData, displayLabelKey: "participantLabel", applicableReportTypes: BOTH, schemaVersions: V1 },
  { fieldPath: "detections[*].confidence", classification: FieldClassification.Internal, allowedActions: [R.Remove, R.Keep], requiredInFinal: false, defaultMarker: ReplacementMarker.Internal, displayLabelKey: "detectionConfidence", applicableReportTypes: BOTH, schemaVersions: V1 },
  { fieldPath: "evidenceInventory[*].submittedByUserId", classification: FieldClassification.Internal, allowedActions: [R.MaskIdentifier, R.ReplaceWithLabel, R.Keep], requiredInFinal: false, defaultMarker: ReplacementMarker.Internal, displayLabelKey: "evidenceUploader", applicableReportTypes: BOTH, schemaVersions: V1 },
  { fieldPath: "custodySummary[*].actorUserId", classification: FieldClassification.Internal, allowedActions: [R.MaskIdentifier, R.ReplaceWithLabel, R.Keep], requiredInFinal: false, defaultMarker: ReplacementMarker.Internal, displayLabelKey: "custodyActor", applicableReportTypes: BOTH, schemaVersions: V1 },
  { fieldPath: "chronology[*].actorUserId", classification: FieldClassification.Internal, allowedActions: [R.MaskIdentifier, R.ReplaceWithLabel, R.Keep], requiredInFinal: false, defaultMarker: ReplacementMarker.Internal, displayLabelKey: "chronologyActor", applicableReportTypes: BOTH, schemaVersions: V1 },
  { fieldPath: "caseManagement.tasks[*].assigneeUserId", classification: FieldClassification.Internal, allowedActions: [R.MaskIdentifier, R.ReplaceWithLabel, R.Keep], requiredInFinal: false, defaultMarker: ReplacementMarker.Internal, displayLabelKey: "taskAssignee", applicableReportTypes: BOTH, schemaVersions: V1 },
  { fieldPath: "slaAndEscalation.activeEscalation.targetUserId", classification: FieldClassification.Internal, allowedActions: [R.MaskIdentifier, R.ReplaceWithLabel, R.Keep], requiredInFinal: false, defaultMarker: ReplacementMarker.Internal, displayLabelKey: "escalationTarget", applicableReportTypes: BOTH, schemaVersions: V1 },
  { fieldPath: "slaAndEscalation.activeEscalation.escalatedByUserId", classification: FieldClassification.Internal, allowedActions: [R.MaskIdentifier, R.ReplaceWithLabel, R.Keep], requiredInFinal: false, defaultMarker: ReplacementMarker.Internal, displayLabelKey: "escalatedBy", applicableReportTypes: BOTH, schemaVersions: V1 },
];

const FIELD_BY_PATH = new Map(COMPLIANCE_REDACTABLE_FIELDS.map((f) => [f.fieldPath, f]));
export function getRedactableField(fieldPath: string): RedactableField | null { return FIELD_BY_PATH.get(fieldPath) ?? null; }
export function isRedactableFieldPath(fieldPath: string, reportType: ComplianceReportType, schemaVersion: string): boolean {
  const f = FIELD_BY_PATH.get(fieldPath);
  return !!f && f.applicableReportTypes.includes(reportType) && f.schemaVersions.includes(schemaVersion);
}

/** Validate a single rule (path allowlisted, action allowed, reason valid). Returns an error code or null. */
export type RedactionRuleErrorCode = "unknown_field" | "action_not_allowed" | "required_field_remove" | "invalid_reason" | "missing_note";
export function validateRedactionRule(input: { fieldPath: string; action: string; reasonCode: string; reasonNote?: string | null; reportType: ComplianceReportType; schemaVersion: string }): RedactionRuleErrorCode | null {
  const f = FIELD_BY_PATH.get(input.fieldPath);
  if (!f || !f.applicableReportTypes.includes(input.reportType) || !f.schemaVersions.includes(input.schemaVersion)) return "unknown_field";
  if (!isRedactionAction(input.action)) return "action_not_allowed";
  if (!f.allowedActions.includes(input.action)) return "action_not_allowed";
  if (input.action === RedactionAction.Remove && f.requiredInFinal) return "required_field_remove";
  if (!isRedactionReason(input.reasonCode)) return "invalid_reason";
  if (redactionReasonRequiresNote(input.reasonCode as RedactionReasonCode) && !(input.reasonNote ?? "").trim()) return "missing_note";
  return null;
}

// --- Deterministic identifier masking ---------------------------------------

/** Mask an identifier deterministically: keep the first & last 4 chars, mask the middle. Non-reversible. */
export function maskIdentifier(value: string): string {
  const v = String(value);
  if (v.length <= 8) return v.slice(0, 1) + "•".repeat(Math.max(1, v.length - 2)) + v.slice(-1);
  return v.slice(0, 4) + "•".repeat(4) + v.slice(-4);
}

// --- Pure redaction transformer ---------------------------------------------

export interface RedactionRuleSpec { fieldPath: string; action: RedactionAction; reasonCode: RedactionReasonCode; replacementMarkerKey?: ReplacementMarker | null; order: number }

export interface RedactionSummary {
  removed: string[]; replaced: string[]; masked: string[]; kept: string[];
  affectedClassifications: FieldClassification[];
  ruleCount: number;
}
export interface DiffSummary { removedCount: number; replacedCount: number; maskedCount: number; keptSensitiveCount: number; affectedClassifications: FieldClassification[]; unresolvedSensitiveCount: number }

/** Resolve a registry field path to concrete {parent, key} targets in `root` (supports one/two `[*]`). */
function resolveTargets(root: unknown, fieldPath: string): { parent: Record<string, unknown>; key: string }[] {
  const segments = fieldPath.split(".");
  let cursors: unknown[] = [root];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const isLast = i === segments.length - 1;
    const wildcard = seg.endsWith("[*]");
    const key = wildcard ? seg.slice(0, -3) : seg;
    const next: unknown[] = [];
    for (const cur of cursors) {
      if (!cur || typeof cur !== "object") continue;
      const container = cur as Record<string, unknown>;
      if (wildcard) {
        const arr = container[key];
        if (!Array.isArray(arr)) continue;
        if (isLast) { /* array itself as last is unsupported */ }
        for (const el of arr) next.push(el);
      } else if (isLast) {
        next.push({ __parent: container, __key: key });
      } else {
        next.push(container[key]);
      }
    }
    cursors = next;
  }
  return cursors.filter((c): c is { __parent: Record<string, unknown>; __key: string } => !!c && typeof c === "object" && "__parent" in (c as object))
    .map((c) => ({ parent: c.__parent, key: c.__key }));
}

/**
 * Apply validated redaction rules to a source payload. PURE + deterministic: it deep-
 * clones the source (never mutates it), applies rules in `order`, records a summary,
 * and appends the redaction provenance to omissions. Unknown fields are impossible
 * (rules are registry-validated upstream).
 */
export function applyComplianceRedactions(source: CompliancePayload, rules: RedactionRuleSpec[]): { payload: CompliancePayload; summary: RedactionSummary } {
  const clone: CompliancePayload = JSON.parse(JSON.stringify(source));
  const removed: string[] = [], replaced: string[] = [], masked: string[] = [], kept: string[] = [];
  const classes = new Set<FieldClassification>();
  const ordered = [...rules].sort((a, b) => a.order - b.order);

  for (const rule of ordered) {
    const field = FIELD_BY_PATH.get(rule.fieldPath);
    if (!field) continue; // registry-validated upstream; defensive
    classes.add(field.classification);
    const targets = resolveTargets(clone, rule.fieldPath);
    for (const { parent, key } of targets) {
      if (!(key in parent)) continue;
      switch (rule.action) {
        case RedactionAction.Remove: if (!field.requiredInFinal) { delete parent[key]; } break;
        case RedactionAction.ReplaceWithLabel: parent[key] = (rule.replacementMarkerKey ?? field.defaultMarker); break;
        case RedactionAction.MaskIdentifier: if (parent[key] != null) parent[key] = maskIdentifier(String(parent[key])); break;
        case RedactionAction.Keep: break;
      }
    }
    if (rule.action === RedactionAction.Remove) removed.push(rule.fieldPath);
    else if (rule.action === RedactionAction.ReplaceWithLabel) replaced.push(rule.fieldPath);
    else if (rule.action === RedactionAction.MaskIdentifier) masked.push(rule.fieldPath);
    else kept.push(rule.fieldPath);
  }

  const summary: RedactionSummary = { removed, replaced, masked, kept, affectedClassifications: [...classes], ruleCount: rules.length };
  // Record removals in omissions (machine-readable; no content).
  const om = clone.omissions ?? [];
  for (const path of removed) om.push({ path, reason: OmissionReason.UnsupportedField });
  clone.omissions = om;
  return { payload: clone, summary };
}

/** Unresolved SENSITIVE / HIGHLY_SENSITIVE fields = present in source but not covered by a rule. */
export function computeUnresolvedSensitiveFields(source: CompliancePayload, ruleFieldPaths: string[]): { highlySensitive: string[]; sensitive: string[] } {
  const covered = new Set(ruleFieldPaths);
  const highly: string[] = [], sens: string[] = [];
  for (const field of COMPLIANCE_REDACTABLE_FIELDS) {
    if (field.classification !== FieldClassification.Sensitive && field.classification !== FieldClassification.HighlySensitive) continue;
    if (covered.has(field.fieldPath)) continue;
    const present = resolveTargets(source, field.fieldPath).some(({ parent, key }) => key in parent && parent[key] != null);
    if (!present) continue;
    if (field.classification === FieldClassification.HighlySensitive) highly.push(field.fieldPath);
    else sens.push(field.fieldPath);
  }
  return { highlySensitive: highly, sensitive: sens };
}

export function diffSummaryFrom(summary: RedactionSummary, unresolvedSensitiveCount: number): DiffSummary {
  return { removedCount: summary.removed.length, replacedCount: summary.replaced.length, maskedCount: summary.masked.length, keptSensitiveCount: summary.kept.length, affectedClassifications: summary.affectedClassifications, unresolvedSensitiveCount };
}

// --- Canonical hash inputs (SHA-256 done in @guardora/db) --------------------

export function buildRedactionRuleSetHashInput(input: { sourceReportId: string; sourceSnapshotHash: string; draftRevision: number; rules: RedactionRuleSpec[] }): unknown {
  return {
    sourceReportId: input.sourceReportId, sourceSnapshotHash: input.sourceSnapshotHash, draftRevision: input.draftRevision,
    rules: [...input.rules].sort((a, b) => a.order - b.order).map((r) => ({ fieldPath: r.fieldPath, action: r.action, reasonCode: r.reasonCode, replacementMarkerKey: r.replacementMarkerKey ?? null, order: r.order })), // no OTHER note
  };
}
export function computeCanonical(value: unknown): string { return canonicalStringify(value); }

export function buildAuthorizationHashInput(input: { authorizationId: string; reportId: string; reportHash: string; purposeCode: string; recipientType: string; requestedByUserId: string; approvedByUserId: string | null; requestedAt: string; approvedAt: string | null; expiresAt: string; status: string }): unknown {
  return { ...input }; // no internal OTHER note
}
export function buildManifestHashInput(input: { manifestIdentity: string; reportHash: string; authorizationHash: string; redactionRuleSetHash: string | null; purposeCode: string; recipientType: string; preparedAt: string; packageVersion: number; previousManifestHash: string | null; manifestPayload: unknown }): unknown {
  return { ...input };
}
