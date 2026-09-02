"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { metrics, emitOpsEvent } from "@guardora/core";
import { ipKeyFromHeader } from "@/lib/rate-limit";
import { startSession } from "@/server/session";
import { getSession } from "@/server/auth";
import { resolveWorkspaceDestination } from "@/server/workspace-routing";
import { newTraceId, TRACE_COOKIE, traceCookieOptions, logPhase, withPhase, phaseLogger } from "@/server/diagnostics/login-trace";
import { isSameOrigin } from "@/server/csrf";
import { summarizeUserAgent } from "@/server/auth-security";
import { sendSecurityEmail } from "@/server/security-email";
import { getLocale } from "@/i18n/locale-server";
import { authenticateCredentials } from "@/server/login-core";
import { realCredentialDeps } from "@/server/login-deps";

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

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // V1.58.9 — "remember me": a persistent login gets the longer absolute ceiling (server-enforced).
  const rememberMe = ["on", "true", "1"].includes(String(formData.get("rememberMe") ?? "").toLowerCase());

  // M2 — rate limiting, bounded validation, the adaptive bot challenge and the
  // enumeration-safe credential check all live in the shared transport-agnostic
  // core, so the native mobile login route runs this exact sequence rather than a
  // second copy of it. The diagnostic phase tracer still wraps the two awaited
  // steps via `overrides` (diagnostics only — limiters and the challenge verifier
  // are not overridable).
  const base = realCredentialDeps();
  let lookedUpUserId: string | undefined;
  const outcome = await authenticateCredentials(
    {
      email,
      password,
      ipKey,
      challengeToken: String(formData.get("cf-turnstile-response") ?? ""),
      remoteIp: (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim(),
    },
    realCredentialDeps({
      findUserForLogin: async (e) => {
        const found = await withPhase(traceId, "USER_LOOKUP_COMPLETED", () => base.findUserForLogin(e), { route: "/login" });
        lookedUpUserId = found?.id;
        return found;
      },
      // Only the REAL credential check is a diagnostic milestone. The dummy verify
      // that equalizes timing for a missing account runs untraced, exactly as before.
      verifyPassword: (hash, plaintext) =>
        lookedUpUserId
          ? withPhase(traceId, "PASSWORD_VERIFIED", () => base.verifyPassword(hash, plaintext), { route: "/login", userId: lookedUpUserId })
          : base.verifyPassword(hash, plaintext),
    }),
  );
  if (!outcome.ok) {
    fail(outcome.failure);
    return;
  }
  const user = { id: outcome.userId };

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
  if (!session.emailVerified) redirect("/verify-email");
  // CS-C6.1 — route by the CENTRAL resolver (fail-closed): Business → /dashboard, Family → /family or its
  // onboarding, unknown/corrupt/unsupported → /unsupported-workspace. Never a Business default for unknown.
  const appSession = await getSession();
  redirect(appSession ? (await resolveWorkspaceDestination(appSession)).href : "/dashboard");
}
