"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { findUserForLogin, verifyPassword, normalizeEmail, DUMMY_PASSWORD_HASH } from "@guardora/db";
import { metrics } from "@guardora/core";
import { authLimiter, ipKeyFromHeader } from "@/lib/rate-limit";
import { startSession } from "@/server/session";
import { isSameOrigin } from "@/server/csrf";

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

  if (!EMAIL_RE.test(email) || !password) fail("invalid_credentials");
  if (!(await authLimiter.check(`email:${normalizeEmail(email)}`)).allowed) {
    metrics.inc("auth_rate_limited_total", { operation: "login" });
    fail("rate_limited");
  }

  const user = await findUserForLogin(email);

  // ALWAYS run a full Argon2 verify — against a dummy hash when the account is missing
  // or has no local password — so response time never distinguishes "no such user"
  // from "wrong password" (no email enumeration via timing).
  if (!user || !user.passwordHash) {
    await verifyPassword(DUMMY_PASSWORD_HASH, password);
    metrics.inc("auth_login_total", { operation: "login", result: "denied" });
    fail("invalid_credentials");
    return;
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    metrics.inc("auth_login_total", { operation: "login", result: "denied" });
    fail("invalid_credentials");
    return;
  }

  const session = await startSession(user.id); // opaque DB session; fail-closed on missing membership
  metrics.inc("auth_login_total", { operation: "login", result: "ok" });
  // V1.50C — an unverified email/password user goes to the verification-required screen.
  redirect(session.emailVerified ? "/dashboard" : "/verify-email");
}
