/**
 * Child Safety Policy Engine V1 — web server boundary. Resolves the authenticated session into a
 * tenant-scoped, membership-typed PolicyActor, enforces permission + same-origin for mutations, calls the
 * @guardora/db policy service, and maps results/errors to SAFE, stable JSON (never leaks Prisma/stack/
 * cross-tenant existence). Policy management is Owner/Administrator/Safety-Reviewer-scoped per capability;
 * there is NO public/guardian/SDK/gateway path.
 */
import {
  systemDb,
  type PolicyActor, ChildSafetyPolicyForbiddenError, ChildSafetyPolicyNotFoundError, ChildSafetyPolicyStateError,
  createChildSafetyPolicy, createChildSafetyPolicyVersion, updateChildSafetyPolicyDraft,
  submitChildSafetyPolicyVersion, approveChildSafetyPolicyVersion, rejectChildSafetyPolicyVersion,
  activateChildSafetyPolicyVersion, listChildSafetyPolicies, getChildSafetyPolicy,
  simulateChildSafetyPolicyVersion, listChildSafetyPolicyDecisions, validatePolicyDefinition,
} from "@guardora/db";
import { canViewChildSafetyPolicy } from "@guardora/core";
import { getSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";

export interface PolicyHttpResult { status: number; body: Record<string, unknown>; }
const ok = (body: Record<string, unknown>): PolicyHttpResult => ({ status: 200, body: { ok: true, ...body } });
const err = (status: number, code: string): PolicyHttpResult => ({ status, body: { ok: false, error: code } });

const MAX_BODY_BYTES = 128 * 1024;

/** Resolve a verified session + the acting membership into a PolicyActor, or a fail-closed denial. */
async function resolveActor(): Promise<{ actor: PolicyActor } | { denied: PolicyHttpResult }> {
  const session = await getSession();
  if (!session || !session.emailVerified) return { denied: err(401, "unauthenticated") };
  if (!canViewChildSafetyPolicy(session.role)) return { denied: err(403, "forbidden") };
  const membership = await systemDb.membership.findFirst({ where: { userId: session.userId, tenantId: session.tenantId }, select: { id: true } });
  if (!membership) return { denied: err(403, "forbidden") };
  return { actor: { tenantId: session.tenantId, userId: session.userId, membershipId: membership.id, role: session.role } };
}

function mapError(e: unknown): PolicyHttpResult {
  if (e instanceof ChildSafetyPolicyForbiddenError) return err(403, "forbidden");
  if (e instanceof ChildSafetyPolicyNotFoundError) return err(404, "not_found");
  if (e instanceof ChildSafetyPolicyStateError) return err(409, e.code);
  return err(500, "internal");
}
function tooLarge(body: unknown): boolean {
  try { return JSON.stringify(body ?? {}).length > MAX_BODY_BYTES; } catch { return true; }
}

// ── Reads ─────────────────────────────────────────────────────────────────────
export async function policyList(params: URLSearchParams): Promise<PolicyHttpResult> {
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  try { return ok({ policies: await listChildSafetyPolicies(r.actor, params.get("purpose") ?? undefined) }); }
  catch (e) { return mapError(e); }
}
export async function policyGet(policyId: string): Promise<PolicyHttpResult> {
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  try { return ok({ policy: await getChildSafetyPolicy(r.actor, policyId) }); }
  catch (e) { return mapError(e); }
}
export async function policyDecisions(params: URLSearchParams): Promise<PolicyHttpResult> {
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  try {
    return ok(await listChildSafetyPolicyDecisions(r.actor, {
      purpose: params.get("purpose") ?? undefined, contextType: params.get("contextType") ?? undefined,
      page: Number(params.get("page")) || 1, pageSize: Number(params.get("pageSize")) || undefined,
    }) as unknown as Record<string, unknown>);
  } catch (e) { return mapError(e); }
}

// ── Mutations (same-origin required) ──────────────────────────────────────────
async function mutating(): Promise<{ actor: PolicyActor } | { denied: PolicyHttpResult }> {
  if (!(await isSameOrigin())) return { denied: err(403, "forbidden") };
  return resolveActor();
}

export async function policyCreate(body: unknown): Promise<PolicyHttpResult> {
  const r = await mutating(); if ("denied" in r) return r.denied;
  if (tooLarge(body)) return err(413, "too_large");
  const b = (body ?? {}) as Record<string, unknown>;
  try {
    return ok(await createChildSafetyPolicy(r.actor, {
      policyKey: String(b.policyKey ?? ""), purpose: String(b.purpose ?? ""),
      displayName: String(b.displayName ?? ""), description: typeof b.description === "string" ? b.description : undefined,
      definition: b.definition,
    }));
  } catch (e) { return mapError(e); }
}
export async function policyVersionCreate(policyId: string, body: unknown): Promise<PolicyHttpResult> {
  const r = await mutating(); if ("denied" in r) return r.denied;
  if (tooLarge(body)) return err(413, "too_large");
  const b = (body ?? {}) as Record<string, unknown>;
  try { return ok(await createChildSafetyPolicyVersion(r.actor, policyId, b.definition)); }
  catch (e) { return mapError(e); }
}
export async function policyVersionPatch(versionId: string, body: unknown): Promise<PolicyHttpResult> {
  const r = await mutating(); if ("denied" in r) return r.denied;
  if (tooLarge(body)) return err(413, "too_large");
  const b = (body ?? {}) as Record<string, unknown>;
  try { return ok(await updateChildSafetyPolicyDraft(r.actor, versionId, b.definition)); }
  catch (e) { return mapError(e); }
}

/** Dispatch a version action. `validate` and `simulate` are read-like but POSTed (still same-origin). */
export async function policyVersionAction(versionId: string, body: unknown): Promise<PolicyHttpResult> {
  const r = await mutating(); if ("denied" in r) return r.denied;
  if (tooLarge(body)) return err(413, "too_large");
  const b = (body ?? {}) as Record<string, unknown>;
  const action = String(b.action ?? "");
  try {
    switch (action) {
      case "validate": return ok({ validation: validatePolicyDefinition(b.definition) });
      case "simulate": {
        const cases = Array.isArray(b.cases) ? (b.cases as Array<Record<string, unknown>>) : [];
        return ok(await simulateChildSafetyPolicyVersion(r.actor, versionId, cases) as unknown as Record<string, unknown>);
      }
      case "submit": return ok(await submitChildSafetyPolicyVersion(r.actor, versionId));
      case "approve": return ok(await approveChildSafetyPolicyVersion(r.actor, versionId, typeof b.reasonCode === "string" ? b.reasonCode : undefined));
      case "reject": return ok(await rejectChildSafetyPolicyVersion(r.actor, versionId, String(b.reasonCode ?? "rejected")));
      case "activate": return ok(await activateChildSafetyPolicyVersion(r.actor, versionId));
      default: return err(400, "unknown_action");
    }
  } catch (e) { return mapError(e); }
}
