import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

/**
 * V1.50A — local credential hashing. Argon2id ONLY (the @node-rs/argon2 default
 * algorithm; the enum constant can't be imported under verbatimModuleSyntax, so we
 * rely on the default and assert the `$argon2id$` prefix in tests to catch any
 * regression). A plaintext password is never stored, logged, or returned; only the
 * PHC-format hash string is persisted in `User.passwordHash`. Verification is
 * constant-time (Argon2's internal compare).
 *
 * Parameters are the secure defaults (m=19456 KiB, t=2, p=1), pinned explicitly so a
 * library default change cannot silently weaken hashing.
 */
const ARGON2ID_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hash a plaintext password with Argon2id. Returns a self-describing PHC string. */
export async function hashPassword(plaintext: string): Promise<string> {
  return argonHash(plaintext, ARGON2ID_OPTIONS);
}

/**
 * Verify a plaintext password against a stored Argon2id hash. Fail-closed: any
 * malformed/foreign hash, or a null/empty hash, returns false (never throws to the
 * caller — an error must never read as "authenticated").
 */
export async function verifyPassword(hash: string | null | undefined, plaintext: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argonVerify(hash, plaintext);
  } catch {
    return false;
  }
}

/**
 * A pre-computed Argon2id hash of a random string, used to equalize response
 * timing when an account does not exist (or has no local password) so that a
 * login endpoint cannot be used to enumerate registered emails by timing.
 * The plaintext is intentionally unknown, so a verify against it always fails.
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$MmoxYDt1kJqHvW81tAyDRg$s80DqfRUnpowy1ifjsdoF2PJKETTz6vb+03hM8YgfMg";
