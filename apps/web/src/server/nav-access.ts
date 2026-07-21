import { can, Role, WorkspaceKind, isWorkspaceKind } from "@guardora/core";
import { DASHBOARD_NAV } from "../lib/nav";

/**
 * Server-only nav access gate. Deliberately lives here (not in `@/lib/nav`, which the
 * CLIENT sidebar imports) so `@guardora/core` — permissions + node:crypto — never enters
 * the client bundle. The layout computes the denied-href set here and passes plain strings
 * to the client `DashboardShell`.
 *
 * Two independent gates combine (an href denied by EITHER is hidden):
 *  - S0 RBAC: an item with `requiredPermission` is denied when the role lacks it. This is a
 *    UX affordance on top of the authoritative per-page server checks.
 *  - CS-C0 workspace separation: BUSINESS nav is shown ONLY in a BUSINESS workspace. In a
 *    Family / Child-Safety-Organization / Internal workspace every business href is denied
 *    (those kinds ship their own nav). An unknown/invalid kind fails closed to BUSINESS —
 *    this only ever RESTORES normal business nav, never grants a business route to a
 *    non-business workspace.
 *
 * Plan / entitlements NEVER gate nav visibility: an item the role is permitted to use stays
 * visible even when the plan lacks the entitlement, so the page can render a truthful
 * CapabilityLockedState. In particular `free_trial` never removes a nav item (e.g. Team) —
 * the seat cap is enforced inside the Team page, not by hiding the link.
 */
export function computeDeniedNavHrefs(opts: { role: string; workspaceKind: string }): string[] {
  const role = opts.role as Role;
  const kind = isWorkspaceKind(opts.workspaceKind) ? opts.workspaceKind : WorkspaceKind.Business;

  // S0 — RBAC: hide items whose requiredPermission the role lacks.
  const rbacDenied = DASHBOARD_NAV
    .filter((n) => n.requiredPermission && !can(role, n.requiredPermission))
    .map((n) => n.href as string);

  // CS-C0 — outside a BUSINESS workspace, deny ALL business nav (no-op for business tenants).
  const workspaceDenied = kind === WorkspaceKind.Business ? [] : DASHBOARD_NAV.map((n) => n.href as string);

  return [...new Set([...rbacDenied, ...workspaceDenied])];
}
