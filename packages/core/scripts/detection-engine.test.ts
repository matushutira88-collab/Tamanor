/**
 * S2 — Account-Takeover Detection Engine (foundation) unit tests. PURE: no DB, no network, no clock deps.
 * Covers: enum coverage, deterministic ordering, duplicate suppression, serialization, the status state
 * machine (legal/illegal transitions + S2 mapping), the empty-registry foundation invariant, and the
 * incident-readiness mapping.
 * Run: pnpm detection-engine:test
 */
import {
  SecurityDetectionKind, SecurityDetectionStatus, SecurityDetectionSubjectType, IncidentCategory, RiskLevel,
  ALL_SECURITY_DETECTION_KINDS, ATO_DETECTION_KINDS, ATO_DETECTION_TYPE, isAtoDetectionKind,
  canTransitionDetection, DETECTION_STATUS_TRANSITIONS, TERMINAL_DETECTION_STATUSES, S2_DETECTION_STATUS,
  DetectionSource, dedupeCandidates, orderCandidates, runDetectionEngine, serializeDetectionCandidate,
  mapDetectionKindToIncidentCategory, ATO_DETECTORS,
  detectionDedupeKey, normalizeConfidence, sanitizeDetectionEvidence, applyTransition, buildManualFlagCandidate,
  type DetectionCandidate, type TenantSecurityFacts,
} from "../src/index";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
};

const cand = (over: Partial<DetectionCandidate> = {}): DetectionCandidate => ({
  subjectType: SecurityDetectionSubjectType.User, subjectId: "u1", brandId: null,
  kind: SecurityDetectionKind.NewDevice, severity: RiskLevel.Low, confidence: 50,
  source: DetectionSource.Session, evidence: [{ code: "new_device_summary" }], dedupeKey: "k1", ...over,
});
const facts = (): TenantSecurityFacts => ({ tenantId: "t1", observedAt: new Date(0), users: [], connectedAccounts: [], manualFlags: [] });

function run() {
  // --- enum coverage ------------------------------------------------------------------------------
  check("ATO set has exactly the 8 spec types", ATO_DETECTION_KINDS.length === 8);
  check("every ATO kind is a valid SecurityDetectionKind", ATO_DETECTION_KINDS.every((k) => ALL_SECURITY_DETECTION_KINDS.includes(k)));
  check("ATO_DETECTION_TYPE maps all 8 spec names → a kind", Object.keys(ATO_DETECTION_TYPE).length === 8 && Object.values(ATO_DETECTION_TYPE).every((k) => isAtoDetectionKind(k)));
  check("the 8 spec names are exactly UNKNOWN_DEVICE…MANUAL_FLAG", ["UNKNOWN_DEVICE","SESSION_ANOMALY","PASSWORD_CHANGED","PRIVILEGE_CHANGED","TOKEN_REVOKED","TOKEN_EXPIRED","MULTIPLE_FAILED_ACTIONS","MANUAL_FLAG"].every((n) => n in ATO_DETECTION_TYPE));
  check("isAtoDetectionKind: true for ATO, false for brand-abuse", isAtoDetectionKind(SecurityDetectionKind.TokenRevoked) && !isAtoDetectionKind(SecurityDetectionKind.Impersonation) && !isAtoDetectionKind(SecurityDetectionKind.HandleSquat));
  check("no duplicate values in the full kind enum", new Set(ALL_SECURITY_DETECTION_KINDS).size === ALL_SECURITY_DETECTION_KINDS.length);

  // --- deterministic ordering ---------------------------------------------------------------------
  const unordered = [
    cand({ dedupeKey: "b", severity: RiskLevel.Low, kind: SecurityDetectionKind.SessionAnomaly, subjectId: "u2" }),
    cand({ dedupeKey: "a", severity: RiskLevel.Critical, kind: SecurityDetectionKind.TokenRevoked, subjectId: "u1" }),
    cand({ dedupeKey: "c", severity: RiskLevel.Critical, kind: SecurityDetectionKind.NewDevice, subjectId: "u1" }),
  ];
  const ordered = orderCandidates(unordered);
  check("ordering: severity desc first", ordered[0]!.severity === RiskLevel.Critical && ordered[2]!.severity === RiskLevel.Low);
  check("ordering: stable tiebreak by kind then subjectId (critical: new_device before token_revoked)", ordered[0]!.kind === SecurityDetectionKind.NewDevice && ordered[1]!.kind === SecurityDetectionKind.TokenRevoked);
  check("ordering is total + deterministic (same input → identical order twice)", JSON.stringify(orderCandidates(unordered)) === JSON.stringify(orderCandidates([...unordered].reverse())));

  // --- duplicate suppression ----------------------------------------------------------------------
  const dupes = [cand({ dedupeKey: "same", confidence: 90 }), cand({ dedupeKey: "same", confidence: 10 }), cand({ dedupeKey: "other" })];
  const deduped = dedupeCandidates(dupes);
  check("dedupe by dedupeKey, keeps FIRST occurrence", deduped.length === 2 && deduped[0]!.confidence === 90);

  // --- serialization ------------------------------------------------------------------------------
  check("serialization is deterministic (same candidate → same string)", serializeDetectionCandidate(cand()) === serializeDetectionCandidate(cand()));
  check("serialization is key-order independent (evidence detail null-normalized)", serializeDetectionCandidate(cand({ evidence: [{ code: "x" }] })) === serializeDetectionCandidate(cand({ evidence: [{ code: "x", detail: undefined }] })));
  check("serialization carries no token/secret/ip fields", !/token|secret|password|\bip\b|geo/i.test(serializeDetectionCandidate(cand())));

  // --- status state machine -----------------------------------------------------------------------
  const St = SecurityDetectionStatus;
  check("legal: open→acknowledged, open→resolved, open→dismissed", canTransitionDetection(St.Open, St.Acknowledged) && canTransitionDetection(St.Open, St.Resolved) && canTransitionDetection(St.Open, St.Dismissed));
  check("legal: acknowledged→resolved / dismissed / confirmed", canTransitionDetection(St.Acknowledged, St.Resolved) && canTransitionDetection(St.Acknowledged, St.Dismissed) && canTransitionDetection(St.Acknowledged, St.Confirmed));
  check("illegal: terminal states have NO outgoing transitions", DETECTION_STATUS_TRANSITIONS[St.Resolved].length === 0 && DETECTION_STATUS_TRANSITIONS[St.Dismissed].length === 0);
  check("illegal: resolved→open, dismissed→acknowledged, identity open→open rejected", !canTransitionDetection(St.Resolved, St.Open) && !canTransitionDetection(St.Dismissed, St.Acknowledged) && !canTransitionDetection(St.Open, St.Open));
  check("terminal set = {dismissed, resolved}", TERMINAL_DETECTION_STATUSES.length === 2 && TERMINAL_DETECTION_STATUSES.includes(St.Dismissed) && TERMINAL_DETECTION_STATUSES.includes(St.Resolved));
  check("S2 lifecycle maps NEW=open, ACKNOWLEDGED=acknowledged, RESOLVED=resolved, FALSE_POSITIVE=dismissed", S2_DETECTION_STATUS.NEW === St.Open && S2_DETECTION_STATUS.ACKNOWLEDGED === St.Acknowledged && S2_DETECTION_STATUS.RESOLVED === St.Resolved && S2_DETECTION_STATUS.FALSE_POSITIVE === St.Dismissed);

  // --- engine (foundation: empty registry) --------------------------------------------------------
  check("production registry ATO_DETECTORS is EMPTY (foundation: nothing auto-generates)", ATO_DETECTORS.length === 0);
  check("runDetectionEngine with the empty registry returns []", runDetectionEngine(facts()).length === 0);
  const injected = runDetectionEngine(facts(), [
    () => [cand({ dedupeKey: "x", severity: RiskLevel.Low })],
    () => [cand({ dedupeKey: "x", severity: RiskLevel.Low }), cand({ dedupeKey: "y", severity: RiskLevel.High })],
  ]);
  check("runDetectionEngine collects + dedups + orders across detectors", injected.length === 2 && injected[0]!.severity === RiskLevel.High && injected[1]!.dedupeKey === "x");
  const dropped = runDetectionEngine(facts(), [() => [cand({ kind: SecurityDetectionKind.Impersonation, dedupeKey: "brand" })]]);
  check("runDetectionEngine drops a non-ATO kind fail-closed", dropped.length === 0);

  // --- dedupe key + confidence normalization ------------------------------------------------------
  const dk = (scope?: string) => detectionDedupeKey({ kind: SecurityDetectionKind.NewDevice, subjectType: SecurityDetectionSubjectType.User, subjectId: "u1", scope });
  check("detectionDedupeKey is deterministic + scope-sensitive", dk() === dk() && dk("d1") !== dk("d2") && dk() !== dk("d1"));
  check("normalizeConfidence clamps 0..100, rounds, non-finite→0", normalizeConfidence(150) === 100 && normalizeConfidence(-5) === 0 && normalizeConfidence(49.6) === 50 && normalizeConfidence(NaN) === 0 && normalizeConfidence(Infinity) === 0);

  // --- evidence sanitization (security control: never persist a secret/token) ---------------------
  const sanitized = sanitizeDetectionEvidence([
    { code: "new_device_summary", detail: { device: "Safari on macOS", token: "eyJabc.def.ghi", api_key: "x", count: 3, ok: true } },
    { code: "x".repeat(200), detail: { blob: "A".repeat(500) } },
  ]);
  const s0 = sanitized[0]!;
  check("sanitize drops secret-named keys (token, api_key)", !("token" in (s0.detail ?? {})) && !("api_key" in (s0.detail ?? {})));
  check("sanitize keeps safe fields (device, count, ok)", s0.detail?.device === "Safari on macOS" && s0.detail?.count === 3 && s0.detail?.ok === true);
  check("sanitize bounds the code length (≤80) and drops oversized/token-like values", sanitized[1]!.code.length <= 80 && !("blob" in (sanitized[1]!.detail ?? {})));
  check("sanitized evidence serializes with NO token/secret substrings", !/eyJ|api_key|token/i.test(JSON.stringify(sanitized)));

  // --- applyTransition (domain-validated, typed errors) -------------------------------------------
  check("applyTransition: legal move ok", applyTransition(SecurityDetectionStatus.Open, SecurityDetectionStatus.Acknowledged).ok === true);
  check("applyTransition: identity → no_change", applyTransition(SecurityDetectionStatus.Open, SecurityDetectionStatus.Open).error === "no_change");
  check("applyTransition: out of terminal → terminal", applyTransition(SecurityDetectionStatus.Resolved, SecurityDetectionStatus.Open).error === "terminal");
  check("applyTransition: other illegal → illegal_transition", applyTransition(SecurityDetectionStatus.Open, "bogus" as never).error === "illegal_transition");

  // --- buildManualFlagCandidate (operator-raised detection) ---------------------------------------
  const manual = buildManualFlagCandidate({ subjectType: SecurityDetectionSubjectType.User, subjectId: "u9", raisedByUserId: "admin1", note: "looks off" });
  check("manual flag → ManualFlag kind, Manual source, ATO kind", manual.kind === SecurityDetectionKind.ManualFlag && manual.source === DetectionSource.Manual && isAtoDetectionKind(manual.kind));
  check("manual flag has a stable dedupeKey + sanitized evidence", manual.dedupeKey === detectionDedupeKey({ kind: SecurityDetectionKind.ManualFlag, subjectType: SecurityDetectionSubjectType.User, subjectId: "u9" }) && manual.evidence.length === 1);

  // --- incident readiness mapping -----------------------------------------------------------------
  check("every ATO kind maps to the AccountTakeover incident category", ATO_DETECTION_KINDS.every((k) => mapDetectionKindToIncidentCategory(k) === IncidentCategory.AccountTakeover));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — S2 detection engine foundation (unit)`);
  process.exit(failures === 0 ? 0 : 1);
}
run();
