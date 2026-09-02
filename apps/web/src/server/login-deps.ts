import "server-only";
import { findUserForLogin, verifyPassword, normalizeEmail, DUMMY_PASSWORD_HASH } from "@guardora/db";
import { metrics, emitOpsEvent, getTurnstileConfig } from "@guardora/core";
import { authLimiter, loginChallengeLimiter } from "@/lib/rate-limit";
import { verifyChallenge } from "@/server/auth-security";
import type { CredentialDeps } from "./login-core";

/**
 * M2 — the ONE wiring of {@link CredentialDeps} to the real limiters, challenge
 * verifier and credential store.
 *
 * Both login transports (the web Server Action and the native mobile route) build
 * their dependencies here, so neither can accidentally be pointed at a different
 * limiter, a weaker challenge check, or a different password verifier.
 *
 * `overrides` exists only so the web action can wrap the two awaited steps in its
 * diagnostic phase tracer; it cannot be used to substitute a limiter or the
 * challenge verifier.
 */
export function realCredentialDeps(
  overrides?: Partial<Pick<CredentialDeps, "findUserForLogin" | "verifyPassword">>,
): CredentialDeps {
  return {
    authLimiter,
    challengeLimiter: loginChallengeLimiter,
    turnstileEnabled: () => getTurnstileConfig().enabled,
    verifyChallenge,
    normalizeEmail,
    findUserForLogin: overrides?.findUserForLogin ?? findUserForLogin,
    verifyPassword: overrides?.verifyPassword ?? verifyPassword,
    dummyPasswordHash: DUMMY_PASSWORD_HASH,
    metrics,
    emitOpsEvent,
  };
}
