"use server";

import { redirect } from "next/navigation";
import { acceptFamilyGuardianInvitation, declineFamilyGuardianInvitation } from "@guardora/db";
import { requireSession } from "@/server/auth";
import type { FamilyInvitationActionState } from "@/server/family-safe-error";

/**
 * CS-C8 — accept / decline a Family guardian invitation. SELF-service + session-authoritative: the acting
 * user + email come from the verified session (never the client); the opaque token comes from a hidden
 * field. Accept is atomic, single-use and idempotent (repository). On success we redirect to a terminal
 * confirmation on THIS page (?outcome=…) — never assuming the active workspace. Errors are SAFE groups only;
 * the raw token is never logged.
 */
function str(fd: FormData, k: string): string { return String(fd.get(k) ?? ""); }

export async function acceptFamilyInvitationAction(_prev: unknown, formData: FormData): Promise<FamilyInvitationActionState> {
  const session = await requireSession();
  const token = str(formData, "token");
  if (!token) return { ok: false, error: "invalid_token" };
  const res = await acceptFamilyGuardianInvitation(token, session.userId, session.userEmail);
  if (res.ok) redirect(`/invite/family/${encodeURIComponent(token)}?outcome=accepted`);
  return { ok: false, error: res.reason };
}

export async function declineFamilyInvitationAction(_prev: unknown, formData: FormData): Promise<FamilyInvitationActionState> {
  const session = await requireSession();
  const token = str(formData, "token");
  if (!token) return { ok: false, error: "invalid_token" };
  const res = await declineFamilyGuardianInvitation(token, session.userId, session.userEmail);
  if (res.ok) redirect(`/invite/family/${encodeURIComponent(token)}?outcome=declined`);
  return { ok: false, error: res.reason };
}
