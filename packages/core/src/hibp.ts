/**
 * V1.58.9 — breached-password check via Have I Been Pwned "Pwned Passwords", using k-ANONYMITY.
 * ONLY the first 5 hex chars of the password's SHA-1 are ever sent to the API; the full password and
 * the full hash NEVER leave the process. `Add-Padding` is requested so the response size can't leak the
 * prefix's hit count. Bounded timeout; FAIL-OPEN on any transient error (a HIBP outage must not block
 * registration) — the `degraded` flag lets the caller log/annotate. A definitive match rejects.
 * No password/hash is ever logged.
 */
import { createHash } from "node:crypto";

export interface BreachedResult {
  breached: boolean;
  /** Number of times seen in breaches (0 when not found or degraded). */
  count: number;
  /** True when the external service was unreachable/errored and we failed open (result is not authoritative). */
  degraded: boolean;
}

export interface BreachedPasswordChecker {
  isBreached(password: string): Promise<BreachedResult>;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

function sha1Hex(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("hex").toUpperCase();
}

/**
 * Real HIBP checker. `fetchImpl` defaults to global fetch (injectable for tests). Sends only the 5-char
 * SHA-1 prefix to `/range/{prefix}` and scans the returned suffix list locally.
 */
export function createHibpChecker(opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): BreachedPasswordChecker {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = opts.timeoutMs ?? 3_000;
  return {
    async isBreached(password: string): Promise<BreachedResult> {
      const hash = sha1Hex(password);
      const prefix = hash.slice(0, 5);
      const suffix = hash.slice(5);
      try {
        const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
          headers: { "Add-Padding": "true" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return { breached: false, count: 0, degraded: true }; // fail open
        const body = await res.text();
        for (const line of body.split("\n")) {
          const idx = line.indexOf(":");
          if (idx <= 0) continue;
          const suf = line.slice(0, idx).trim().toUpperCase();
          if (suf === suffix) {
            const count = Number(line.slice(idx + 1).trim()) || 0;
            return { breached: count > 0, count, degraded: false };
          }
        }
        return { breached: false, count: 0, degraded: false };
      } catch {
        return { breached: false, count: 0, degraded: true }; // transport/timeout → fail open
      }
    },
  };
}

/** In-memory mock (tests): a password is breached iff its plaintext is in `breachedSet`. */
export function createMockBreachedChecker(breachedSet: Set<string>): BreachedPasswordChecker {
  return {
    async isBreached(password: string): Promise<BreachedResult> {
      return { breached: breachedSet.has(password), count: breachedSet.has(password) ? 1 : 0, degraded: false };
    },
  };
}

/** True only when HIBP checking is enabled (default ON). Disable per-env with HIBP_ENABLED=false. */
export function hibpEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  const v = (source.HIBP_ENABLED ?? "true").trim().toLowerCase();
  return v !== "false" && v !== "0";
}
