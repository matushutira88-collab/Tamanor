/**
 * V1.39C — the ONE gate for E2E-only test seams (stable auth bootstrap + a controlled
 * slow mutation for the double-submit proof). Fail-closed: enabled ONLY when the
 * `E2E_TEST_MODE` environment variable is exactly "true". It is NEVER set in a real
 * production deploy, so the seam is inert there. This is not a general debug bypass —
 * it only unlocks the narrow test routes below, and changes no business result.
 */
type EnvLike = Record<string, string | undefined>;

export function e2eSeamEnabled(env: EnvLike = process.env): boolean {
  return env.E2E_TEST_MODE === "true";
}

/** Gated delay (ms) used ONLY to make a mutation's pending state observable in a browser. */
export function e2eMutationDelayMs(env: EnvLike = process.env): number {
  if (!e2eSeamEnabled(env)) return 0;
  const n = Number(env.E2E_MUTATION_DELAY_MS ?? 1500);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5000) : 1500;
}
