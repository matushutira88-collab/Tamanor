/**
 * Protection-level classification.
 *
 * Split from `protection-summary.tsx` so the thresholds are testable without
 * pulling React Native into the test runtime.
 */

export type ProtectionLevel = "strong" | "partial" | "weak";

/**
 * Same thresholds as the web dashboard's protection ring colour
 * (`score >= 80` ok, `>= 50` warn, otherwise danger).
 */
export function protectionLevel(score: number): ProtectionLevel {
  if (score >= 80) return "strong";
  if (score >= 50) return "partial";
  return "weak";
}
