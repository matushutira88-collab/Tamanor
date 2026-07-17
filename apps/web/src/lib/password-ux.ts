/**
 * V1.58.9 — CLIENT-safe password UX helpers (strength meter + generator). Mirrors the pure logic of
 * @guardora/core (password-policy / password-generator) but without the node:crypto barrel, so it is
 * bundleable in a client component. The SERVER (@guardora/core) remains the single source of truth for
 * ACCEPTANCE — this is advisory UI + generation only. Uses Web Crypto (never Math.random).
 */
export type PasswordStrength = "weak" | "fair" | "strong" | "very_strong";

export function passwordScoreClient(pw: string): number {
  const len = [...pw].length;
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
  if (len >= 24) s = Math.max(s, 3);
  return Math.min(4, s);
}

export function strengthLabel(score: number): PasswordStrength {
  return score >= 4 ? "very_strong" : score >= 3 ? "strong" : score >= 2 ? "fair" : "weak";
}

const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+?";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** Cryptographically-secure password generator (Web Crypto). Guarantees ≥20 chars + one of each class. */
export function generatePasswordClient(length = 24): string {
  const L = Math.max(20, Math.floor(length));
  const bytes = new Uint8Array(L * 4 + 16);
  crypto.getRandomValues(bytes);
  let bi = 0;
  const nextByte = () => bytes[bi++ % bytes.length]!;
  const pick = (set: string): string => {
    const max = 256 - (256 % set.length);
    let b = nextByte();
    while (b >= max) b = nextByte();
    return set[b % set.length]!;
  };
  const out: string[] = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (out.length < L) out.push(pick(ALL));
  for (let i = out.length - 1; i > 0; i--) {
    const range = i + 1;
    const max = 256 - (256 % range);
    let b = nextByte();
    while (b >= max) b = nextByte();
    const j = b % range;
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.join("");
}
