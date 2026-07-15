"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hashPassword, resetPasswordWithToken } from "@guardora/db";
import { emitOpsEvent, metrics } from "@guardora/core";
import { authLimiter, ipKeyFromHeader } from "@/lib/rate-limit";
import { isSameOrigin } from "@/server/csrf";

const MIN_PASSWORD = 10;
const MAX_PASSWORD = 200;

/**
 * V1.50C — complete a password reset. Validates the same production policy as registration,
 * then atomically consumes the one-time token, sets the new Argon2id hash + passwordChangedAt,
 * and revokes EVERY existing session (in one transaction — any failure rolls back, leaving the
 * old password + token valid). No new session is created. Redirects to /login (token stripped).
 */
export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const fail = (code: string): never =>
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(code)}`);

  if (!(await isSameOrigin())) fail("csrf");

  const ip = ipKeyFromHeader((await headers()).get("x-forwarded-for"));
  if (!authLimiter.check(`reset:ip:${ip}`).allowed) {
    metrics.inc("auth_rate_limited_total", { operation: "reset" });
    fail("rate_limited");
  }

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (!token) fail("invalid");
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) fail("weak_password");
  if (password !== confirm) fail("password_mismatch");

  // Hash BEFORE the guarded consume so a slow hash can't widen the token's live window.
  const newHash = await hashPassword(password);

  let result;
  try {
    result = await resetPasswordWithToken(token, newHash);
  } catch {
    emitOpsEvent("auth.password_reset_failed", { reason: "server_error" });
    fail("server_error");
    return;
  }
  if (!result.ok) {
    emitOpsEvent("auth.password_reset_failed", { reason: result.reason });
    fail(result.reason);
    return;
  }

  metrics.inc("auth_password_reset_total", { result: "ok" });
  // All prior sessions are revoked; no session is created — the user logs in fresh.
  redirect("/login?reset=1");
}
