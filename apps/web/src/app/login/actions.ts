"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { findUserForLogin, verifyPassword, normalizeEmail, DUMMY_PASSWORD_HASH } from "@guardora/db";
import { metrics, emitOpsEvent, getTurnstileConfig } from "@guardora/core";
import { authLimiter, loginChallengeLimiter, ipKeyFromHeader } from "@/lib/rate-limit";
import { startSession } from "@/server/session";
import { newTraceId, TRACE_COOKIE, traceCookieOptions, logPhase, withPhase, phaseLogger } from "@/server/diagnostics/login-trace";
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

  // V1.63 — diagnostic trace: ONE stable id for the whole login → dashboard flow, carried to the dashboard
  // render via an httpOnly cookie (never a URL param). Fully fail-open — never alters login behaviour, and
  // NEXT_REDIRECT control-flow is never treated as an error (see withPhase / onRequestError).
  const traceId = newTraceId();
  try { (await cookies()).set(TRACE_COOKIE, traceId, traceCookieOptions()); } catch { /* fail-open */ }
  logPhase({ traceId, phase: "LOGIN_SUBMITTED", route: "/login", success: true });

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

  const user = await withPhase(traceId, "USER_LOOKUP_COMPLETED", () => findUserForLogin(email), { route: "/login" });

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

  const passwordOk = await withPhase(traceId, "PASSWORD_VERIFIED", () => verifyPassword(user.passwordHash, password), { route: "/login", userId: user.id });
  if (!passwordOk) {
    metrics.inc("auth_login_total", { operation: "login", result: "denied" });
    emitOpsEvent("auth.login_failed", { operation: "login", reason: "invalid_credentials" });
    fail("invalid_credentials");
    return;
  }

  // V1.58.9 — a fresh server-minted token per login (never accepts a client token pre-auth) is the
  // session-fixation defense; rememberMe selects the persistent ceiling.
  // V1.63 — onPhase emits MEMBERSHIP_RESOLVED / SESSION_CREATED / COOKIE_SET (fail-open); a throw here is
  // captured by onRequestError with the same traceId (from the cookie set above).
  const ua = summarizeUserAgent((await headers()).get("user-agent"));
  const session = await startSession(user.id, undefined, rememberMe, ua ?? undefined, { onPhase: phaseLogger(traceId, { userId: user.id }) });
  metrics.inc("auth_login_total", { operation: "login", result: "ok" });
  emitOpsEvent("auth.login_succeeded", { operation: "login", result: rememberMe ? "remember" : "session" });
  // V1.58.9 — security notification: a successful sign-in emails the account (best-effort; never blocks
  // login, never carries a token). CTA points to Active sessions.
  try {
    await sendSecurityEmail(session.userEmail, await getLocale(), "new_login", { when: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC", device: ua });
  } catch { /* delivery failure must not block login (already audited inside) */ }
  logPhase({ traceId, phase: "REDIRECT_STARTED", success: true, userId: user.id, tenantId: session.tenantId });
  // V1.50C — an unverified email/password user goes to the verification-required screen.
  redirect(session.emailVerified ? "/dashboard" : "/verify-email");
}
