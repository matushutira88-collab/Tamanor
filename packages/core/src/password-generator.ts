/**
 * V1.58.9 — cryptographically-secure password generator. Uses Web Crypto (crypto.getRandomValues) —
 * NEVER Math.random. Guarantees ≥ 20 chars and at least one lower/upper/digit/symbol, with unbiased
 * (rejection-sampled) selection. The RNG is injectable so tests are deterministic; production uses the
 * platform CSPRNG. The generated password is returned to the caller only — it is never logged.
 */
const LOWER = "abcdefghijkmnopqrstuvwxyz"; // no ambiguous l
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";  // no ambiguous I, O
const DIGITS = "23456789";                  // no ambiguous 0, 1
const SYMBOLS = "!@#$%^&*-_=+?";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** Default CSPRNG byte source (Web Crypto). Throws if no secure RNG is available (fail-closed). */
export function secureRandomBytes(n: number): Uint8Array {
  const g = globalThis as unknown as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (!g.crypto?.getRandomValues) throw new Error("secure RNG unavailable");
  const out = new Uint8Array(n);
  g.crypto.getRandomValues(out);
  return out;
}

/**
 * Generate a strong password. `length` is clamped to a minimum of 20. `randomBytes` is injectable
 * (tests pass a deterministic stream); it must return enough bytes — the generator draws more as needed
 * via modular reuse, so a short stream still terminates. Rejection sampling removes modulo bias.
 */
export function generatePassword(length = 24, randomBytes: (n: number) => Uint8Array = secureRandomBytes): string {
  const L = Math.max(20, Math.floor(length));
  const bytes = randomBytes(L * 4 + 16);
  let bi = 0;
  const nextByte = () => bytes[bi++ % bytes.length]!;
  const pick = (set: string): string => {
    const max = 256 - (256 % set.length); // unbiased range
    let b = nextByte();
    while (b >= max) b = nextByte();
    return set[b % set.length]!;
  };

  // Guarantee at least one of each class, then fill from the full alphabet.
  const out: string[] = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (out.length < L) out.push(pick(ALL));

  // Fisher–Yates shuffle so the guaranteed-class chars aren't always in the first positions.
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
