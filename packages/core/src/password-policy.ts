/**
 * V1.58.9 — password POLICY + STRENGTH (the SERVER is the single source of truth). Length-based
 * acceptance only (min 12 / max 128 by default): long passphrases are first-class, and no "must contain
 * exactly one symbol / one uppercase" nonsense that lowers entropy or blocks a password manager. The
 * strength meter is ADVISORY (weak/fair/strong/very_strong) — it never relaxes the length policy.
 * Never logs or returns the password.
 */
export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
}

/** Resolve the policy from env directly (positive ints; safe defaults). min 12 / max 128. */
export function getPasswordPolicy(source: NodeJS.ProcessEnv = process.env): PasswordPolicy {
  const pos = (key: string, def: number) => {
    const n = Number(source[key]);
    return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : def;
  };
  const minLength = pos("PASSWORD_MIN_LENGTH", 12);
  const maxLength = pos("PASSWORD_MAX_LENGTH", 128);
  // Guard against an inverted config; fall back to safe bounds.
  return maxLength > minLength ? { minLength, maxLength } : { minLength: 12, maxLength: 128 };
}

export type PasswordStrength = "weak" | "fair" | "strong" | "very_strong";
export type PasswordReason = "too_short" | "too_long";

export interface PasswordEvaluation {
  ok: boolean;
  reasons: PasswordReason[];
  strength: PasswordStrength;
  /** 0–4 advisory score (length + character variety; a long passphrase scores well without symbols). */
  score: number;
}

/** Advisory strength score (0–4). Length dominates; variety is a bonus; a long passphrase scores high. */
export function passwordScore(pw: string): number {
  const len = [...pw].length; // count code points, not UTF-16 units
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^a-zA-Z0-9]/.test(pw)) classes++;
  let s = 0;
  if (len >= 12) s++;
  if (len >= 16) s++;
  if (len >= 20) s++;
  if (classes >= 3) s++;
  if (len >= 24) s = Math.max(s, 3); // a long passphrase is strong even with few classes
  return Math.min(4, s);
}

/**
 * Evaluate a password against the policy. Acceptance is purely length-in-bounds (measured in Unicode
 * code points — never silently truncated). Strength is advisory. Breached-password rejection is a
 * SEPARATE concern (see hibp.ts) so the two can be tested + toggled independently.
 */
export function evaluatePassword(pw: string, policy: PasswordPolicy = getPasswordPolicy()): PasswordEvaluation {
  const len = [...pw].length;
  const reasons: PasswordReason[] = [];
  if (len < policy.minLength) reasons.push("too_short");
  if (len > policy.maxLength) reasons.push("too_long");
  const score = passwordScore(pw);
  const strength: PasswordStrength = score >= 4 ? "very_strong" : score >= 3 ? "strong" : score >= 2 ? "fair" : "weak";
  return { ok: reasons.length === 0, reasons, strength, score };
}
