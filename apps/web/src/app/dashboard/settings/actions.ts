"use server";

import { redirect } from "next/navigation";
import { Role } from "@guardora/core";
import { deleteTenant } from "@guardora/sync";
import { isTenantDeletionError } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { endSession } from "@/server/session";

/**
 * V1.45C1 — Owner-only, irreversible workspace (tenant) deletion.
 *
 * Server authorization is AUTHORITATIVE and defence-in-depth:
 *  - a validated DB-backed session (requireSession),
 *  - the active tenant comes from the trusted session, NEVER from client input,
 *  - Owner-only (checked fresh against the session role; Admin/Member/Viewer are denied),
 *  - a POST/server action only (no destructive GET),
 *  - exact tenant-name confirmation is re-verified server-side inside requestTenantDeletion,
 *  - the operation id is server-generated and idempotent (never client-supplied).
 *
 * On confirmation mismatch NOTHING is deleted and the user is returned with a safe notice (no PII in
 * the URL). On success the session is ended and the user is sent to /login. Recent-auth re-verification
 * is NOT available in the current cookie-only auth architecture (documented as future hardening).
 */
export async function requestWorkspaceDeletion(formData: FormData): Promise<void> {
  const session = await requireSession();

  // Owner-only. Explicit role check (Permission.TenantDelete is Owner-exclusive; this is the same gate
  // stated directly so Admin/Analyst/Reviewer/Viewer are unambiguously denied).
  if (session.role !== Role.Owner) {
    throw new Error("Forbidden: only the workspace owner can delete the workspace.");
  }

  const confirmationName = String(formData.get("confirmName") ?? "");
  const ack = formData.get("ack");
  // Require the explicit acknowledgement checkbox.
  if (ack !== "on") {
    redirect("/dashboard/settings?danger=mismatch");
  }

  try {
    await deleteTenant({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      authority: "tenant_owner",
      confirmationName,
    });
  } catch (e) {
    // Confirmation typed wrong → nothing was deleted; return with a safe notice.
    if (isTenantDeletionError(e) && e.code === "confirmation_mismatch") {
      redirect("/dashboard/settings?danger=mismatch");
    }
    throw e;
  }

  // Workspace (and this session row) are gone. Clear the cookie and send the user to login.
  await endSession();
  redirect("/login?deleted=1");
}
