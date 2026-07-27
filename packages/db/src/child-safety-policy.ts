/**
 * Child Safety Policy Engine V1 — the operational service layer (SYSTEM-scoped, systemDb).
 *
 * Governs the policy lifecycle (draft → pending → active/retired/rejected) with IMMUTABLE-after-activation
 * versions and TWO-PERSON activation control, resolves the tenant's active policy, runs the DETERMINISTIC
 * core engine, and persists an APPEND-ONLY, content-free decision audit. Every function is tenant-isolated
 * by an explicit `tenantId` (SYSTEM tables — RLS is not the enforcement; explicit scoping + composite
 * (id, tenantId) FKs are). Evaluation is FAIL-CLOSED: any missing/invalid/erroring policy yields a safe
 * manual-review decision, never permissive behavior. Policy is DATA — this layer never executes tenant code.
 */
import { createHash } from "node:crypto";
import { ActorKind } from "@prisma/client";
import {
  Role,
  ChildSafetyPolicyPurpose, ChildSafetyPolicyStatus, isImmutablePolicyStatus, isPolicyPurpose,
  CHILD_SAFETY_POLICY_ENGINE_VERSION, CHILD_SAFETY_POLICY_SCHEMA_VERSION,
  validateChildSafetyPolicyDefinition, evaluateChildSafetyPolicy, failClosedDecision, canonicalPolicyInput,
  canManageChildSafetyPolicy, canSubmitChildSafetyPolicy, canApproveChildSafetyPolicy,
  canActivateChildSafetyPolicy, canSimulateChildSafetyPolicy, canViewChildSafetyPolicy, canViewChildSafetyPolicyDecisions,
  type ChildSafetyPolicyDefinition, type ChildSafetyPolicyEvaluationResult, type ChildSafetyPolicyValidationResult,
} from "@guardora/core";
import { systemDb } from "./index";

export interface PolicyActor { tenantId: string; userId: string; membershipId: string; role: Role; }

export class ChildSafetyPolicyForbiddenError extends Error { constructor(public readonly reason: string) { super("child_safety_policy_forbidden"); } }
export class ChildSafetyPolicyNotFoundError extends Error { constructor() { super("child_safety_policy_not_found"); } }
export class ChildSafetyPolicyStateError extends Error { constructor(public readonly code: string) { super(code); } }

const MAX_SIMULATION_CASES = 100;
const DECISION_PAGE_DEFAULT = 25;
const DECISION_PAGE_MAX = 100;

// ── Deterministic hashing (server-only). ──────────────────────────────────────
/** Stable-key JSON so the definition hash is deterministic regardless of author key order. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
export const definitionHashOf = (def: unknown): string => sha256(stableStringify(def));

/** Content-free audit. A null/"system" actor records a SYSTEM event (no user FK); otherwise a human event. */
async function audit(tenantId: string, actorUserId: string | null, event: string, targetId: string, metadata: Record<string, string | number | boolean>): Promise<void> {
  const isSystem = !actorUserId || actorUserId === "system";
  await systemDb.auditLog.create({ data: { tenantId, event, actorKind: isSystem ? ActorKind.system : ActorKind.human, ...(isSystem ? {} : { actorUserId }), targetType: "child_safety_policy", targetId, metadata: metadata as never } }).catch(() => {});
}

// ── Authorization guards. ─────────────────────────────────────────────────────
const assertView = (a: PolicyActor) => { if (!canViewChildSafetyPolicy(a.role)) throw new ChildSafetyPolicyForbiddenError("view"); };
const assertManage = (a: PolicyActor) => { if (!canManageChildSafetyPolicy(a.role)) throw new ChildSafetyPolicyForbiddenError("manage"); };
const assertSubmit = (a: PolicyActor) => { if (!canSubmitChildSafetyPolicy(a.role)) throw new ChildSafetyPolicyForbiddenError("submit"); };
const assertApprove = (a: PolicyActor) => { if (!canApproveChildSafetyPolicy(a.role)) throw new ChildSafetyPolicyForbiddenError("approve"); };
const assertActivate = (a: PolicyActor) => { if (!canActivateChildSafetyPolicy(a.role)) throw new ChildSafetyPolicyForbiddenError("activate"); };
const assertSimulate = (a: PolicyActor) => { if (!canSimulateChildSafetyPolicy(a.role)) throw new ChildSafetyPolicyForbiddenError("simulate"); };
const assertDecisionView = (a: PolicyActor) => { if (!canViewChildSafetyPolicyDecisions(a.role)) throw new ChildSafetyPolicyForbiddenError("decision_view"); };

async function requirePolicy(tenantId: string, policyId: string) {
  const p = await systemDb.childSafetyPolicy.findFirst({ where: { id: policyId, tenantId } });
  if (!p) throw new ChildSafetyPolicyNotFoundError();
  return p;
}
async function requireVersion(tenantId: string, versionId: string) {
  const v = await systemDb.childSafetyPolicyVersion.findFirst({ where: { id: versionId, tenantId } });
  if (!v) throw new ChildSafetyPolicyNotFoundError();
  return v;
}

// ── Definition validation (pure passthrough to the core validator). ───────────
export function validatePolicyDefinition(def: unknown): ChildSafetyPolicyValidationResult {
  return validateChildSafetyPolicyDefinition(def);
}

// ── Lifecycle: create policy (+ first draft version). ─────────────────────────
export async function createChildSafetyPolicy(actor: PolicyActor, input: { policyKey: string; purpose: string; displayName: string; description?: string; definition: unknown }): Promise<{ policyId: string; versionId: string }> {
  assertManage(actor);
  if (!isPolicyPurpose(input.purpose)) throw new ChildSafetyPolicyStateError("bad_purpose");
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(input.policyKey)) throw new ChildSafetyPolicyStateError("bad_policy_key");
  if (typeof input.displayName !== "string" || !input.displayName.trim() || input.displayName.length > 120) throw new ChildSafetyPolicyStateError("bad_display_name");
  const val = validateChildSafetyPolicyDefinition(input.definition);
  if (!val.valid) throw new ChildSafetyPolicyStateError("invalid_definition");
  if ((input.definition as ChildSafetyPolicyDefinition).purpose !== input.purpose) throw new ChildSafetyPolicyStateError("purpose_mismatch");

  const dup = await systemDb.childSafetyPolicy.findFirst({ where: { tenantId: actor.tenantId, policyKey: input.policyKey }, select: { id: true } });
  if (dup) throw new ChildSafetyPolicyStateError("duplicate_policy_key");

  const created = await systemDb.$transaction(async (tx) => {
    const policy = await tx.childSafetyPolicy.create({ data: { tenantId: actor.tenantId, policyKey: input.policyKey, purpose: input.purpose, displayName: input.displayName.trim(), description: input.description?.slice(0, 2000) ?? null, createdByMembershipId: actor.membershipId } });
    const version = await tx.childSafetyPolicyVersion.create({ data: {
      tenantId: actor.tenantId, policyId: policy.id, versionNumber: 1, status: ChildSafetyPolicyStatus.Draft,
      schemaVersion: CHILD_SAFETY_POLICY_SCHEMA_VERSION, engineVersion: CHILD_SAFETY_POLICY_ENGINE_VERSION,
      definitionJson: input.definition as never, definitionHash: definitionHashOf(input.definition), createdByMembershipId: actor.membershipId,
    } });
    return { policyId: policy.id, versionId: version.id };
  });
  await audit(actor.tenantId, actor.userId, "child_safety.policy.created", created.policyId, { policyKey: input.policyKey, purpose: input.purpose });
  await audit(actor.tenantId, actor.userId, "child_safety.policy.version_created", created.versionId, { versionNumber: 1 });
  return created;
}

/** Create a NEW draft version of an existing policy (next version number). */
export async function createChildSafetyPolicyVersion(actor: PolicyActor, policyId: string, definition: unknown): Promise<{ versionId: string; versionNumber: number }> {
  assertManage(actor);
  const policy = await requirePolicy(actor.tenantId, policyId);
  const val = validateChildSafetyPolicyDefinition(definition);
  if (!val.valid) throw new ChildSafetyPolicyStateError("invalid_definition");
  if ((definition as ChildSafetyPolicyDefinition).purpose !== policy.purpose) throw new ChildSafetyPolicyStateError("purpose_mismatch");
  const latest = await systemDb.childSafetyPolicyVersion.findFirst({ where: { tenantId: actor.tenantId, policyId }, orderBy: { versionNumber: "desc" }, select: { versionNumber: true } });
  const versionNumber = (latest?.versionNumber ?? 0) + 1;
  const v = await systemDb.childSafetyPolicyVersion.create({ data: {
    tenantId: actor.tenantId, policyId, versionNumber, status: ChildSafetyPolicyStatus.Draft,
    schemaVersion: CHILD_SAFETY_POLICY_SCHEMA_VERSION, engineVersion: CHILD_SAFETY_POLICY_ENGINE_VERSION,
    definitionJson: definition as never, definitionHash: definitionHashOf(definition), createdByMembershipId: actor.membershipId,
  } });
  await audit(actor.tenantId, actor.userId, "child_safety.policy.version_created", v.id, { versionNumber });
  return { versionId: v.id, versionNumber };
}

/** Edit a DRAFT version's definition. Immutable statuses are rejected. */
export async function updateChildSafetyPolicyDraft(actor: PolicyActor, versionId: string, definition: unknown): Promise<{ versionId: string }> {
  assertManage(actor);
  const v = await requireVersion(actor.tenantId, versionId);
  if (v.status !== ChildSafetyPolicyStatus.Draft) throw new ChildSafetyPolicyStateError("not_draft");
  const val = validateChildSafetyPolicyDefinition(definition);
  if (!val.valid) throw new ChildSafetyPolicyStateError("invalid_definition");
  const policy = await requirePolicy(actor.tenantId, v.policyId);
  if ((definition as ChildSafetyPolicyDefinition).purpose !== policy.purpose) throw new ChildSafetyPolicyStateError("purpose_mismatch");
  // Guarded update — only a still-DRAFT row is edited (a concurrent submit/activate fails this closed).
  const res = await systemDb.childSafetyPolicyVersion.updateMany({ where: { id: versionId, tenantId: actor.tenantId, status: ChildSafetyPolicyStatus.Draft }, data: { definitionJson: definition as never, definitionHash: definitionHashOf(definition) } });
  if (res.count !== 1) throw new ChildSafetyPolicyStateError("not_draft");
  return { versionId };
}

/** Submit a valid DRAFT for approval (DRAFT → PENDING_APPROVAL). Immutable thereafter. */
export async function submitChildSafetyPolicyVersion(actor: PolicyActor, versionId: string): Promise<{ status: string }> {
  assertSubmit(actor);
  const v = await requireVersion(actor.tenantId, versionId);
  if (v.status !== ChildSafetyPolicyStatus.Draft) throw new ChildSafetyPolicyStateError("not_draft");
  const val = validateChildSafetyPolicyDefinition(v.definitionJson);
  if (!val.valid) throw new ChildSafetyPolicyStateError("invalid_definition");
  const res = await systemDb.childSafetyPolicyVersion.updateMany({ where: { id: versionId, tenantId: actor.tenantId, status: ChildSafetyPolicyStatus.Draft }, data: { status: ChildSafetyPolicyStatus.PendingApproval, submittedByMembershipId: actor.membershipId, submittedAt: new Date() } });
  if (res.count !== 1) throw new ChildSafetyPolicyStateError("not_draft");
  await audit(actor.tenantId, actor.userId, "child_safety.policy.submitted", versionId, {});
  return { status: ChildSafetyPolicyStatus.PendingApproval };
}

/** Approve a PENDING_APPROVAL version. TWO-PERSON: the approver must differ from the creator + submitter. */
export async function approveChildSafetyPolicyVersion(actor: PolicyActor, versionId: string, reasonCode?: string): Promise<{ approvalId: string }> {
  assertApprove(actor);
  const v = await requireVersion(actor.tenantId, versionId);
  if (v.status !== ChildSafetyPolicyStatus.PendingApproval) throw new ChildSafetyPolicyStateError("not_pending");
  if (actor.membershipId === v.createdByMembershipId || actor.membershipId === v.submittedByMembershipId) throw new ChildSafetyPolicyStateError("two_person_required");
  const a = await systemDb.childSafetyPolicyActivationApproval.create({ data: { tenantId: actor.tenantId, policyVersionId: versionId, decision: "approved", reasonCode: reasonCode?.slice(0, 64) ?? null, decidedByMembershipId: actor.membershipId } });
  await audit(actor.tenantId, actor.userId, "child_safety.policy.approved", versionId, { approvalId: a.id });
  return { approvalId: a.id };
}

/** Reject a PENDING_APPROVAL version (→ REJECTED, immutable). Two-person: rejecter differs from creator. */
export async function rejectChildSafetyPolicyVersion(actor: PolicyActor, versionId: string, reasonCode: string): Promise<{ status: string }> {
  assertApprove(actor);
  const v = await requireVersion(actor.tenantId, versionId);
  if (v.status !== ChildSafetyPolicyStatus.PendingApproval) throw new ChildSafetyPolicyStateError("not_pending");
  if (actor.membershipId === v.createdByMembershipId) throw new ChildSafetyPolicyStateError("two_person_required");
  await systemDb.$transaction(async (tx) => {
    await tx.childSafetyPolicyActivationApproval.create({ data: { tenantId: actor.tenantId, policyVersionId: versionId, decision: "rejected", reasonCode: (reasonCode || "rejected").slice(0, 64), decidedByMembershipId: actor.membershipId } });
    const res = await tx.childSafetyPolicyVersion.updateMany({ where: { id: versionId, tenantId: actor.tenantId, status: ChildSafetyPolicyStatus.PendingApproval }, data: { status: ChildSafetyPolicyStatus.Rejected, rejectedByMembershipId: actor.membershipId, rejectedAt: new Date(), rejectionReasonCode: (reasonCode || "rejected").slice(0, 64) } });
    if (res.count !== 1) throw new ChildSafetyPolicyStateError("not_pending");
  });
  await audit(actor.tenantId, actor.userId, "child_safety.policy.rejected", versionId, { reasonCode: (reasonCode || "rejected").slice(0, 64) });
  return { status: ChildSafetyPolicyStatus.Rejected };
}

/**
 * Activate an approved PENDING_APPROVAL version. ATOMIC + guarded: requires an `approved` approval by a
 * member other than the creator (two-person), retires the policy's current ACTIVE version, and promotes
 * this one — all in one transaction. The DB partial unique index (one ACTIVE per policy) is the ultimate
 * concurrency backstop, so two racing activations can never both win.
 */
export async function activateChildSafetyPolicyVersion(actor: PolicyActor, versionId: string): Promise<{ status: string; retiredVersionId: string | null }> {
  assertActivate(actor);
  const v = await requireVersion(actor.tenantId, versionId);
  if (v.status !== ChildSafetyPolicyStatus.PendingApproval) throw new ChildSafetyPolicyStateError("not_pending");
  const approval = await systemDb.childSafetyPolicyActivationApproval.findFirst({ where: { tenantId: actor.tenantId, policyVersionId: versionId, decision: "approved", decidedByMembershipId: { not: v.createdByMembershipId } }, select: { id: true } });
  if (!approval) throw new ChildSafetyPolicyStateError("approval_required");

  const result = await systemDb.$transaction(async (tx) => {
    // Retire the policy's current ACTIVE version (if any) BEFORE promoting, so the one-active index holds.
    const current = await tx.childSafetyPolicyVersion.findFirst({ where: { tenantId: actor.tenantId, policyId: v.policyId, status: ChildSafetyPolicyStatus.Active }, select: { id: true } });
    let retiredVersionId: string | null = null;
    if (current) {
      const r = await tx.childSafetyPolicyVersion.updateMany({ where: { id: current.id, tenantId: actor.tenantId, status: ChildSafetyPolicyStatus.Active }, data: { status: ChildSafetyPolicyStatus.Retired } });
      if (r.count !== 1) throw new ChildSafetyPolicyStateError("activation_conflict");
      retiredVersionId = current.id;
    }
    const promo = await tx.childSafetyPolicyVersion.updateMany({ where: { id: versionId, tenantId: actor.tenantId, status: ChildSafetyPolicyStatus.PendingApproval }, data: { status: ChildSafetyPolicyStatus.Active, activatedByMembershipId: actor.membershipId, activatedAt: new Date(), supersedesVersionId: retiredVersionId } });
    if (promo.count !== 1) throw new ChildSafetyPolicyStateError("activation_conflict");
    return { retiredVersionId };
  });
  await audit(actor.tenantId, actor.userId, "child_safety.policy.activated", versionId, { retiredVersionId: result.retiredVersionId ?? "" });
  if (result.retiredVersionId) await audit(actor.tenantId, actor.userId, "child_safety.policy.retired", result.retiredVersionId, { supersededBy: versionId });
  return { status: ChildSafetyPolicyStatus.Active, retiredVersionId: result.retiredVersionId };
}

// ── Reads. ────────────────────────────────────────────────────────────────────
export async function listChildSafetyPolicies(actor: PolicyActor, purpose?: string) {
  assertView(actor);
  const where: Record<string, unknown> = { tenantId: actor.tenantId };
  if (purpose && isPolicyPurpose(purpose)) where.purpose = purpose;
  const policies = await systemDb.childSafetyPolicy.findMany({ where, orderBy: [{ purpose: "asc" }, { policyKey: "asc" }], include: { versions: { orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true, status: true, activatedAt: true, createdAt: true } } } });
  return policies.map((p) => ({
    id: p.id, policyKey: p.policyKey, purpose: p.purpose, displayName: p.displayName, retiredAt: p.retiredAt?.toISOString() ?? null,
    activeVersion: p.versions.find((v) => v.status === ChildSafetyPolicyStatus.Active) ?? null,
    versionCount: p.versions.length,
    lastActivationAt: p.versions.map((v) => v.activatedAt).filter(Boolean).sort().pop()?.toISOString() ?? null,
  }));
}

export async function getChildSafetyPolicy(actor: PolicyActor, policyId: string) {
  assertView(actor);
  const p = await systemDb.childSafetyPolicy.findFirst({ where: { id: policyId, tenantId: actor.tenantId }, include: { versions: { orderBy: { versionNumber: "desc" } } } });
  if (!p) throw new ChildSafetyPolicyNotFoundError();
  return {
    id: p.id, policyKey: p.policyKey, purpose: p.purpose, displayName: p.displayName, description: p.description,
    createdAt: p.createdAt.toISOString(), retiredAt: p.retiredAt?.toISOString() ?? null,
    versions: p.versions.map((v) => ({
      id: v.id, versionNumber: v.versionNumber, status: v.status, immutable: isImmutablePolicyStatus(v.status),
      schemaVersion: v.schemaVersion, engineVersion: v.engineVersion, definitionHash: v.definitionHash,
      definition: v.status === ChildSafetyPolicyStatus.Draft ? v.definitionJson : v.definitionJson, // definitions are content-free policy data
      createdAt: v.createdAt.toISOString(), submittedAt: v.submittedAt?.toISOString() ?? null,
      activatedAt: v.activatedAt?.toISOString() ?? null, rejectedAt: v.rejectedAt?.toISOString() ?? null,
      rejectionReasonCode: v.rejectionReasonCode, supersedesVersionId: v.supersedesVersionId,
    })),
  };
}

// ── Active-policy resolution (FAIL-CLOSED). ───────────────────────────────────
/** The single ACTIVE version for a tenant+purpose, or null. >1 active across policies of one purpose is
 *  treated as ambiguous by the caller (fail closed). */
async function resolveActiveVersion(tenantId: string, purpose: ChildSafetyPolicyPurpose): Promise<{ policyId: string; versionId: string; definition: unknown; definitionHash: string; engineVersion: string } | { ambiguous: true } | null> {
  const active = await systemDb.childSafetyPolicyVersion.findMany({
    where: { tenantId, status: ChildSafetyPolicyStatus.Active, policy: { purpose } },
    select: { id: true, policyId: true, definitionJson: true, definitionHash: true, engineVersion: true },
  });
  if (active.length === 0) return null;
  if (active.length > 1) return { ambiguous: true };
  return { policyId: active[0]!.policyId, versionId: active[0]!.id, definition: active[0]!.definitionJson, definitionHash: active[0]!.definitionHash, engineVersion: active[0]!.engineVersion };
}

// ── Production evaluation (persists an append-only decision; fail-closed). ────
export interface EvaluateOptions { contextType: string; contextId?: string; correlationId?: string; persist?: boolean; }
export async function evaluateChildSafetyPolicyForTenant(tenantId: string, purpose: ChildSafetyPolicyPurpose, facts: Record<string, unknown>, opts: EvaluateOptions, now: Date = new Date()): Promise<ChildSafetyPolicyEvaluationResult & { policyId: string | null; policyVersionId: string | null; inputFingerprint: string }> {
  const evaluatedAt = now.toISOString();
  const persist = opts.persist !== false;
  let resolved: Awaited<ReturnType<typeof resolveActiveVersion>>;
  try { resolved = await resolveActiveVersion(tenantId, purpose); }
  catch { resolved = null; }

  // Fail-closed paths — no active policy / ambiguous. Audit the failure; no decision row (no version).
  if (resolved === null || (resolved as { ambiguous?: true }).ambiguous) {
    const code = resolved === null ? "no_active_policy" : "ambiguous_active_policy";
    const fc = failClosedDecision(purpose, code, evaluatedAt, canonicalPolicyInput(purpose, facts));
    await audit(tenantId, "system", "child_safety.policy.evaluation_failed", opts.contextId ?? purpose, { purpose, reason: code });
    return { ...fc, policyId: null, policyVersionId: null, inputFingerprint: sha256(fc.canonicalInput) };
  }
  const active = resolved as { policyId: string; versionId: string; definition: unknown; definitionHash: string; engineVersion: string };

  // Defensive integrity + compatibility gate BEFORE evaluation (fail-closed on any anomaly):
  //   1) engine version the stored version was authored for must match THIS engine;
  //   2) the stored definition must hash to its recorded definitionHash (detects tampering/corruption);
  //   3) the definition must still be structurally valid for the current schema.
  const val = validateChildSafetyPolicyDefinition(active.definition);
  let result: ChildSafetyPolicyEvaluationResult;
  if (active.engineVersion !== CHILD_SAFETY_POLICY_ENGINE_VERSION) {
    result = failClosedDecision(purpose, "unsupported_engine_version", evaluatedAt, canonicalPolicyInput(purpose, facts));
  } else if (definitionHashOf(active.definition) !== active.definitionHash) {
    result = failClosedDecision(purpose, "definition_hash_mismatch", evaluatedAt, canonicalPolicyInput(purpose, facts));
  } else if (!val.valid || (active.definition as ChildSafetyPolicyDefinition).schemaVersion !== CHILD_SAFETY_POLICY_SCHEMA_VERSION) {
    result = failClosedDecision(purpose, "invalid_active_policy", evaluatedAt, canonicalPolicyInput(purpose, facts));
  } else {
    try { result = evaluateChildSafetyPolicy({ purpose, facts, evaluatedAt }, active.definition as ChildSafetyPolicyDefinition); }
    catch { result = failClosedDecision(purpose, "evaluation_error", evaluatedAt, canonicalPolicyInput(purpose, facts)); }
  }

  const inputFingerprint = sha256(result.canonicalInput);
  if (persist) {
    await systemDb.childSafetyPolicyDecisionRecord.create({ data: {
      tenantId, policyId: active.policyId, policyVersionId: active.versionId, policyPurpose: purpose,
      evaluationContextType: opts.contextType.slice(0, 32), evaluationContextId: opts.contextId?.slice(0, 64) ?? null,
      inputFingerprint, decisionCode: summarizeDecision(result), decisionJson: result.decision as never,
      explanationJson: result.explanationCodes as never, engineVersion: result.engineVersion,
      correlationId: opts.correlationId?.slice(0, 64) ?? null, evaluatedAt: now,
    } }).catch(() => {});
    await audit(tenantId, "system", "child_safety.policy.decision_evaluated", active.versionId, { purpose, code: summarizeDecision(result), ok: result.ok });
  }
  return { ...result, policyId: active.policyId, policyVersionId: active.versionId, inputFingerprint };
}

/** A bounded one-word decision summary code (for indexing/audit). */
export function summarizeDecision(r: ChildSafetyPolicyEvaluationResult): string {
  const d = r.decision;
  if (!r.ok) return "fail_closed";
  if (d.manualOnly) return "manual_only";
  if (d.requireSupervisorReview) return "supervisor_review";
  if (d.allowAutomaticIntervention) return "auto_intervention_allowed";
  if (d.requireReview) return "review_required";
  return "no_action";
}

// ── Simulation (NO side effects — never persists a production decision). ──────
export interface SimulationCaseResult { index: number; result: ChildSafetyPolicyEvaluationResult; }
export async function simulateChildSafetyPolicyVersion(actor: PolicyActor, versionId: string, cases: Array<Record<string, unknown>>, now: Date = new Date()): Promise<{ purpose: string; validation: ChildSafetyPolicyValidationResult; cases: SimulationCaseResult[] }> {
  assertSimulate(actor);
  if (!Array.isArray(cases) || cases.length === 0) throw new ChildSafetyPolicyStateError("no_cases");
  if (cases.length > MAX_SIMULATION_CASES) throw new ChildSafetyPolicyStateError("too_many_cases");
  const v = await requireVersion(actor.tenantId, versionId);
  const policy = await requirePolicy(actor.tenantId, v.policyId);
  const purpose = policy.purpose as ChildSafetyPolicyPurpose;
  const validation = validateChildSafetyPolicyDefinition(v.definitionJson);
  const evaluatedAt = now.toISOString();
  const out: SimulationCaseResult[] = cases.map((facts, index) => {
    const result = validation.valid
      ? evaluateChildSafetyPolicy({ purpose, facts, evaluatedAt, includeUnmatched: true }, v.definitionJson as unknown as ChildSafetyPolicyDefinition)
      : failClosedDecision(purpose, "invalid_definition", evaluatedAt, canonicalPolicyInput(purpose, facts));
    return { index, result };
  });
  await audit(actor.tenantId, actor.userId, "child_safety.policy.simulated", versionId, { cases: cases.length });
  return { purpose, validation, cases: out };
}

// ── Decision history (append-only; content-free). ────────────────────────────
export async function listChildSafetyPolicyDecisions(actor: PolicyActor, input: { purpose?: string; contextType?: string; page?: number; pageSize?: number } = {}) {
  assertDecisionView(actor);
  const where: Record<string, unknown> = { tenantId: actor.tenantId };
  if (input.purpose && isPolicyPurpose(input.purpose)) where.policyPurpose = input.purpose;
  if (input.contextType) where.evaluationContextType = input.contextType.slice(0, 32);
  const pageSize = Math.min(Math.max(1, Math.floor(input.pageSize || DECISION_PAGE_DEFAULT)), DECISION_PAGE_MAX);
  const page = Math.max(1, Math.floor(input.page || 1));
  const [total, rows] = await Promise.all([
    systemDb.childSafetyPolicyDecisionRecord.count({ where }),
    systemDb.childSafetyPolicyDecisionRecord.findMany({ where, orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, policyId: true, policyVersionId: true, policyPurpose: true, evaluationContextType: true, evaluationContextId: true, decisionCode: true, explanationJson: true, engineVersion: true, evaluatedAt: true } }),
  ]);
  return {
    total, page, pageSize, hasMore: page * pageSize < total,
    items: rows.map((r) => ({ ...r, evaluatedAt: r.evaluatedAt.toISOString() })),
  };
}

// ── Narrow integration adapters (advisory — existing domain services stay authoritative). ──
const adapter = (purpose: ChildSafetyPolicyPurpose, contextType: string) =>
  (tenantId: string, facts: Record<string, unknown>, ctx: { contextId?: string; correlationId?: string; persist?: boolean } = {}, now?: Date) =>
    evaluateChildSafetyPolicyForTenant(tenantId, purpose, facts, { contextType, ...ctx }, now);

export const evaluateSignalTriagePolicy = adapter(ChildSafetyPolicyPurpose.SignalTriage, "signal");
export const evaluateIncidentClassificationPolicy = adapter(ChildSafetyPolicyPurpose.IncidentClassification, "incident");
export const evaluateEscalationPolicy = adapter(ChildSafetyPolicyPurpose.Escalation, "incident");
export const evaluateProtectionPlanPolicy = adapter(ChildSafetyPolicyPurpose.ProtectionPlan, "incident");
export const evaluateInterventionAuthorizationPolicy = adapter(ChildSafetyPolicyPurpose.InterventionAuthorization, "incident");
export const evaluateGuardianContactEligibilityPolicy = adapter(ChildSafetyPolicyPurpose.GuardianContactEligibility, "incident");
