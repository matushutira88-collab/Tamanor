import "server-only";
import { classifyWorkspaceRouting, type FamilyActorContext } from "@guardora/core";
import { getFamilyOnboardingState } from "@guardora/db";
import type { AppSession } from "./auth";

/**
 * CS-C6.1 — the SINGLE server-authoritative decision of where an authenticated user belongs. A bounded
 * discriminated union; there is NO Business fallback and NO auto-repair of a bad WorkspaceKind. The
 * WorkspaceKind is read only from the server session (never a query string / client payload).
 */
export type WorkspaceDestination =
  | { type: "family_onboarding"; href: "/family/onboarding" }
  | { type: "family_console"; href: "/family" }
  | { type: "business"; href: "/dashboard" }
  | { type: "workspace_selection"; href: "/register/workspace-type" }
  | { type: "unsupported_workspace"; href: "/unsupported-workspace" };

/**
 * Resolve the destination from a verified session. Fail-closed: an unknown/corrupt/unsupported kind
 * → `unsupported_workspace` (never Business, never Family). Reads the Family onboarding state (server)
 * only when the kind is FAMILY. Performs NO DB writes, NO workspace creation, NO value repair.
 */
export async function resolveWorkspaceDestination(session: AppSession): Promise<WorkspaceDestination> {
  // No active workspace on the session → the mandatory workspace-type selection (never a console).
  if (!session.tenantId) return { type: "workspace_selection", href: "/register/workspace-type" };

  switch (classifyWorkspaceRouting(session.workspaceKind)) {
    case "business":
      return { type: "business", href: "/dashboard" };
    case "family": {
      const actor: FamilyActorContext = { tenantId: session.tenantId, userId: session.userId, role: session.role, workspaceKind: session.workspaceKind };
      const onb = await getFamilyOnboardingState(actor);
      return onb.currentStep === "complete"
        ? { type: "family_console", href: "/family" }
        : { type: "family_onboarding", href: "/family/onboarding" };
    }
    case "unsupported":
    default:
      return { type: "unsupported_workspace", href: "/unsupported-workspace" };
  }
}
