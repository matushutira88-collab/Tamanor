"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createFamilyGuardianInvitation, revokeFamilyGuardianInvitation } from "@guardora/db";
import { requireFamilyActor } from "@/server/family-guard";
import { toFamilyInvitationErrorCode, type FamilyInvitationActionState } from "@/server/family-safe-error";
import type { FamilyInvitationErrorCode } from "@/app/family/family-i18n";

/**
 * CS-C8 — Family guardian-invitation server actions. Session + FAMILY workspace + membership are
 * server-authoritative; tenantId / actorMembershipId / status / tokenHash are NEVER read from the client.
 * The client submits ONLY the bounded create DTO. Errors are SAFE invitation groups (never a raw
 * message/stack/SQL/token/email). The raw one-time token is returned ONCE to the creating client and never
 * persisted in a URL, cookie, log or audit.
 */
function str(fd: FormData, k: string): string { return String(fd.get(k) ?? "").trim(); }

export type CreateInvitationState =
  | { status: "idle" }
  | { status: "ok"; token: string }
  | { status: "error"; error: FamilyInvitationErrorCode };

export async function createFamilyGuardianInvitationAction(_prev: CreateInvitationState, formData: FormData): Promise<CreateInvitationState> {
  const { actor } = await requireFamilyActor();
  try {
    const { token } = await createFamilyGuardianInvitation(actor, {
      protectedProfileId: str(formData, "protectedProfileId"),
      invitedEmail: str(formData, "invitedEmail"),
      intendedFamilyRole: str(formData, "intendedFamilyRole"),
      intendedGuardianRole: str(formData, "intendedGuardianRole"),
      intendedRelationshipType: str(formData, "intendedRelationshipType"),
    });
    revalidatePath("/family/invitations");
    // The plaintext token is handed back to THIS client once, for the one-time reveal. Never stored/logged.
    return { status: "ok", token };
  } catch (e) {
    return { status: "error", error: toFamilyInvitationErrorCode(e) };
  }
}

/** CS-C8 — DESTRUCTIVE (terminal). `useActionState`-shaped for the confirm dialog; redirects on success. */
export async function revokeFamilyGuardianInvitationAction(_prev: unknown, formData: FormData): Promise<FamilyInvitationActionState> {
  const { actor } = await requireFamilyActor();
  const id = str(formData, "invitationId");
  if (!id) return { ok: false, error: "not_found" };
  try { await revokeFamilyGuardianInvitation(actor, id); }
  catch (e) { return { ok: false, error: toFamilyInvitationErrorCode(e) }; }
  revalidatePath("/family/invitations");
  redirect("/family/invitations?ok=revoked");
}
