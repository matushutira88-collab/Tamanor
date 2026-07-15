"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { normalizeEmail } from "@guardora/db";
import { metrics } from "@guardora/core";
import { emailSendLimiter, ipKeyFromHeader } from "@/lib/rate-limit";
import { getSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";
import { issueVerificationEmail } from "@/server/auth-email";
import { getLocale } from "@/i18n/locale-server";

/**
 * V1.50C — resend the verification email. Session-scoped (no email input → enumeration-safe),
 * rate-limited per-IP AND per-email with a cooldown. Always returns the same generic status.
 * Issuing a fresh token invalidates any earlier active token.
 */
export async function resendVerification(): Promise<void> {
  const done = (status: string): never => redirect(`/verify-email?status=${status}`);

  if (!(await isSameOrigin())) done("error");
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.emailVerified) redirect("/dashboard");

  const ip = ipKeyFromHeader((await headers()).get("x-forwarded-for"));
  const emailKey = normalizeEmail(session.userEmail);
  if (!(await emailSendLimiter.check(`resend:ip:${ip}`)).allowed || !(await emailSendLimiter.check(`resend:email:${emailKey}`)).allowed) {
    metrics.inc("auth_email_rate_limited_total", { operation: "resend" });
    done("resend_rate_limited");
  }

  await issueVerificationEmail(session.userId, session.userEmail, await getLocale());
  metrics.inc("auth_resend_total", {});
  done("resent"); // generic — identical regardless of the delivery outcome
}
