/**
 * Child Safety Protection Plan — web server glue. Resolves the session into a protection actor and maps
 * thrown service errors to safe, stable HTTP codes. Reads require plan VIEW; writes require plan MANAGE
 * (enforced again in the service). Owner / Administrator / Safety Reviewer only — no public / guardian /
 * SDK / gateway path. Never leaks Prisma / stack / cross-tenant existence / protected free text.
 */
import { type ProtectionActor, ChildSafetyProtectionForbiddenError, ChildSafetyProtectionNotFoundError } from "@guardora/db";
import { canViewChildSafetyProtectionPlan } from "@guardora/core";
import { getSession } from "@/server/auth";

export async function resolveProtectionActor(): Promise<ProtectionActor | null> {
  const s = await getSession();
  if (!s || !s.emailVerified) return null;
  if (!canViewChildSafetyProtectionPlan(s.role)) return null;
  return { tenantId: s.tenantId, userId: s.userId, role: s.role };
}

export function mapProtectionError(e: unknown): { status: number; code: string } {
  if (e instanceof ChildSafetyProtectionForbiddenError) return { status: 403, code: "forbidden" };
  if (e instanceof ChildSafetyProtectionNotFoundError) return { status: 404, code: "not_found" };
  const msg = e instanceof Error ? e.message : "";
  if (msg.startsWith("invalid_transition:")) return { status: 409, code: "invalid_transition" };
  if (["active_plan_exists", "actions_incomplete", "concurrent_modification", "plan_not_editable", "title_required", "assignee_required", "invalid_priority"].includes(msg)) return { status: 400, code: msg };
  return { status: 500, code: "internal" };
}
