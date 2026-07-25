"use server";

import { revalidatePath } from "next/cache";
import {
  createDraftProtectionPlan, activateProtectionPlan, completeProtectionPlan, cancelProtectionPlan, reopenProtectionPlan,
  addProtectionAction, assignProtectionAction, unassignProtectionAction, updateProtectionActionDueDate, updateProtectionActionPriority,
  startProtectionAction, blockProtectionAction, completeProtectionAction, skipProtectionAction, reopenProtectionAction,
  ChildSafetyProtectionForbiddenError, ChildSafetyProtectionNotFoundError, type ProtectionActor,
} from "@guardora/db";
import { canManageChildSafetyProtectionPlan } from "@guardora/core";
import { requireVerifiedSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";

/**
 * Protection Plan — Server Actions. Fail-closed: same-origin (CSRF) + plan MANAGE re-checked here, and the
 * @guardora/db service re-validates the transition + tenant scope + appends canonical events + content-free
 * audit. Returns a SAFE serializable error CODE only (never a raw message/stack/protected note). On success
 * revalidates the incident detail so the plan, progress, and dashboard refresh. No edit/delete of history.
 */
export type PlanActionState = { ok: true } | { ok: false; error: string };

function classify(e: unknown): string {
  if (e instanceof ChildSafetyProtectionForbiddenError) return "forbidden";
  if (e instanceof ChildSafetyProtectionNotFoundError) return "not_found";
  const msg = e instanceof Error ? e.message : "";
  if (msg.startsWith("invalid_transition:")) return "invalid_transition";
  if (["active_plan_exists", "actions_incomplete", "concurrent_modification", "plan_not_editable", "title_required", "assignee_required", "invalid_priority"].includes(msg)) return msg;
  return "retry_later";
}
async function resolveManager(): Promise<ProtectionActor | null> {
  const s = await requireVerifiedSession();
  if (!canManageChildSafetyProtectionPlan(s.role)) return null;
  return { tenantId: s.tenantId, userId: s.userId, role: s.role };
}
const path = (id: string) => `/dashboard/child-safety/reviewer/${id}`;
async function run(incidentId: string, fn: (a: ProtectionActor) => Promise<unknown>): Promise<PlanActionState> {
  if (!(await isSameOrigin())) return { ok: false, error: "forbidden" };
  const actor = await resolveManager();
  if (!actor) return { ok: false, error: "forbidden" };
  try { await fn(actor); revalidatePath(path(incidentId)); revalidatePath("/dashboard/child-safety/reviewer"); return { ok: true }; }
  catch (e) { return { ok: false, error: classify(e) }; }
}
const S = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const opt = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || undefined; };
const dueOf = (fd: FormData) => { const v = String(fd.get("dueAt") ?? "").trim(); if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };

// Plan-level
export async function createPlanAction(_p: PlanActionState, fd: FormData): Promise<PlanActionState> { const id = S(fd, "incidentId"); return run(id, (a) => createDraftProtectionPlan(a, id, { fromRecommendation: S(fd, "fromRecommendation") === "1" })); }
export async function activatePlanAction(_p: PlanActionState, fd: FormData): Promise<PlanActionState> { return run(S(fd, "incidentId"), (a) => activateProtectionPlan(a, S(fd, "planId"))); }
export async function completePlanAction(_p: PlanActionState, fd: FormData): Promise<PlanActionState> { return run(S(fd, "incidentId"), (a) => completeProtectionPlan(a, S(fd, "planId"), opt(fd, "closedReason"))); }
export async function cancelPlanAction(_p: PlanActionState, fd: FormData): Promise<PlanActionState> { return run(S(fd, "incidentId"), (a) => cancelProtectionPlan(a, S(fd, "planId"), opt(fd, "closedReason"))); }
export async function reopenPlanAction(_p: PlanActionState, fd: FormData): Promise<PlanActionState> { return run(S(fd, "incidentId"), (a) => reopenProtectionPlan(a, S(fd, "planId"))); }
export async function addActionAction(_p: PlanActionState, fd: FormData): Promise<PlanActionState> { return run(S(fd, "incidentId"), (a) => addProtectionAction(a, S(fd, "planId"), { title: S(fd, "title"), description: opt(fd, "description"), priority: opt(fd, "priority"), actionType: opt(fd, "actionType"), dueAt: dueOf(fd) })); }

// Action-level — a single dispatcher keyed by `op`
export async function actionOpAction(_p: PlanActionState, fd: FormData): Promise<PlanActionState> {
  const incidentId = S(fd, "incidentId"); const actionId = S(fd, "actionId"); const op = S(fd, "op");
  return run(incidentId, (a) => {
    switch (op) {
      case "assign": return assignProtectionAction(a, actionId, S(fd, "assigneeUserId").trim());
      case "unassign": return unassignProtectionAction(a, actionId);
      case "due": return updateProtectionActionDueDate(a, actionId, dueOf(fd));
      case "priority": return updateProtectionActionPriority(a, actionId, S(fd, "priority"));
      case "start": return startProtectionAction(a, actionId);
      case "block": return blockProtectionAction(a, actionId, opt(fd, "reason"));
      case "complete": return completeProtectionAction(a, actionId, opt(fd, "note"));
      case "skip": return skipProtectionAction(a, actionId);
      case "reopen": return reopenProtectionAction(a, actionId);
      default: throw new Error("unknown_op");
    }
  });
}
