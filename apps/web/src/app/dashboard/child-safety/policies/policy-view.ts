/**
 * Child Safety Policy Engine V1 — PURE view-model (no React, no I/O). Deterministic presentation helpers:
 * lifecycle-status tones + immutability, per-version UI action availability (a UI MIRROR of server policy,
 * never the security boundary), short hashes, and a bounded simulation-decision summary. No raw content,
 * no executable content — policy is data.
 */
// Import from the specific BROWSER-SAFE core subpath (not the "@guardora/core" barrel), so this shared
// client module never drags the barrel's server-only crypto modules (hibp → node:crypto) into the bundle.
import { ChildSafetyPolicyStatus, isImmutablePolicyStatus, type ChildSafetyPolicyEngineDecision } from "@guardora/core/child-safety-policy";

export type Tone = "neutral" | "brand" | "ok" | "warn" | "danger";

export function policyStatusTone(status: string): Tone {
  switch (status) {
    case ChildSafetyPolicyStatus.Active: return "ok";
    case ChildSafetyPolicyStatus.PendingApproval: return "warn";
    case ChildSafetyPolicyStatus.Rejected: return "danger";
    case ChildSafetyPolicyStatus.Draft: return "brand";
    default: return "neutral"; // RETIRED
  }
}

/** Whether a version is immutable (drives the read-only / no-edit UI + the immutable badge). */
export function isImmutableVersion(status: string): boolean {
  return isImmutablePolicyStatus(status);
}

/** Which lifecycle affordances a role MAY see for a version (server re-enforces all of them). */
export interface PolicyUiCapabilities { manage: boolean; submit: boolean; approve: boolean; activate: boolean; simulate: boolean; }
export interface VersionUiActions { canEdit: boolean; canSubmit: boolean; canApprove: boolean; canReject: boolean; canActivate: boolean; canSimulate: boolean; }
export function versionUiActions(status: string, caps: PolicyUiCapabilities): VersionUiActions {
  const draft = status === ChildSafetyPolicyStatus.Draft;
  const pending = status === ChildSafetyPolicyStatus.PendingApproval;
  return {
    canEdit: draft && caps.manage,
    canSubmit: draft && caps.submit,
    canApprove: pending && caps.approve,
    canReject: pending && caps.approve,
    canActivate: pending && caps.activate,
    canSimulate: caps.simulate, // any version may be simulated by an authorized user
  };
}

/** Short, non-identifying hash for compact display. */
export function shortHash(h: string): string {
  return typeof h === "string" && h.length > 12 ? `${h.slice(0, 8)}…${h.slice(-4)}` : (h ?? "—");
}

/** A bounded, human-orderable list of the effect flags a merged decision carries (for the sim summary). */
export function decisionSummaryFlags(d: ChildSafetyPolicyEngineDecision): string[] {
  const flags: string[] = [];
  if (d.manualOnly) flags.push("manual_only");
  if (d.requireSupervisorReview) flags.push("require_supervisor_review");
  else if (d.requireReview) flags.push("require_review");
  if (d.createIncident) flags.push("create_incident");
  if (d.updateIncident) flags.push("update_incident");
  if (d.recommendedSeverity) flags.push(`severity:${d.recommendedSeverity}`);
  if (d.recommendedUrgency) flags.push(`urgency:${d.recommendedUrgency}`);
  if (d.recommendEscalation) flags.push("escalate");
  if (d.escalationLevel) flags.push(`escalation:${d.escalationLevel}`);
  if (d.proposeProtectionPlan) flags.push("propose_plan");
  if (d.proposedActions.length) flags.push(`actions:${d.proposedActions.length}`);
  if (d.allowAutomaticIntervention) flags.push("auto_intervention_allowed");
  if (d.requireManualInterventionApproval) flags.push("manual_intervention_approval");
  if (d.allowGuardianContactConsideration) flags.push("guardian_contact_considered");
  if (d.prohibitGuardianContact) flags.push("guardian_contact_prohibited");
  return flags;
}

/** Deterministic UTC "YYYY-MM-DD HH:mm" (hydration-safe). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
