"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { normalizeEmail, findUserForLogin } from "@guardora/db";
import { metrics } from "@guardora/core";
import { emailSendLimiter, ipKeyFromHeader } from "@/lib/rate-limit";
import { isSameOrigin } from "@/server/csrf";
import { issueResetEmail } from "@/server/auth-email";
import { getLocale } from "@/i18n/locale-server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * V1.50C — forgot-password request. ENUMERATION-SAFE: every path (unknown email,
 * OAuth-only account, rate-limited, delivery failure, real account) ends on the SAME
 * generic "we've sent a link if an account exists" screen. A reset email is issued ONLY
 * when a password credential actually exists. No token/URL/email is ever logged.
 */
export async function forgotPasswordAction(formData: FormData): Promise<void> {
  const generic = (): never => redirect("/forgot-password?sent=1");
  if (!(await isSameOrigin())) redirect("/forgot-password?error=csrf");

  const email = String(formData.get("email") ?? "").trim();
  // Format validation reveals nothing about existence; a malformed address can't receive mail.
  if (!EMAIL_RE.test(email) || email.length > 254) redirect("/forgot-password?error=invalid_email");

  const norm = normalizeEmail(email);
  const ip = ipKeyFromHeader((await headers()).get("x-forwarded-for"));
  // Rate-limited requests STILL return the generic response (no signal).
  if ((await emailSendLimiter.check(`forgot:ip:${ip}`)).allowed && (await emailSendLimiter.check(`forgot:email:${norm}`)).allowed) {
    const user = await findUserForLogin(norm);
    if (user && user.passwordHash) {
      await issueResetEmail(user.id, norm, await getLocale());
    }
  } else {
    metrics.inc("auth_email_rate_limited_total", { operation: "forgot" });
  }
  metrics.inc("auth_forgot_total", {});
  generic();
}
