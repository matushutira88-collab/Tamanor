import { NextResponse, type NextRequest } from "next/server";
import { consumeEmailVerificationToken } from "@guardora/db";
import { emitOpsEvent, metrics } from "@guardora/core";
import { authLimiter, ipKeyFromHeader } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * V1.50C — GET /api/auth/verify-email?token=RAW (the email link target). Consumes the
 * one-time token, marks the email verified, and REDIRECTS — so the raw token is removed from
 * the address bar immediately. Session-independent (works from any device/browser). Truthful,
 * idempotent, race-safe. The token is never logged.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.origin;
  const dest = (path: string) => NextResponse.redirect(new URL(path, origin));

  const ip = ipKeyFromHeader(req.headers.get("x-forwarded-for"));
  if (!(await authLimiter.check(`verify:${ip}`)).allowed) return dest("/verify-email?status=rate_limited");

  const token = req.nextUrl.searchParams.get("token");
  if (!token) return dest("/verify-email?status=invalid");

  const res = await consumeEmailVerificationToken(token);
  if (res.ok) {
    metrics.inc("auth_verification_total", { result: "ok" });
    return dest("/login?verified=1");
  }
  metrics.inc("auth_verification_total", { result: "denied" });
  emitOpsEvent("auth.verification_failed", { reason: res.reason });
  return dest(`/verify-email?status=${res.reason}`);
}
