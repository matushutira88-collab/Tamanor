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
import { checkPasswordAcceptable, verifyChallenge, summarizeUserAgent } from "@/server/auth-security";
import { getTurnstileConfig } from "@guardora/core";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (!(await authLimiter.check(`ip:${ipKey}`)).allowed) {
    metrics.inc("auth_rate_limited_total", { operation: "register" });
    fail("rate_limited");
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  const workspaceName = String(formData.get("workspaceName") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();

  // V1.58.9 — bot protection: when Turnstile is enabled, registration ALWAYS requires a verified
  // challenge (server-side siteverify; fail-closed if the secret is missing in production).
  if (getTurnstileConfig().enabled) {
    const remoteip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
    const challenge = await verifyChallenge(String(formData.get("cf-turnstile-response") ?? ""), true, remoteip);
    if (!challenge.ok) {
      emitOpsEvent("auth.turnstile_failed", { operation: "register", reason: challenge.reason ?? "invalid" });
      emitOpsEvent("auth.registration_blocked", { operation: "register", reason: "bot_challenge" });
      fail("challenge_failed");
    }
  }

  if (!EMAIL_RE.test(email) || email.length > 254) fail("invalid_email");
  if (password !== confirm) fail("password_mismatch");
  // V1.58.9 — server-authoritative policy (min 12 / max 128) + breached-password rejection (HIBP).
  const pw = await checkPasswordAcceptable(password);
  if (!pw.ok) {
    if (pw.reason === "breached") { emitOpsEvent("auth.breached_password_blocked", { operation: "register" }); fail("breached_password"); }
    fail("weak_password");
  }
  if (workspaceName.length < 2 || workspaceName.length > 60) fail("missing_workspace");
  if (!country) fail("missing_country");

  // Per-email limit (after validation, so it counts only well-formed attempts).
  if (!(await authLimiter.check(`email:${normalizeEmail(email)}`)).allowed) {
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
  const uaSummary = summarizeUserAgent((await headers()).get("user-agent")) ?? undefined;
  await startSession(userId, undefined, false, uaSummary);
  await issueVerificationEmail(userId, normalizeEmail(email), await getLocale());
  metrics.inc("auth_register_total", { operation: "register", result: "ok" });
  emitOpsEvent("auth.registration_completed", { operation: "register" });
  redirect("/verify-email?ae=registration_completed");
}
