"use server";

import { redirect } from "next/navigation";
import { eraseUserIdentity, isUserErasureError } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { endSession } from "@/server/session";

/**
 * V1.45C2 — self-service GLOBAL identity erasure (delete my account).
 *
 * Authorization is authoritative and self-only:
 *  - a validated DB-backed session (requireSession),
 *  - the target is ALWAYS `session.userId` — NEVER read from form data (no forged target),
 *  - NO tenant role is used as authority (this is a global-identity action, not a workspace action),
 *  - POST/server action only (no destructive GET),
 *  - exact-email confirmation is re-verified server-side, FRESH and IN-TRANSACTION, inside
 *    eraseUserIdentity (constant-time), so a stale/typed value cannot bypass it,
 *  - the sole-owner invariant is enforced atomically inside the erasure transaction.
 *
 * Recent re-authentication is NOT available in the current cookie-only auth architecture (there is no
 * password store to verify) — exact-email confirmation is the strongest available proof; real re-auth
 * is documented as future hardening. On a blocker or mismatch NOTHING is deleted and the user returns
 * with a safe notice (no email/tenant name/PII in the URL). On success the session is ended.
 */
export async function requestAccountDeletion(formData: FormData): Promise<void> {
  const session = await requireSession();

  const confirmEmail = String(formData.get("confirmEmail") ?? "");
  const ack = formData.get("ack");
  if (ack !== "on") {
    redirect("/dashboard/settings?account=mismatch");
  }

  try {
    await eraseUserIdentity({
      targetUserId: session.userId, // self only — never from the client
      actorUserId: session.userId,
      authority: "self",
      confirmEmail, // re-verified fresh, in-transaction
    });
  } catch (e) {
    if (isUserErasureError(e)) {
      if (e.code === "confirmation_mismatch") redirect("/dashboard/settings?account=mismatch");
      if (e.code === "sole_owner_blocked") redirect("/dashboard/settings?account=owner");
    }
    throw e;
  }

  // Identity (and this session row) are gone. Clear the cookie and send the user to login.
  await endSession();
  redirect("/login?accountDeleted=1");
}
