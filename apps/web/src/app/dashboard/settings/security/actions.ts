"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getUserPasswordHash, verifyPassword, hashPassword, changeUserPassword,
  revokeOwnedSession, revokeOtherSessions, revokeAllSessions,
} from "@guardora/db";
import { emitOpsEvent } from "@guardora/core";
import { requireSession } from "@/server/auth";
import { startSession, endSession } from "@/server/session";
import { isSameOrigin } from "@/server/csrf";
import { checkPasswordAcceptable, summarizeUserAgent } from "@/server/auth-security";
import { sendSecurityEmail } from "@/server/security-email";
import { getLocale } from "@/i18n/locale-server";

const back = (q: string): never => redirect(`/dashboard/settings/security?${q}`);

/**
 * V1.58.9 — change password. Requires the CURRENT password, applies the same server policy + breached
 * check as registration, forbids reusing the current password, then revokes EVERY session and mints a
 * FRESH one for this device (so the user stays signed in here, out everywhere else). Audited + emailed.
 */
export async function changePasswordAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!(await isSameOrigin())) back("error=csrf");

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  const hash = await getUserPasswordHash(session.userId);
  if (!hash || !(await verifyPassword(hash, current))) back("error=current_wrong");
  if (next !== confirm) back("error=mismatch");
  const pw = await checkPasswordAcceptable(next);
  if (!pw.ok) {
    if (pw.reason === "breached") { emitOpsEvent("auth.breached_password_blocked", { operation: "change" }); back("error=breached"); }
    back("error=weak");
  }
  if (await verifyPassword(hash!, next)) back("error=same_password");

  const newHash = await hashPassword(next);
  await changeUserPassword(session.userId, newHash, null); // revoke ALL + set passwordChangedAt
  // Mint a fresh session for THIS device (createdAt > passwordChangedAt ⇒ survives the stale-session backstop).
  const ua = summarizeUserAgent((await headers()).get("user-agent")) ?? undefined;
  await startSession(session.userId, session.tenantId, false, ua);
  emitOpsEvent("auth.password_changed", { operation: "change" });
  try { await sendSecurityEmail(session.userEmail, await getLocale(), "password_changed", { when: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC", device: ua }); } catch { /* best-effort */ }
  back("ok=password_changed");
}

/** Revoke ONE of the user's other sessions (ownership-scoped). */
export async function revokeSessionAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!(await isSameOrigin())) back("error=csrf");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (sessionId && sessionId !== session.sessionId) {
    if (await revokeOwnedSession(session.userId, sessionId)) emitOpsEvent("auth.session_revoked", { operation: "revoke_one" });
  }
  back("ok=revoked");
}

/** Log out all OTHER devices (keep the current session). */
export async function revokeOthersAction(): Promise<void> {
  const session = await requireSession();
  if (!(await isSameOrigin())) back("error=csrf");
  const n = await revokeOtherSessions(session.userId, session.sessionId);
  emitOpsEvent("auth.logout_all", { operation: "others", result: String(n > 0) });
  back("ok=revoked_others");
}

/** Log out EVERYWHERE including this device, then redirect to /login. */
export async function revokeAllAction(): Promise<void> {
  const session = await requireSession();
  if (!(await isSameOrigin())) back("error=csrf");
  await revokeAllSessions(session.userId);
  emitOpsEvent("auth.logout_all", { operation: "all" });
  await endSession(); // clears the current cookie too
  redirect("/login?reason=session_revoked");
}
