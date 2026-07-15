import "server-only";
import { createEmailVerificationToken, createPasswordResetToken } from "@guardora/db";
import { emitOpsEvent } from "@guardora/core";
import { sendVerificationEmail, sendPasswordResetEmail, emailBaseUrl } from "./email/send";
import type { Locale } from "@/i18n";

/**
 * V1.50C — issue a one-time token and email the link. The RAW token is built into the URL
 * and handed straight to the transport; it is NEVER logged. On delivery failure we emit a
 * PII-free ops event and return false so the caller can respond truthfully.
 */
export async function issueVerificationEmail(userId: string, email: string, locale: Locale): Promise<boolean> {
  const { rawToken } = await createEmailVerificationToken(userId);
  const url = `${emailBaseUrl()}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
  const res = await sendVerificationEmail(email, locale, url);
  if (!res.ok) emitOpsEvent("auth.email_delivery_failed", { operation: "verification", reason: res.reason ?? "delivery_failed" });
  return res.ok;
}

export async function issueResetEmail(userId: string, email: string, locale: Locale): Promise<boolean> {
  const { rawToken } = await createPasswordResetToken(userId);
  const url = `${emailBaseUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const res = await sendPasswordResetEmail(email, locale, url);
  if (!res.ok) emitOpsEvent("auth.email_delivery_failed", { operation: "password_reset", reason: res.reason ?? "delivery_failed" });
  return res.ok;
}
