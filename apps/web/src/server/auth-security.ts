import "server-only";
import {
  evaluatePassword, getPasswordPolicy, createHibpChecker, createMockBreachedChecker, hibpEnabled,
  getTurnstileConfig, verifyTurnstile, type BreachedPasswordChecker,
} from "@guardora/core";

/**
 * V1.58.9 phase 2 — shared server-side auth security helpers used by register / reset / change-password.
 * The SERVER is the single source of truth for password policy + breach + Turnstile. Never logs or
 * returns a password, hash, secret, or Turnstile token.
 */

/** A coarse, privacy-preserving device label from the User-Agent — never the raw UA fingerprint. */
export function summarizeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  return `${browser} · ${os}`;
}

/** Test seam: override the HIBP checker (a mock) so integration tests never hit the network. */
let breachedChecker: BreachedPasswordChecker | null = null;
export function __setBreachedCheckerForTests(set: Set<string> | null): void {
  breachedChecker = set ? createMockBreachedChecker(set) : null;
}
function checker(): BreachedPasswordChecker {
  return breachedChecker ?? createHibpChecker({ timeoutMs: 3_000 });
}

export type PasswordRejection = "too_short" | "too_long" | "breached";

/**
 * Server-authoritative password acceptance: length policy THEN breached-password check (HIBP
 * k-anonymity, only the SHA-1 prefix leaves the process). Fail-OPEN on a HIBP outage (degraded ⇒ allow,
 * never block registration on a transient outage). Returns a safe rejection reason (never the password).
 */
export async function checkPasswordAcceptable(pw: string): Promise<{ ok: boolean; reason?: PasswordRejection; degraded?: boolean }> {
  const evalRes = evaluatePassword(pw, getPasswordPolicy());
  if (!evalRes.ok) return { ok: false, reason: evalRes.reasons[0] };
  if (!hibpEnabled()) return { ok: true };
  const b = await checker().isBreached(pw);
  if (b.degraded) return { ok: true, degraded: true }; // fail open on transient HIBP error
  if (b.breached) return { ok: false, reason: "breached" };
  return { ok: true };
}

export interface ChallengeOutcome { ok: boolean; reason?: string }

/**
 * Verify a Turnstile challenge when required. `required` is the SERVER's decision (registration: always
 * when enabled; login: adaptive). When Turnstile is disabled, this is a no-op pass. FAIL-CLOSED: enabled
 * + required + missing secret ⇒ refuse. The token/secret are never logged.
 */
export async function verifyChallenge(token: string | null | undefined, required: boolean, remoteip?: string): Promise<ChallengeOutcome> {
  const cfg = getTurnstileConfig();
  if (!cfg.enabled || !required) return { ok: true };
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret || !cfg.siteKey) return { ok: false, reason: "config_missing" }; // fail closed
  const res = await verifyTurnstile({ token, secret, remoteip });
  return { ok: res.ok, reason: res.reason };
}

/** Whether Turnstile should be shown on registration (enabled). The site key is public. */
export function turnstileForRegistration(): { enabled: boolean; siteKey?: string } {
  const cfg = getTurnstileConfig();
  return { enabled: cfg.enabled, siteKey: cfg.siteKey };
}
