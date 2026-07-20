/**
 * Security Suite domain model (S0 foundations).
 *
 * The Security Suite extends Tamanor from reputation moderation into
 * reputation-protection + social-account security. These enums are the single
 * source of truth for the suite's string columns in `@guardora/db`
 * (`security_score_snapshots`, `security_detections`, `brand_protection_cases`)
 * — the DB uses `String` columns whose allowed values are exactly the values
 * below (same pragmatic convention as the `Incident` model).
 *
 * INVARIANT (detection & response only): nothing in this module grants a new
 * platform-mutation capability. Detections NEVER assert a confirmed compromise —
 * they carry a RiskLevel and are phrased as "possible account takeover"; only a
 * human review moves a detection out of `open`.
 */

// --- Security Score --------------------------------------------------------

/** What a Security Score snapshot is computed over. */
export enum SecurityScoreScope {
  Tenant = "tenant",
  Brand = "brand",
  Account = "account",
}

/**
 * The composite score's weighted dimensions. Each subscore is 0..100. The
 * existing reputation ProtectionScore feeds the `coverage` dimension.
 */
export enum SecurityScoreDimension {
  /** MFA adoption, stale/over-privileged sessions, password age, breach hits. */
  Access = "access",
  /** Token freshness, minimal scopes, monitoring on, no permission drift. */
  Connector = "connector",
  /** Reputation protection coverage (auto-protect policies, platforms, rules). */
  Coverage = "coverage",
  /** Open-incident age, unresolved high/critical items, unacked detections. */
  Response = "response",
  /** Audit completeness, encryption-at-rest in prod, retention configured. */
  Compliance = "compliance",
}

export const ALL_SECURITY_SCORE_DIMENSIONS: readonly SecurityScoreDimension[] =
  Object.values(SecurityScoreDimension);

// --- Detections (ATO + Brand Protection share one ledger) ------------------

/** Who/what a detection is about. */
export enum SecurityDetectionSubjectType {
  /** A Tamanor workspace user (data we own). */
  User = "user",
  /** A connected social account (observed via official API signals). */
  ConnectedAccount = "connected_account",
  /** A protected brand identity. */
  Brand = "brand",
}

/**
 * Detection kinds. Workspace-user ATO (S2a) and connected-account ATO (S2b)
 * signals plus brand-abuse kinds (S4). Extend additively — never renumber.
 */
export enum SecurityDetectionKind {
  // Workspace-user ATO (owned signals — no geolocation dependency in S2).
  NewDevice = "new_device",
  ImpossibleTravel = "impossible_travel", // reserved; needs an optional geo signal provider (deferred)
  CredentialStuffing = "credential_stuffing",
  MfaDisabled = "mfa_disabled",
  BreachExposure = "breach_exposure",
  PrivilegeEscalation = "privilege_escalation",
  SessionAnomaly = "session_anomaly",
  // Connected-account ATO (official API signals only).
  TokenRevoked = "token_revoked",
  PermissionDrift = "permission_drift",
  AccountNameChange = "account_name_change",
  // Brand abuse (feeds Brand Protection cases).
  Impersonation = "impersonation",
  HandleSquat = "handle_squat",
  PhishingAbuse = "phishing_abuse",
}

export const ALL_SECURITY_DETECTION_KINDS: readonly SecurityDetectionKind[] =
  Object.values(SecurityDetectionKind);

/**
 * Detection lifecycle. Detectors ONLY ever create `Open`. A human review is the
 * only path to `Confirmed`/`Dismissed`/`Resolved` — the system never asserts a
 * confirmed account takeover on its own.
 */
export enum SecurityDetectionStatus {
  Open = "open",
  Acknowledged = "acknowledged",
  Dismissed = "dismissed",
  Confirmed = "confirmed",
  Resolved = "resolved",
}

/** Terminal states (no further transitions expected). */
export const TERMINAL_DETECTION_STATUSES: readonly SecurityDetectionStatus[] = [
  SecurityDetectionStatus.Dismissed,
  SecurityDetectionStatus.Resolved,
];

// --- Brand Protection ------------------------------------------------------

export enum BrandProtectionKind {
  Impersonation = "impersonation",
  HandleSquat = "handle_squat",
  Counterfeit = "counterfeit",
  Phishing = "phishing",
  BrandAttack = "brand_attack",
}

/** How a case entered the register. No scraping — all sources are sanctioned. */
export enum BrandProtectionSource {
  /** Auto-opened from inbound content classified Scam/BrandAttack/Misinformation. */
  Detected = "detected",
  /** A team member manually reported a suspected impersonator. */
  UserReported = "user_reported",
  /** An official platform brand-rights / search endpoint (placeholder today). */
  Api = "api",
}

export enum BrandProtectionStatus {
  Open = "open",
  Investigating = "investigating",
  ReportedToPlatform = "reported_to_platform",
  Resolved = "resolved",
  Dismissed = "dismissed",
}

// --- Incident Center (S3) — extends the existing `Incident` model ----------
// Declared here so the vocabulary is fixed from S0; the additive `Incident`
// columns land in S3 (do not modify the working incidents module in S0).

export enum IncidentCategory {
  Reputation = "reputation",
  AccountTakeover = "account_takeover",
  BrandAbuse = "brand_abuse",
  CoordinatedAttack = "coordinated_attack",
  ConnectorCompromise = "connector_compromise",
  DataExposure = "data_exposure",
}

export enum IncidentLifecycleStatus {
  Open = "open",
  Investigating = "investigating",
  Contained = "contained",
  Resolved = "resolved",
  PostMortem = "post_mortem",
}

// --- Audit event names (dot-namespaced, append-only) -----------------------

export const SECURITY_AUDIT_EVENTS = {
  scoreSnapshot: "security.score.snapshot",
  detectionOpened: "security.detection.opened",
  detectionAcknowledged: "security.detection.acknowledged",
  detectionDismissed: "security.detection.dismissed",
  detectionConfirmed: "security.detection.confirmed",
  detectionResolved: "security.detection.resolved",
  brandCaseOpened: "brand_protection.case.opened",
  brandCaseStatusChanged: "brand_protection.case.status_changed",
} as const;
