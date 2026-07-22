import "server-only";
import { redirect } from "next/navigation";
import { WorkspaceKind, FamilyAction, authorizeFamilyAction, classifyWorkspaceRouting, type FamilyActorContext } from "@guardora/core";
import { getFamilyOnboardingState } from "@guardora/db";
import { requireVerifiedSession, type AppSession } from "./auth";
import { resolveWorkspaceDestination } from "./workspace-routing";

/**
 * CS-C6/6.1 — the SINGLE server-side entry guard for the Family console. A tenantId (RLS) is never
 * sufficient: the active workspace's IMMUTABLE kind must be FAMILY. Fail-closed and server-authoritative
 * (UI hiding is never the only protection). A NON-FAMILY session is routed by the CENTRAL resolver — a
 * Business session → /dashboard, an unknown/corrupt/unsupported kind → /unsupported-workspace. There is
 * NO Business fallback for an unknown kind (never `else redirect("/dashboard")`).
 */
export interface FamilyContext { session: AppSession; actor: FamilyActorContext }

export async function requireFamilyActor(): Promise<FamilyContext> {
  const session = await requireVerifiedSession();
  if (classifyWorkspaceRouting(session.workspaceKind) !== "family") {
    redirect((await resolveWorkspaceDestination(session)).href);
  }
  const actor: FamilyActorContext = { tenantId: session.tenantId, userId: session.userId, role: session.role, workspaceKind: WorkspaceKind.Family };
  return { session, actor };
}

/** Require a FAMILY session AND completed onboarding; incomplete → the onboarding wizard. */
export async function requireFamilyConsole(): Promise<FamilyContext> {
  const ctx = await requireFamilyActor();
  const onb = await getFamilyOnboardingState(ctx.actor);
  if (onb.currentStep !== "complete") redirect("/family/onboarding");
  return ctx;
}

/** True iff the active Family role may perform `action` (server-authoritative; UI convenience). */
export function familyCan(actor: FamilyActorContext, action: FamilyAction): boolean {
  return authorizeFamilyAction(actor, action).ok;
}
