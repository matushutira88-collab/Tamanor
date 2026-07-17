/**
 * V1.59 — DETERMINISTIC "protection setup level" score. Server-computed, explainable, never random or
 * marketing. Each component contributes a fixed number of points; the total (0–100) plus the per-
 * component breakdown is returned so the user sees exactly WHY, and a config change moves the score
 * predictably. This is a SETUP-completeness signal, not a security certification.
 */
export interface ProtectionScoreInput {
  /** Meta permissions healthy (token ok, required scopes granted, not expired). */
  metaPermissionsHealthy: boolean;
  /** Sync is healthy (recent successful sync, no error/degraded health). */
  syncHealthy: boolean;
  /** At least one relevant protection rule/category is active for the account. */
  rulesActive: boolean;
  /** Dangerous-link handling is enabled (category active). */
  dangerousLinksHandled: boolean;
  /** Fraud/scam protection category is active. */
  fraudProtection: boolean;
  /** A review workflow exists (manual approval OR an action queue is in use). */
  reviewWorkflow: boolean;
  /** Auto-action OR manual review is CORRECTLY configured (not left in an ambiguous half-state). */
  actionConfigured: boolean;
}

export interface ProtectionScoreComponent {
  key: string;
  label: string;
  points: number;
  max: number;
  ok: boolean;
}

export interface ProtectionScore {
  score: number;
  max: number;
  /** Coarse level for UI styling. */
  level: "critical" | "weak" | "fair" | "good" | "strong";
  components: ProtectionScoreComponent[];
}

const WEIGHTS: Array<{ key: keyof ProtectionScoreInput; label: string; max: number }> = [
  { key: "metaPermissionsHealthy", label: "Meta permissions", max: 20 },
  { key: "syncHealthy", label: "Sync health", max: 20 },
  { key: "rulesActive", label: "Protection rules active", max: 20 },
  { key: "dangerousLinksHandled", label: "Dangerous links", max: 10 },
  { key: "fraudProtection", label: "Fraud protection", max: 10 },
  { key: "reviewWorkflow", label: "Review workflow", max: 10 },
  { key: "actionConfigured", label: "Action configured", max: 10 },
];

export function computeProtectionScore(input: ProtectionScoreInput): ProtectionScore {
  const components = WEIGHTS.map((w) => {
    const ok = input[w.key] === true;
    return { key: w.key, label: w.label, points: ok ? w.max : 0, max: w.max, ok };
  });
  const score = components.reduce((s, c) => s + c.points, 0);
  const max = WEIGHTS.reduce((s, w) => s + w.max, 0); // 100
  const level: ProtectionScore["level"] =
    score >= 85 ? "strong" : score >= 70 ? "good" : score >= 50 ? "fair" : score >= 25 ? "weak" : "critical";
  return { score, max, level, components };
}
