import "server-only";
import { redirect } from "next/navigation";
import { WorkspaceKind, WorkspaceCapability, isWorkspaceKind, capabilityAllowedInWorkspace } from "@guardora/core";
import { requireVerifiedSession, type AppSession } from "./auth";

/**
 * CS-C0 — the SINGLE authoritative server-side workspace guard. A tenantId (RLS) is
 * never sufficient for domain separation: the active workspace's IMMUTABLE kind must
 * also permit the capability. Fail-closed and server-authoritative — UI hiding is
 * never the only protection. A Business workspace can't reach Family/Child-Safety
 * operations and vice-versa; a deep-linked or hand-crafted request is blocked here.
 */

export type WorkspaceAccess =
  | { allowed: true; session: AppSession; kind: WorkspaceKind }
  | { allowed: false; session: AppSession; kind: WorkspaceKind; reason: "wrong_kind" | "capability_denied" };

function sessionKind(session: AppSession): WorkspaceKind {
  return isWorkspaceKind(session.workspaceKind) ? session.workspaceKind : WorkspaceKind.Business;
}

/** Require the active workspace to be exactly one of `kinds`. Redirects to the dashboard on mismatch. */
export async function requireWorkspaceKind(kinds: WorkspaceKind | readonly WorkspaceKind[]): Promise<AppSession> {
  const session = await requireVerifiedSession();
  const allowed = (Array.isArray(kinds) ? kinds : [kinds]) as readonly WorkspaceKind[];
  if (!allowed.includes(sessionKind(session))) redirect("/dashboard");
  return session;
}

/**
 * Resolve whether the active workspace may use a capability. Returns a structured
 * result so a page can render a truthful "not available in this workspace" state
 * (never a raw 500) and run NO domain query on denial.
 */
export async function checkWorkspaceCapability(capability: WorkspaceCapability): Promise<WorkspaceAccess> {
  const session = await requireVerifiedSession();
  const kind = sessionKind(session);
  if (!capabilityAllowedInWorkspace(capability, kind)) return { allowed: false, session, kind, reason: "capability_denied" };
  return { allowed: true, session, kind };
}

/** Hard-require a capability; redirect to the dashboard when the workspace kind can't use it. */
export async function requireWorkspaceCapability(capability: WorkspaceCapability): Promise<AppSession> {
  const access = await checkWorkspaceCapability(capability);
  if (!access.allowed) redirect("/dashboard");
  return access.session;
}
