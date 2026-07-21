/**
 * Cyberbullying Protection — C3 Incident Core (domain).
 *
 * Types, enums, and the pure lifecycle transition function for cyberbullying
 * incidents, built on the SINGLE `Incident` ledger (ADR-0001) and the SINGLE
 * canonical lifecycle (ADR-0002, in security.ts). No parallel case ledger, no
 * second lifecycle. Detection ≠ incident; `confirmed` requires a human.
 */

import {
  IncidentLifecycleStatus,
  canTransitionIncident,
  incidentTransitionRequiresReason,
  INCIDENT_REOPEN_TRANSITIONS,
  TERMINAL_INCIDENT_STATUSES,
} from "./security";

// --- Enums -----------------------------------------------------------------

/** How a cyberbullying incident was opened. */
export enum IncidentReportSource {
  ManualReport = "manual_report",
  Detection = "detection",
}

/**
 * A person's role in an incident. `alleged_actor` is deliberate — the system
 * NEVER labels a person a confirmed/guilty attacker without human review.
 */
export enum IncidentParticipantRole {
  ProtectedSubject = "protected_subject",
  Reporter = "reporter",
  AllegedActor = "alleged_actor",
  Reviewer = "reviewer",
  TrustedContact = "trusted_contact",
}

/** Append-only, human-readable case timeline event types. */
export enum IncidentTimelineEventType {
  Created = "created",
  ReviewStarted = "review_started",
  Acknowledged = "acknowledged",
  Confirmed = "confirmed",
  Dismissed = "dismissed",
  ActionRequired = "action_required",
  Resolved = "resolved",
  Archived = "archived",
  Reopened = "reopened",
  DetectionLinked = "detection_linked",
  EvidenceLinked = "evidence_linked",
  ParticipantAdded = "participant_added",
  ParticipantRemoved = "participant_removed",
}

// --- Domain shapes (plain; NOT Prisma) -------------------------------------

export interface CyberbullyingIncidentDetail {
  id: string;
  tenantId: string;
  incidentId: string;
  protectedSubjectId: string;
  reportSource: IncidentReportSource;
  /** Confidential — never logged. */
  summary: string;
  allegedActorLabel: string | null;
  allegedActorExternalReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IncidentParticipant {
  id: string;
  tenantId: string;
  incidentId: string;
  role: IncidentParticipantRole;
  protectedSubjectId: string | null;
  userId: string | null;
  externalReference: string | null;
  createdAt: Date;
}

export interface IncidentDetectionLink {
  id: string;
  tenantId: string;
  incidentId: string;
  securityDetectionId: string;
  linkedByUserId: string | null;
  linkReason: string;
  createdAt: Date;
}

export interface IncidentTimelineEvent {
  id: string;
  tenantId: string;
  incidentId: string;
  eventType: IncidentTimelineEventType;
  actorUserId: string | null;
  reason: string | null;
  createdAt: Date;
}

// --- Lifecycle transition (pure, domain-validated) -------------------------

export type IncidentTransitionError = "illegal_transition" | "terminal" | "no_change" | "reason_required";

export interface IncidentTransitionResult {
  ok: boolean;
  from: IncidentLifecycleStatus;
  to: IncidentLifecycleStatus;
  /** True when this was performed as an explicit reopen (elevated + reason). */
  reopen: boolean;
  error?: IncidentTransitionError;
}

/**
 * Validate an incident transition. Forward transitions use the canonical matrix;
 * `reopen` uses the elevated reopen map (out of a terminal/resolved state). A
 * mandatory-reason target without a reason is rejected (`reason_required`).
 * Identity (from == to) is `no_change`. Pure — no side effects.
 */
export function applyIncidentTransition(
  from: IncidentLifecycleStatus,
  to: IncidentLifecycleStatus,
  opts: { reopen?: boolean; reason?: string | null } = {},
): IncidentTransitionResult {
  const base = { from, to, reopen: !!opts.reopen };
  if (from === to) return { ...base, ok: false, error: "no_change" };

  if (opts.reopen) {
    const target = INCIDENT_REOPEN_TRANSITIONS[from];
    if (!target || target !== to) {
      return { ...base, ok: false, error: TERMINAL_INCIDENT_STATUSES.includes(from) || from === IncidentLifecycleStatus.Resolved ? "illegal_transition" : "illegal_transition" };
    }
    if (!opts.reason || opts.reason.trim() === "") return { ...base, ok: false, error: "reason_required" };
    return { ...base, ok: true };
  }

  if (!canTransitionIncident(from, to)) {
    const error: IncidentTransitionError = TERMINAL_INCIDENT_STATUSES.includes(from) ? "terminal" : "illegal_transition";
    return { ...base, ok: false, error };
  }
  if (incidentTransitionRequiresReason(to) && (!opts.reason || opts.reason.trim() === "")) {
    return { ...base, ok: false, error: "reason_required" };
  }
  return { ...base, ok: true };
}

// --- Server CONTRACT (interface) -------------------------------------------

/** Actor context for a write. Role drives RBAC; userId is the audit actor. */
export interface IncidentActorContext {
  tenantId: string;
  userId: string;
  role: string;
}

/**
 * Contract for the incident service (implemented in @guardora/db). Every write is
 * tenant-scoped, permission-checked, transactional, audited, and fail-closed.
 */
export interface CyberbullyingIncidentService {
  createFromManualReport(actor: IncidentActorContext, input: { protectedSubjectId: string; summary: string; severity?: string; title?: string; allegedActorLabel?: string | null; allegedActorExternalReference?: string | null }): Promise<{ incidentId: string }>;
  createFromDetections(actor: IncidentActorContext, input: { protectedSubjectId: string; summary: string; detectionIds: string[]; severity?: string; title?: string }): Promise<{ incidentId: string }>;
  linkDetection(actor: IncidentActorContext, incidentId: string, securityDetectionId: string, linkReason: string): Promise<{ linkId: string; created: boolean }>;
  linkEvidence(actor: IncidentActorContext, incidentId: string, evidenceId: string): Promise<void>;
  addParticipant(actor: IncidentActorContext, incidentId: string, input: { role: IncidentParticipantRole; protectedSubjectId?: string | null; userId?: string | null; externalReference?: string | null }): Promise<{ participantId: string; created: boolean }>;
  removeParticipant(actor: IncidentActorContext, incidentId: string, participantId: string): Promise<void>;
  transition(actor: IncidentActorContext, incidentId: string, to: IncidentLifecycleStatus, reason?: string): Promise<IncidentTransitionResult>;
  reopen(actor: IncidentActorContext, incidentId: string, reason: string): Promise<IncidentTransitionResult>;
}
