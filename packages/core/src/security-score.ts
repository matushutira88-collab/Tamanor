/**
 * Composite Security Score (S1). A deterministic, explainable 0–100 posture
 * score built from FIVE independently-scored dimensions, combined by a weighted
 * average. No AI, no network — a pure function of pre-aggregated facts.
 *
 * Missing-data policy (hard requirement): missing data is NEVER scored as the
 * worst value. A factor with no signal is marked `unavailable` (structurally not
 * measurable yet) or `insufficient_data` (not enough rows to judge) and EXCLUDED
 * from its dimension's average. A dimension with no measured factors is itself
 * `insufficient_data` (score = null). The overall score is the weighted average
 * of the dimensions that HAVE a score, with weights renormalized over them; the
 * result reports how many dimensions were measurable (`coverage`) so a thin score
 * is never mistaken for a complete one.
 *
 * Every point deducted carries a machine-readable `issueCode` + `evidence` so the
 * UI can render a localized reason and recommendation. The engine emits no prose.
 *
 * The existing reputation ProtectionScore stays a separate metric AND feeds the
 * Protection Coverage dimension here: the loader computes it with
 * `computeProtectionScore` and passes the 0–100 number in as `coverage.protectionScore`
 * — no changes to ProtectionScore, no breaking changes.
 */

export const SECURITY_SCORE_VERSION = "security-score-v1";

/**
 * Minimum measurable dimensions required before an overall score is reported.
 * Below this the result is `insufficient_data` (score = null) — a headline number
 * built from a single trivially-measurable dimension (e.g. billing state alone on
 * an empty workspace) would over-state confidence. Individual dimension scores are
 * still returned so the UI can show what little is known.
 */
export const MIN_MEASURED_DIMENSIONS = 2;

// --- Weights ---------------------------------------------------------------

export enum SecurityDimensionKey {
  Access = "access",
  Connector = "connector",
  Coverage = "coverage",
  Response = "response",
  Compliance = "compliance",
}

/** Overall dimension weights (percent, sum = 100). */
export const DIMENSION_WEIGHTS: Record<SecurityDimensionKey, number> = {
  [SecurityDimensionKey.Access]: 25,
  [SecurityDimensionKey.Connector]: 20,
  [SecurityDimensionKey.Coverage]: 20,
  [SecurityDimensionKey.Response]: 20,
  [SecurityDimensionKey.Compliance]: 15,
};

/**
 * Thresholds used by the LOADER when turning raw rows into the counts below.
 * Exported so the loader and tests share one deterministic definition.
 */
export const SECURITY_SCORE_THRESHOLDS = {
  staleSessionDays: 30,
  passwordMaxAgeDays: 365,
  tokenExpiringSoonDays: 7,
  incidentStaleHours: 72,
  approvalStaleHours: 48,
  highRiskAgedHours: 48,
  auditRecentDays: 30,
} as const;

// --- Result shapes ---------------------------------------------------------

export type FactorStatus = "measured" | "unavailable" | "insufficient_data";
export type ScoreLevel = "strong" | "fair" | "weak";
export type OverallStatus = "measured" | "insufficient_data";

/** Evidence values backing a reason. Numbers interpolate into localized text;
 *  strings/booleans name the config source (never a secret/key value). */
export type EvidenceValue = number | string | boolean;

export interface SecurityScoreFactor {
  key: string;
  status: FactorStatus;
  /** 0–100 when measured; null otherwise. */
  score: number | null;
  /** Nominal weight within the dimension (only compared among measured factors). */
  weight: number;
  /**
   * Stable code the UI maps to a localized reason + recommendation. Set when a
   * measured factor loses points, OR to explain why a factor is unavailable /
   * insufficient. Null when the factor is a clean 100.
   */
  issueCode: string | null;
  /** Optional severity escalation for a measured deduction (e.g. a plaintext token
   *  store in a real deployment is CRITICAL, not just a low score). */
  severity?: "critical";
  /** Evidence backing the reason (numbers interpolate; strings/booleans name the
   *  config source). MUST never contain a secret or key material. */
  evidence: Record<string, EvidenceValue>;
}

/**
 * Explicit token-encryption fact produced by the loader (the engine never reads
 * env). `state`:
 *   - "secure"      → encryption at rest is really enabled & verifiable → GOOD.
 *   - "insecure"    → plaintext in a REAL deployed env → CRITICAL, score 0.
 *   - "unavailable" → local/dev/test → not applicable, no penalty.
 *   - "unknown"     → cannot be determined → insufficient, no penalty (never guessed).
 * `mode`/`keyConfigured`/`environment` are non-secret evidence.
 */
export interface TokenEncryptionFact {
  state: "secure" | "insecure" | "unavailable" | "unknown";
  mode: "plaintext" | "aes-gcm" | "kms" | "unknown";
  keyConfigured: boolean;
  environment: "deployed" | "local" | "unknown";
}

export interface SecurityScoreDimensionResult {
  key: SecurityDimensionKey;
  weight: number;
  status: FactorStatus; // measured | insufficient_data (never "unavailable" at dimension level)
  score: number | null;
  level: ScoreLevel | null;
  factors: SecurityScoreFactor[];
}

export interface SecurityScoreResult {
  version: string;
  score: number | null;
  level: ScoreLevel | null;
  status: OverallStatus;
  dimensions: SecurityScoreDimensionResult[];
  coverage: { dimensionsMeasured: number; dimensionsTotal: number; confidence: "high" | "medium" | "low" };
  weightsRenormalized: boolean;
}

// --- Input shape (only real, knowable facts; produced by the loader) --------

export interface SecurityScoreInput {
  access: {
    totalMembers: number;
    verifiedMembers: number;
    ownersAdmins: number;
    passwordUsers: number;
    passwordsOverAge: number; // passwordChangedAt older than threshold (or null) among password users
    activeSessions: number; // not revoked, not expired
    staleSessions: number; // active but lastSeen older than staleSessionDays
    mfaSupported: boolean; // false today (no MFA feature) → mfa factor unavailable
    breachDataAvailable: boolean; // false today (HIBP not persisted) → breach factor unavailable
  };
  connector: {
    totalAccounts: number; // non-disconnected
    activeAccounts: number;
    healthyConnections: number; // health healthy && connectionStatus connected
    tokenOk: number;
    tokenProblem: number; // expired | invalid | revoked
    tokenExpiringSoon: number;
    monitoringOn: number;
    permissionBaselineAvailable: boolean; // false today → drift factor unavailable
  };
  coverage: {
    monitoredAccounts: number;
    /** Aggregated reputation ProtectionScore 0–100 (null when no monitored accounts). */
    protectionScore: number | null;
  };
  response: {
    hasActivity: boolean; // accounts>0 OR reputation items>0 OR incidents>0
    openIncidents: number;
    agedOpenIncidents: number; // open longer than incidentStaleHours
    pendingApprovals: number;
    agedPendingApprovals: number; // pending longer than approvalStaleHours
    highRiskItems: number;
    agedUnresolvedHighRisk: number; // high/critical unresolved longer than highRiskAgedHours
  };
  compliance: {
    accessState: string; // full_access | grace_period | restricted | suspended
    auditEntries: number; // audit rows within auditRecentDays
    dataRetentionConfigured: boolean;
    /** Explicit encryption-at-rest fact built by the loader (engine never reads env). */
    tokenEncryption: TokenEncryptionFact;
  };
}

// --- Helpers ---------------------------------------------------------------

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const pct = (part: number, whole: number) => (whole <= 0 ? 100 : clamp((part / whole) * 100));

export function levelFor(score: number | null): ScoreLevel | null {
  if (score === null) return null;
  if (score >= 80) return "strong";
  if (score >= 50) return "fair";
  return "weak";
}

function measured(key: string, weight: number, score: number, issueCode: string | null, evidence: Record<string, EvidenceValue> = {}): SecurityScoreFactor {
  return { key, status: "measured", score: clamp(score), weight, issueCode: score >= 100 ? null : issueCode, evidence };
}
function unavailable(key: string, weight: number, issueCode: string, evidence: Record<string, EvidenceValue> = {}): SecurityScoreFactor {
  return { key, status: "unavailable", score: null, weight, issueCode, evidence };
}
function insufficient(key: string, weight: number, issueCode: string, evidence: Record<string, EvidenceValue> = {}): SecurityScoreFactor {
  return { key, status: "insufficient_data", score: null, weight, issueCode, evidence };
}

/** Combine a dimension's factors: weighted avg over MEASURED factors only. */
function combineDimension(key: SecurityDimensionKey, factors: SecurityScoreFactor[]): SecurityScoreDimensionResult {
  const scored = factors.filter((f) => f.status === "measured" && f.score !== null);
  const weight = DIMENSION_WEIGHTS[key];
  if (scored.length === 0) {
    return { key, weight, status: "insufficient_data", score: null, level: null, factors };
  }
  const wsum = scored.reduce((s, f) => s + f.weight, 0);
  const score = clamp(scored.reduce((s, f) => s + (f.score as number) * f.weight, 0) / (wsum || 1));
  return { key, weight, status: "measured", score, level: levelFor(score), factors };
}

// --- Dimension builders ----------------------------------------------------

function buildAccess(a: SecurityScoreInput["access"]): SecurityScoreDimensionResult {
  const factors: SecurityScoreFactor[] = [];
  // email verification
  if (a.totalMembers > 0) {
    const unverified = Math.max(0, a.totalMembers - a.verifiedMembers);
    factors.push(measured("email_verification", 30, pct(a.verifiedMembers, a.totalMembers), "unverified_members", { unverified, total: a.totalMembers }));
  } else {
    factors.push(insufficient("email_verification", 30, "no_members"));
  }
  // session hygiene
  if (a.activeSessions > 0) {
    factors.push(measured("session_hygiene", 25, 100 - pctRaw(a.staleSessions, a.activeSessions), "stale_sessions", { stale: a.staleSessions, active: a.activeSessions }));
  } else {
    factors.push(insufficient("session_hygiene", 25, "no_sessions"));
  }
  // privilege distribution (small teams are fine by design)
  if (a.totalMembers > 0) {
    if (a.totalMembers <= 2) {
      factors.push(measured("privilege_distribution", 15, 100, null, { admins: a.ownersAdmins, total: a.totalMembers }));
    } else {
      const ratio = a.ownersAdmins / a.totalMembers;
      const score = ratio <= 0.5 ? 100 : 100 - (ratio - 0.5) * 200;
      factors.push(measured("privilege_distribution", 15, score, "over_privileged", { admins: a.ownersAdmins, total: a.totalMembers }));
    }
  } else {
    factors.push(insufficient("privilege_distribution", 15, "no_members"));
  }
  // password age (only meaningful for password users)
  if (a.passwordUsers > 0) {
    const fresh = Math.max(0, a.passwordUsers - a.passwordsOverAge);
    factors.push(measured("password_age", 30, pct(fresh, a.passwordUsers), "old_passwords", { old: a.passwordsOverAge, passwordUsers: a.passwordUsers }));
  } else {
    factors.push(unavailable("password_age", 30, "no_password_users"));
  }
  // MFA + breach exposure — structurally not available yet (no fake data)
  if (!a.mfaSupported) factors.push(unavailable("mfa_coverage", 0, "mfa_not_available"));
  if (!a.breachDataAvailable) factors.push(unavailable("breach_exposure", 0, "breach_data_not_available"));
  return combineDimension(SecurityDimensionKey.Access, factors);
}

// stale ratio can exceed active only if inputs are inconsistent; clamp keeps it sane
function pctRaw(part: number, whole: number): number {
  return whole <= 0 ? 0 : clamp((part / whole) * 100);
}

function buildConnector(c: SecurityScoreInput["connector"]): SecurityScoreDimensionResult {
  const factors: SecurityScoreFactor[] = [];
  if (c.totalAccounts === 0) {
    // Nothing connected → the whole dimension is insufficient (NOT zero).
    factors.push(insufficient("token_health", 30, "no_connected_accounts"));
    factors.push(insufficient("connection_health", 25, "no_connected_accounts"));
    factors.push(insufficient("account_status", 25, "no_connected_accounts"));
    factors.push(insufficient("monitoring_enabled", 20, "no_connected_accounts"));
    return combineDimension(SecurityDimensionKey.Connector, factors);
  }
  const tokenScore = 100 - pctRaw(c.tokenProblem, c.totalAccounts) - 0.3 * pctRaw(c.tokenExpiringSoon, c.totalAccounts);
  factors.push(measured("token_health", 30, tokenScore, "token_problems", { problem: c.tokenProblem, expiringSoon: c.tokenExpiringSoon, total: c.totalAccounts }));
  factors.push(measured("connection_health", 25, pct(c.healthyConnections, c.totalAccounts), "unhealthy_connections", { unhealthy: c.totalAccounts - c.healthyConnections, total: c.totalAccounts }));
  factors.push(measured("account_status", 25, pct(c.activeAccounts, c.totalAccounts), "inactive_accounts", { inactive: c.totalAccounts - c.activeAccounts, total: c.totalAccounts }));
  factors.push(measured("monitoring_enabled", 20, pct(c.monitoringOn, c.totalAccounts), "monitoring_off", { off: c.totalAccounts - c.monitoringOn, total: c.totalAccounts }));
  if (!c.permissionBaselineAvailable) factors.push(unavailable("permission_drift", 0, "permission_baseline_not_available"));
  return combineDimension(SecurityDimensionKey.Connector, factors);
}

function buildCoverage(c: SecurityScoreInput["coverage"]): SecurityScoreDimensionResult {
  const factors: SecurityScoreFactor[] = [];
  if (c.monitoredAccounts === 0 || c.protectionScore === null) {
    factors.push(insufficient("reputation_protection", 100, "no_monitored_accounts"));
  } else {
    factors.push(measured("reputation_protection", 100, c.protectionScore, "low_protection_coverage", { protectionScore: c.protectionScore }));
  }
  return combineDimension(SecurityDimensionKey.Coverage, factors);
}

function buildResponse(r: SecurityScoreInput["response"]): SecurityScoreDimensionResult {
  const factors: SecurityScoreFactor[] = [];
  if (!r.hasActivity) {
    factors.push(insufficient("incident_response", 40, "no_activity"));
    factors.push(insufficient("approval_backlog", 30, "no_activity"));
    factors.push(insufficient("high_risk_triage", 30, "no_activity"));
    return combineDimension(SecurityDimensionKey.Response, factors);
  }
  // Zero backlog → full readiness (a good, measured state — not missing data).
  const incidentScore = r.openIncidents === 0 ? 100 : 100 - pctRaw(r.agedOpenIncidents, r.openIncidents);
  factors.push(measured("incident_response", 40, incidentScore, "stale_incidents", { aged: r.agedOpenIncidents, open: r.openIncidents }));
  const approvalScore = r.pendingApprovals === 0 ? 100 : 100 - pctRaw(r.agedPendingApprovals, r.pendingApprovals);
  factors.push(measured("approval_backlog", 30, approvalScore, "stale_approvals", { aged: r.agedPendingApprovals, pending: r.pendingApprovals }));
  const triageScore = r.highRiskItems === 0 ? 100 : 100 - pctRaw(r.agedUnresolvedHighRisk, r.highRiskItems);
  factors.push(measured("high_risk_triage", 30, triageScore, "aged_high_risk", { aged: r.agedUnresolvedHighRisk, highRisk: r.highRiskItems }));
  return combineDimension(SecurityDimensionKey.Response, factors);
}

function buildCompliance(c: SecurityScoreInput["compliance"]): SecurityScoreDimensionResult {
  const factors: SecurityScoreFactor[] = [];
  // billing / access state
  const accessScore = c.accessState === "full_access" || c.accessState === "grace_period" ? 100 : c.accessState === "restricted" ? 50 : 30;
  factors.push(measured("billing_access_health", 40, accessScore, "access_restricted", { restricted: accessScore < 100 ? 1 : 0 }));
  // audit coverage
  if (c.auditEntries > 0) {
    factors.push(measured("audit_coverage", 25, 100, null, { entries: c.auditEntries }));
  } else {
    factors.push(insufficient("audit_coverage", 25, "no_audit_activity"));
  }
  // data retention
  factors.push(measured("data_retention", 15, c.dataRetentionConfigured ? 100 : 60, c.dataRetentionConfigured ? null : "no_retention_policy", {}));
  // encryption at rest — evaluated from an explicit fact (never NODE_ENV):
  //   secure → GOOD 100 · insecure(deployed) → CRITICAL 0 · unavailable(local) → no
  //   penalty · unknown → insufficient (no penalty, never guessed).
  factors.push(buildEncryptionFactor(c.tokenEncryption));
  return combineDimension(SecurityDimensionKey.Compliance, factors);
}

/** Map the explicit {@link TokenEncryptionFact} to a compliance factor. Evidence
 *  names the config source (mode/environment/keyConfigured) — never a secret. */
function buildEncryptionFactor(enc: TokenEncryptionFact): SecurityScoreFactor {
  const evidence = { mode: enc.mode, environment: enc.environment, keyConfigured: enc.keyConfigured };
  switch (enc.state) {
    case "secure":
      return measured("token_encryption", 20, 100, null, evidence);
    case "insecure": {
      const f = measured("token_encryption", 20, 0, "encryption_plaintext_deployed", evidence);
      f.severity = "critical";
      return f;
    }
    case "unavailable":
      return unavailable("token_encryption", 20, "encryption_local_dev", evidence);
    case "unknown":
    default:
      return insufficient("token_encryption", 20, "encryption_unknown", evidence);
  }
}

// --- Public API ------------------------------------------------------------

/**
 * Compute the composite Security Score. Deterministic and side-effect free.
 * Callers derive the ProtectionScore for the coverage input with
 * {@link computeProtectionScore} (re-exported here for convenience).
 */
export function computeSecurityScore(input: SecurityScoreInput): SecurityScoreResult {
  const dimensions = [
    buildAccess(input.access),
    buildConnector(input.connector),
    buildCoverage(input.coverage),
    buildResponse(input.response),
    buildCompliance(input.compliance),
  ];

  const scoredDims = dimensions.filter((d) => d.status === "measured" && d.score !== null);
  const dimensionsTotal = dimensions.length;
  const dimensionsMeasured = scoredDims.length;
  const enoughCoverage = dimensionsMeasured >= MIN_MEASURED_DIMENSIONS;
  const weightsRenormalized = enoughCoverage && dimensionsMeasured < dimensionsTotal;

  let score: number | null = null;
  if (enoughCoverage) {
    const wsum = scoredDims.reduce((s, d) => s + d.weight, 0);
    score = clamp(scoredDims.reduce((s, d) => s + (d.score as number) * d.weight, 0) / (wsum || 1));
  }

  const confidence: "high" | "medium" | "low" = dimensionsMeasured >= 4 ? "high" : dimensionsMeasured >= 2 ? "medium" : "low";

  return {
    version: SECURITY_SCORE_VERSION,
    score,
    level: levelFor(score),
    status: score === null ? "insufficient_data" : "measured",
    dimensions,
    coverage: { dimensionsMeasured, dimensionsTotal, confidence },
    weightsRenormalized,
  };
}
