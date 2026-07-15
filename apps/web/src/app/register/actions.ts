"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hashPassword, registerUser, normalizeEmail, EmailAlreadyRegisteredError } from "@guardora/db";
import { emitOpsEvent, metrics } from "@guardora/core";
import { authLimiter, ipKeyFromHeader } from "@/lib/rate-limit";
import { startSession } from "@/server/session";
import { isSameOrigin } from "@/server/csrf";
import { issueVerificationEmail } from "@/server/auth-email";
import { getLocale } from "@/i18n/locale-server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 200;

/**
 * V1.50A — self-service registration. Validates input, hashes the password with
 * Argon2id, creates the account+workspace+trial atomically, opens a session, and
 * redirects to onboarding. Errors redirect back to /register?error=CODE (the page
 * renders a localized message) — no plaintext password ever leaves this action.
 */
export async function registerAction(formData: FormData): Promise<void> {
  const fail = (code: string): never => redirect(`/register?error=${encodeURIComponent(code)}`);

  if (!(await isSameOrigin())) fail("csrf");

  const ipKey = ipKeyFromHeader((await headers()).get("x-forwarded-for"));
  if (!authLimiter.check(`ip:${ipKey}`).allowed) {
    metrics.inc("auth_rate_limited_total", { operation: "register" });
    fail("rate_limited");
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  const workspaceName = String(formData.get("workspaceName") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();

  if (!EMAIL_RE.test(email) || email.length > 254) fail("invalid_email");
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) fail("weak_password");
  if (password !== confirm) fail("password_mismatch");
  if (workspaceName.length < 2 || workspaceName.length > 60) fail("missing_workspace");
  if (!country) fail("missing_country");

  // Per-email limit (after validation, so it counts only well-formed attempts).
  if (!authLimiter.check(`email:${normalizeEmail(email)}`).allowed) {
    metrics.inc("auth_rate_limited_total", { operation: "register" });
    fail("rate_limited");
  }

  let userId: string;
  try {
    const passwordHash = await hashPassword(password);
    const result = await registerUser({
      email,
      passwordHash,
      workspaceName,
      company: company || null,
      country,
    });
    userId = result.userId;
  } catch (e) {
    if (e instanceof EmailAlreadyRegisteredError) fail("email_taken");
    metrics.inc("auth_register_total", { operation: "register", result: "error" });
    emitOpsEvent("web.5xx", { operation: "register", reason: "server_error" });
    throw e;
  }

  // V1.50C — the account starts UNVERIFIED. Open a session (so the user reaches the
  // verification-required screen + resend), issue a one-time verification email, then land
  // on /verify-email. Onboarding/dashboard are gated until the email is verified. All OUTSIDE
  // the try/catch so the redirect throw (NEXT_REDIRECT) is never swallowed.
  await startSession(userId);
  await issueVerificationEmail(userId, normalizeEmail(email), await getLocale());
  metrics.inc("auth_register_total", { operation: "register", result: "ok" });
  redirect("/verify-email");
}
