/**
 * Composite Security Score — boundary-state unit tests. Pure, no DB/network.
 * Run: pnpm security-score:test
 */
import {
  computeSecurityScore,
  levelFor,
  DIMENSION_WEIGHTS,
  SecurityDimensionKey,
  type SecurityScoreInput,
  type SecurityScoreResult,
} from "../src/security-score";

let pass = 0,
  fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

/** A totally-empty tenant: no members, no accounts, no activity, no audit. */
const EMPTY: SecurityScoreInput = {
  access: { totalMembers: 0, verifiedMembers: 0, ownersAdmins: 0, passwordUsers: 0, passwordsOverAge: 0, activeSessions: 0, staleSessions: 0, mfaSupported: false, breachDataAvailable: false },
  connector: { totalAccounts: 0, activeAccounts: 0, healthyConnections: 0, tokenOk: 0, tokenProblem: 0, tokenExpiringSoon: 0, monitoringOn: 0, permissionBaselineAvailable: false },
  coverage: { monitoredAccounts: 0, protectionScore: null },
  response: { hasActivity: false, openIncidents: 0, agedOpenIncidents: 0, pendingApprovals: 0, agedPendingApprovals: 0, highRiskItems: 0, agedUnresolvedHighRisk: 0 },
  compliance: { accessState: "full_access", auditEntries: 0, dataRetentionConfigured: true, tokenEncryption: { state: "unavailable", mode: "plaintext", keyConfigured: false, environment: "local" } },
};

/** A healthy, fully-populated tenant. */
const HEALTHY: SecurityScoreInput = {
  access: { totalMembers: 3, verifiedMembers: 3, ownersAdmins: 1, passwordUsers: 2, passwordsOverAge: 0, activeSessions: 3, staleSessions: 0, mfaSupported: false, breachDataAvailable: false },
  connector: { totalAccounts: 2, activeAccounts: 2, healthyConnections: 2, tokenOk: 2, tokenProblem: 0, tokenExpiringSoon: 0, monitoringOn: 2, permissionBaselineAvailable: false },
  coverage: { monitoredAccounts: 2, protectionScore: 90 },
  response: { hasActivity: true, openIncidents: 0, agedOpenIncidents: 0, pendingApprovals: 0, agedPendingApprovals: 0, highRiskItems: 0, agedUnresolvedHighRisk: 0 },
  compliance: { accessState: "full_access", auditEntries: 40, dataRetentionConfigured: true, tokenEncryption: { state: "secure", mode: "aes-gcm", keyConfigured: true, environment: "deployed" } },
};

const dim = (r: SecurityScoreResult, k: SecurityDimensionKey) => r.dimensions.find((d) => d.key === k)!;
const factor = (r: SecurityScoreResult, k: SecurityDimensionKey, fk: string) => dim(r, k).factors.find((f) => f.key === fk)!;

// 1) Empty tenant → NOT worst score. Missing data is insufficient, not zero.
{
  const r = computeSecurityScore(EMPTY);
  check("empty tenant → overall status insufficient_data", r.status === "insufficient_data");
  check("empty tenant → overall score is NULL (not 0)", r.score === null);
  check("empty connector dimension is insufficient_data (not 0)", dim(r, SecurityDimensionKey.Connector).status === "insufficient_data" && dim(r, SecurityDimensionKey.Connector).score === null);
  check("empty coverage dimension insufficient (not 0)", dim(r, SecurityDimensionKey.Coverage).score === null);
  check("empty response dimension insufficient (not 0)", dim(r, SecurityDimensionKey.Response).score === null);
  // Compliance stays measurable from real facts (access state + retention), so an
  // empty tenant has exactly 1 measured dimension — below MIN, hence insufficient overall.
  check("empty tenant → low confidence, 1 measured dim (compliance), below MIN → insufficient", r.coverage.confidence === "low" && r.coverage.dimensionsMeasured === 1);
}

// 2) Healthy tenant → high score, high confidence (compliance measurable via encryption).
{
  const r = computeSecurityScore(HEALTHY);
  check("healthy tenant → measured", r.status === "measured" && r.score !== null);
  check("healthy tenant score ≥ 90", (r.score ?? 0) >= 90, `score=${r.score}`);
  check("healthy tenant level strong", r.level === "strong");
  check("healthy: all 5 dimensions measured → high confidence", r.coverage.dimensionsMeasured === 5 && r.coverage.confidence === "high");
  check("healthy: no weight renormalization needed", r.weightsRenormalized === false);
  check("MFA factor is unavailable (no fake data)", factor(r, SecurityDimensionKey.Access, "mfa_coverage").status === "unavailable");
  check("breach factor is unavailable", factor(r, SecurityDimensionKey.Access, "breach_exposure").status === "unavailable");
  check("permission drift is unavailable", factor(r, SecurityDimensionKey.Connector, "permission_drift").status === "unavailable");
}

// 3) Partial data → weights renormalized over measured dimensions only.
{
  // members + accounts but no activity, no audit, dev (encryption unavailable)
  const input: SecurityScoreInput = {
    ...EMPTY,
    access: { ...EMPTY.access, totalMembers: 1, verifiedMembers: 1, activeSessions: 1 },
    connector: { totalAccounts: 1, activeAccounts: 1, healthyConnections: 1, tokenOk: 1, tokenProblem: 0, tokenExpiringSoon: 0, monitoringOn: 1, permissionBaselineAvailable: false },
    coverage: { monitoredAccounts: 1, protectionScore: 40 },
    compliance: { accessState: "full_access", auditEntries: 0, dataRetentionConfigured: true, tokenEncryption: { state: "unavailable", mode: "plaintext", keyConfigured: false, environment: "local" } },
  };
  const r = computeSecurityScore(input);
  check("partial: response is insufficient (no activity)", dim(r, SecurityDimensionKey.Response).status === "insufficient_data");
  check("partial: weightsRenormalized true", r.weightsRenormalized === true);
  check("partial: overall is a real number, not null", typeof r.score === "number");
  check("partial: fewer than 5 dims measured", r.coverage.dimensionsMeasured < 5 && r.coverage.dimensionsMeasured >= 1);
}

// 4) Every measured factor that lost points carries an issueCode + evidence; clean factors don't.
{
  const input: SecurityScoreInput = {
    ...HEALTHY,
    access: { ...HEALTHY.access, verifiedMembers: 1, totalMembers: 3, staleSessions: 2, activeSessions: 3, passwordsOverAge: 1, passwordUsers: 2 },
    connector: { totalAccounts: 4, activeAccounts: 3, healthyConnections: 2, tokenOk: 2, tokenProblem: 1, tokenExpiringSoon: 1, monitoringOn: 3, permissionBaselineAvailable: false },
  };
  const r = computeSecurityScore(input);
  const ev = factor(r, SecurityDimensionKey.Access, "email_verification");
  check("deduction has issueCode", ev.issueCode === "unverified_members");
  check("deduction has evidence numbers", ev.evidence.unverified === 2 && ev.evidence.total === 3);
  check("deducted factor score < 100", (ev.score ?? 100) < 100);
  const clean = factor(r, SecurityDimensionKey.Compliance, "billing_access_health");
  check("clean full-score factor has null issueCode", clean.score === 100 && clean.issueCode === null);
  check("token_health deduction reflects problems", (factor(r, SecurityDimensionKey.Connector, "token_health").score ?? 100) < 100);
}

// 5) Response readiness: zero backlog with activity → 100 (good, not missing).
{
  const input: SecurityScoreInput = { ...HEALTHY, response: { hasActivity: true, openIncidents: 0, agedOpenIncidents: 0, pendingApprovals: 0, agedPendingApprovals: 0, highRiskItems: 0, agedUnresolvedHighRisk: 0 } };
  const r = computeSecurityScore(input);
  check("response: activity + zero backlog → dimension score 100", dim(r, SecurityDimensionKey.Response).score === 100);
}
// 5b) Response with aged backlog deducts.
{
  const input: SecurityScoreInput = { ...HEALTHY, response: { hasActivity: true, openIncidents: 2, agedOpenIncidents: 2, pendingApprovals: 4, agedPendingApprovals: 2, highRiskItems: 5, agedUnresolvedHighRisk: 5 } };
  const r = computeSecurityScore(input);
  check("response: heavy aged backlog → dimension weak", (dim(r, SecurityDimensionKey.Response).score ?? 100) < 50);
}

// 6) Determinism: same input → identical output.
{
  const a = JSON.stringify(computeSecurityScore(HEALTHY));
  const b = JSON.stringify(computeSecurityScore(HEALTHY));
  check("deterministic: identical output for identical input", a === b);
}

// 7) Weight sanity.
{
  const total = Object.values(DIMENSION_WEIGHTS).reduce((s, w) => s + w, 0);
  check("dimension weights sum to 100", total === 100, `sum=${total}`);
  check("levelFor thresholds", levelFor(80) === "strong" && levelFor(50) === "fair" && levelFor(49) === "weak" && levelFor(null) === null);
  check("score clamped 0..100", (computeSecurityScore(HEALTHY).score ?? 0) <= 100);
}

// 8) Restricted access lowers compliance without nuking it to 0.
{
  const input: SecurityScoreInput = { ...HEALTHY, compliance: { ...HEALTHY.compliance, accessState: "restricted" } };
  const r = computeSecurityScore(input);
  const c = factor(r, SecurityDimensionKey.Compliance, "billing_access_health");
  check("restricted access → billing factor 50 (not 0)", c.score === 50 && c.issueCode === "access_restricted");
}

// 9) All-OAuth workspace → password_age unavailable (not penalized).
{
  const input: SecurityScoreInput = { ...HEALTHY, access: { ...HEALTHY.access, passwordUsers: 0, passwordsOverAge: 0 } };
  const r = computeSecurityScore(input);
  check("no password users → password_age unavailable", factor(r, SecurityDimensionKey.Access, "password_age").status === "unavailable");
  check("access dimension still measured via other factors", dim(r, SecurityDimensionKey.Access).status === "measured");
}

// 10) Token-encryption factor — engine maps each explicit fact correctly.
const encInput = (fact: SecurityScoreInput["compliance"]["tokenEncryption"]): SecurityScoreInput => ({ ...HEALTHY, compliance: { ...HEALTHY.compliance, tokenEncryption: fact } });
{
  // secure → measured GOOD 100, no severity
  const f = factor(computeSecurityScore(encInput({ state: "secure", mode: "aes-gcm", keyConfigured: true, environment: "deployed" })), SecurityDimensionKey.Compliance, "token_encryption");
  check("encryption secure → measured 100 (GOOD)", f.status === "measured" && f.score === 100 && f.severity === undefined);
}
{
  // insecure (plaintext in a deployed env) → measured CRITICAL, score 0
  const f = factor(computeSecurityScore(encInput({ state: "insecure", mode: "plaintext", keyConfigured: false, environment: "deployed" })), SecurityDimensionKey.Compliance, "token_encryption");
  check("encryption insecure (deployed) → measured 0 + severity critical", f.status === "measured" && f.score === 0 && f.severity === "critical" && f.issueCode === "encryption_plaintext_deployed");
}
{
  // local/dev plaintext → unavailable, no penalty (dimension still measured via others)
  const r = computeSecurityScore(encInput({ state: "unavailable", mode: "plaintext", keyConfigured: false, environment: "local" }));
  const f = factor(r, SecurityDimensionKey.Compliance, "token_encryption");
  check("encryption local/dev → unavailable, no score", f.status === "unavailable" && f.score === null);
  const withPenalty = computeSecurityScore(encInput({ state: "insecure", mode: "plaintext", keyConfigured: false, environment: "deployed" }));
  check("local/dev does NOT penalize (compliance higher than deployed-insecure)", (dim(r, SecurityDimensionKey.Compliance).score ?? 0) > (dim(withPenalty, SecurityDimensionKey.Compliance).score ?? 0));
}
{
  // unknown → insufficient_data, no penalty
  const f = factor(computeSecurityScore(encInput({ state: "unknown", mode: "unknown", keyConfigured: false, environment: "unknown" })), SecurityDimensionKey.Compliance, "token_encryption");
  check("encryption unknown → insufficient_data, no score", f.status === "insufficient_data" && f.score === null);
}
{
  // Evidence names the config source but never a secret/key value.
  const f = factor(computeSecurityScore(encInput({ state: "insecure", mode: "plaintext", keyConfigured: false, environment: "deployed" })), SecurityDimensionKey.Compliance, "token_encryption");
  const ev = JSON.stringify(f.evidence).toLowerCase();
  check("encryption evidence names source (mode/environment/keyConfigured)", "mode" in f.evidence && "environment" in f.evidence && "keyConfigured" in f.evidence);
  check("encryption evidence contains NO secret/key material", !ev.includes("token_encryption_key") && !ev.includes("secret") && !ev.includes("aesgcm:") && f.evidence.keyConfigured === false);
}
{
  // deterministic for the encryption path too
  const a = JSON.stringify(computeSecurityScore(encInput({ state: "insecure", mode: "plaintext", keyConfigured: false, environment: "deployed" })));
  const b = JSON.stringify(computeSecurityScore(encInput({ state: "insecure", mode: "plaintext", keyConfigured: false, environment: "deployed" })));
  check("encryption path deterministic", a === b);
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — composite security score: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
