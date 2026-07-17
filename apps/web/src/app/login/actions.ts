"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { findUserForLogin, verifyPassword, normalizeEmail, DUMMY_PASSWORD_HASH } from "@guardora/db";
import { metrics, emitOpsEvent, getTurnstileConfig } from "@guardora/core";
import { authLimiter, loginChallengeLimiter, ipKeyFromHeader } from "@/lib/rate-limit";
import { startSession } from "@/server/session";
import { isSameOrigin } from "@/server/csrf";
import { verifyChallenge, summarizeUserAgent } from "@/server/auth-security";
import { sendSecurityEmail } from "@/server/security-email";
import { getLocale } from "@/i18n/locale-server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * V1.50A — credential login. Verifies an Argon2id hash, then issues a real
 * DB-backed opaque session via the existing {@link startSession}. Enumeration-safe:
 * a missing account and a wrong password return the SAME generic error AND run the
 * same Argon2 verify cost (against a dummy hash), so neither response nor timing
 * reveals whether an email is registered.
 */
export async function loginAction(formData: FormData): Promise<void> {
  const fail = (code: string): never => redirect(`/login?error=${encodeURIComponent(code)}`);

  if (!(await isSameOrigin())) fail("csrf");

  const ipKey = ipKeyFromHeader((await headers()).get("x-forwarded-for"));
  if (!(await authLimiter.check(`ip:${ipKey}`)).allowed) {
    metrics.inc("auth_rate_limited_total", { operation: "login" });
    fail("rate_limited");
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // V1.58.9 — "remember me": a persistent login gets the longer absolute ceiling (server-enforced).
  const rememberMe = ["on", "true", "1"].includes(String(formData.get("rememberMe") ?? "").toLowerCase());

  if (!EMAIL_RE.test(email) || !password) fail("invalid_credentials");
  if (!(await authLimiter.check(`email:${normalizeEmail(email)}`)).allowed) {
    metrics.inc("auth_rate_limited_total", { operation: "login" });
    fail("rate_limited");
  }

  // V1.58.9 — ADAPTIVE bot challenge. The SERVER decides (frontend cannot bypass): once recent attempts
  // for this (account|ip) reach the threshold, a valid Turnstile token is REQUIRED. Only enforced when
  // Turnstile is configured; the hard brute-force gate (authLimiter, fail-closed) is independent.
  const challengeKey = `${normalizeEmail(email)}|${ipKey}`;
  const challengeRequired = !(await loginChallengeLimiter.check(challengeKey)).allowed;
  if (getTurnstileConfig().enabled && challengeRequired) {
    const remoteip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
    const challenge = await verifyChallenge(String(formData.get("cf-turnstile-response") ?? ""), true, remoteip);
    if (!challenge.ok) {
      emitOpsEvent("auth.turnstile_failed", { operation: "login", reason: challenge.reason ?? "invalid" });
      emitOpsEvent("auth.login_blocked", { operation: "login", reason: "bot_challenge" });
      fail("challenge_required");
    }
  } else if (challengeRequired) {
    // Turnstile not configured — surface that a challenge WOULD be required (audit only; no bypass claim).
    emitOpsEvent("auth.bot_challenge", { operation: "login", reason: "challenge_required_no_provider" });
  }

  const user = await findUserForLogin(email);

  // ALWAYS run a full Argon2 verify — against a dummy hash when the account is missing
  // or has no local password — so response time never distinguishes "no such user"
  // from "wrong password" (no email enumeration via timing).
  if (!user || !user.passwordHash) {
    await verifyPassword(DUMMY_PASSWORD_HASH, password);
    metrics.inc("auth_login_total", { operation: "login", result: "denied" });
    emitOpsEvent("auth.login_failed", { operation: "login", reason: "invalid_credentials" });
    fail("invalid_credentials");
    return;
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    metrics.inc("auth_login_total", { operation: "login", result: "denied" });
    emitOpsEvent("auth.login_failed", { operation: "login", reason: "invalid_credentials" });
    fail("invalid_credentials");
    return;
  }

  // V1.58.9 — a fresh server-minted token per login (never accepts a client token pre-auth) is the
  // session-fixation defense; rememberMe selects the persistent ceiling.
  const ua = summarizeUserAgent((await headers()).get("user-agent"));
  const session = await startSession(user.id, undefined, rememberMe, ua ?? undefined);
  metrics.inc("auth_login_total", { operation: "login", result: "ok" });
  emitOpsEvent("auth.login_succeeded", { operation: "login", result: rememberMe ? "remember" : "session" });
  // V1.58.9 — security notification: a successful sign-in emails the account (best-effort; never blocks
  // login, never carries a token). CTA points to Active sessions.
  try {
    await sendSecurityEmail(session.userEmail, await getLocale(), "new_login", { when: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC", device: ua });
  } catch { /* delivery failure must not block login (already audited inside) */ }
  // V1.50C — an unverified email/password user goes to the verification-required screen.
  redirect(session.emailVerified ? "/dashboard" : "/verify-email");
}
