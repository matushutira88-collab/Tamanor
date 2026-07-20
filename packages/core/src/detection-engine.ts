/**
 * S2 — Account-Takeover Detection Engine (FOUNDATION).
 *
 * A deterministic, auditable, tenant-scoped pipeline that turns a snapshot of owned, observable
 * `TenantSecurityFacts` into `DetectionCandidate`s. It is:
 *   - deterministic — same facts ⇒ byte-identical candidates (stable order + stable dedupe key);
 *   - explainable — every candidate carries structured `evidence` + a `source`;
 *   - AI-free / heuristic-free / geo-free — NO IP, NO geolocation, NO impossible travel, NO scoring model.
 *
 * FOUNDATION ONLY: no detectors are wired yet (`ATO_DETECTORS` is empty), so `runDetectionEngine` returns
 * `[]` in production — "nič automaticky negeneruje". Individual signal detectors attach to `ATO_DETECTORS`
 * (additively) in later phases; the dedupe + ordering + serialization contract below is what they plug into.
 */
import { RiskLevel } from "./reputation";
import {
  SecurityDetectionKind,
  SecurityDetectionSubjectType,
  SecurityDetectionStatus,
  IncidentCategory,
  isAtoDetectionKind,
  canTransitionDetection,
  TERMINAL_DETECTION_STATUSES,
} from "./security";

/** Where a detection signal originated — recorded on every candidate for auditability (the `source`). */
export enum DetectionSource {
  /** Owned auth events: sign-in, password change, session lifecycle. */
  Auth = "auth",
  /** Owned session state: device summary, concurrent/rotated sessions. */
  Session = "session",
  /** Connected-account connector state: token revoked/expired, permission drift (official API only). */
  Connector = "connector",
  /** Tamanor-side action outcomes: repeated failed moderation/queue actions. */
  Action = "action",
  /** A human explicitly raised a flag. */
  Manual = "manual",
}

/** 0..100 integer confidence — NOT a probability model; a deterministic, documented strength of evidence. */
export type Confidence = number;

/** A single, structured, PII-minimal evidence entry. Never a token, secret, IP, or geolocation. */
export interface DetectionEvidence {
  /** Stable machine code for the observed fact, e.g. "new_device_summary", "token_status_revoked". */
  code: string;
  /** Optional bounded, non-secret detail (counts, timestamps, opaque ids) for a human reviewer. */
  detail?: Record<string, string | number | boolean>;
}

// --- INPUT: owned, tenant-scoped facts (the attach points for later detectors) ---------------------------

export interface UserSecurityFacts {
  userId: string;
  /** Distinct device summaries previously seen for this user (owned UA summary — never IP/geo). */
  knownDeviceSummaries: readonly string[];
  /** Device summaries seen in the observation window (compared against `knownDeviceSummaries`). */
  recentDeviceSummaries: readonly string[];
  /** Number of currently-active sessions (session-anomaly input). */
  activeSessionCount: number;
  /** When the password last changed, if within the window (password-changed input). */
  passwordChangedAt: Date | null;
  /** A privilege/role change observed in the window (privilege-changed input). */
  privilegeChange: { from: string; to: string; at: Date } | null;
  /** Failed Tamanor-side actions by this user in the window (multiple-failed-actions input). */
  failedActionCount: number;
}

export interface ConnectedAccountSecurityFacts {
  accountId: string;
  brandId: string | null;
  /** Connector token lifecycle state (official API signal only). */
  tokenStatus: "ok" | "expired" | "revoked" | "invalid" | "unknown";
}

export interface ManualFlagFact {
  subjectType: SecurityDetectionSubjectType;
  subjectId: string;
  raisedByUserId: string;
  note?: string;
}

/**
 * A snapshot of owned facts for one tenant. Foundation shape — the arrays are where detectors read from.
 * NO IP / geolocation / device-location, NO third-party breach data, NO derived scores.
 */
export interface TenantSecurityFacts {
  tenantId: string;
  /** When the snapshot was taken (the engine is a pure function of these facts + this clock). */
  observedAt: Date;
  users: readonly UserSecurityFacts[];
  connectedAccounts: readonly ConnectedAccountSecurityFacts[];
  manualFlags: readonly ManualFlagFact[];
}

// --- OUTPUT: detection candidates (pre-persistence) ------------------------------------------------------

/**
 * A detector's / the engine's output BEFORE persistence. `id`, `createdAt` and `status` are assigned only
 * when persisted (id = cuid, createdAt = now, status = `open`). `dedupeKey` makes duplicate suppression
 * deterministic within a run AND across re-runs (idempotent detections).
 */
export interface DetectionCandidate {
  subjectType: SecurityDetectionSubjectType;
  subjectId: string;
  brandId: string | null;
  /** Must be an ATO kind (`isAtoDetectionKind`); non-ATO candidates are dropped fail-closed. */
  kind: SecurityDetectionKind;
  severity: RiskLevel;
  confidence: Confidence;
  source: DetectionSource;
  evidence: readonly DetectionEvidence[];
  /** Stable idempotency key: the same underlying condition ⇒ the same key ⇒ exactly one detection. */
  dedupeKey: string;
}

/** A detector is a PURE function of the fact snapshot ⇒ zero or more candidates. Deterministic. */
export type AtoDetector = (facts: TenantSecurityFacts) => DetectionCandidate[];

/**
 * The detector registry. EMPTY in S2 (foundation) — the pipeline exists but emits nothing on its own, per
 * spec. Detectors are appended here (additively) in later phases.
 */
export const ATO_DETECTORS: readonly AtoDetector[] = [];

const SEVERITY_RANK: Record<RiskLevel, number> = {
  [RiskLevel.Critical]: 4, [RiskLevel.High]: 3, [RiskLevel.Medium]: 2, [RiskLevel.Low]: 1, [RiskLevel.None]: 0,
};

/** Suppress duplicates by `dedupeKey`, keeping the FIRST occurrence (stable). */
export function dedupeCandidates(candidates: readonly DetectionCandidate[]): DetectionCandidate[] {
  const seen = new Set<string>();
  const out: DetectionCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.dedupeKey)) continue;
    seen.add(c.dedupeKey);
    out.push(c);
  }
  return out;
}

/**
 * Deterministic total order: severity desc, then kind, then subjectId, then dedupeKey — so the same set
 * always serializes identically regardless of the order detectors ran in.
 */
export function orderCandidates(candidates: readonly DetectionCandidate[]): DetectionCandidate[] {
  return [...candidates].sort((a, b) =>
    (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) ||
    a.kind.localeCompare(b.kind) ||
    a.subjectId.localeCompare(b.subjectId) ||
    a.dedupeKey.localeCompare(b.dedupeKey));
}

/**
 * Run the engine: every detector, collected → deduped → ordered. `detectors` is injectable for tests;
 * production uses the (empty) `ATO_DETECTORS`. A candidate carrying a non-ATO kind (a detector bug) is
 * dropped fail-closed rather than persisted into the wrong module.
 */
export function runDetectionEngine(
  facts: TenantSecurityFacts,
  detectors: readonly AtoDetector[] = ATO_DETECTORS,
): DetectionCandidate[] {
  const raw: DetectionCandidate[] = [];
  for (const detect of detectors) {
    for (const c of detect(facts)) {
      if (isAtoDetectionKind(c.kind)) raw.push(c);
    }
  }
  return orderCandidates(dedupeCandidates(raw));
}

/** Stable, key-ordered JSON serialization of a candidate (auditable + deterministic for tests). */
export function serializeDetectionCandidate(c: DetectionCandidate): string {
  return JSON.stringify({
    brandId: c.brandId,
    confidence: c.confidence,
    dedupeKey: c.dedupeKey,
    evidence: c.evidence.map((e) => ({ code: e.code, detail: e.detail ?? null })),
    kind: c.kind,
    severity: c.severity,
    source: c.source,
    subjectId: c.subjectId,
    subjectType: c.subjectType,
  });
}

// --- Incident preparation (foundation only — Incident Center ships in S3) --------------------------------

/**
 * Detection → Incident → Recommendation → Resolution is the FUTURE chain. S2 only fixes the mapping so a
 * detection is incident-ready: every ATO detection maps to the AccountTakeover incident category. NO
 * incident is created here — Incident Center is out of scope for S2.
 */
export function mapDetectionKindToIncidentCategory(kind: SecurityDetectionKind): IncidentCategory {
  return isAtoDetectionKind(kind) ? IncidentCategory.AccountTakeover : IncidentCategory.Reputation;
}

export interface IncidentReadiness {
  incidentCategory: IncidentCategory;
  /** True once a detection is human acknowledged/confirmed and thus eligible to open an incident (S3). */
  eligibleForIncident: boolean;
}

// --- Dedupe key, confidence, evidence sanitization -------------------------------------------------------

/**
 * Build the STABLE deduplication key for a detection: the same underlying condition ⇒ the same key. Tenant
 * is NOT part of the key (the DB uniqueness is on `(tenantId, dedupeKey)`), so a key is tenant-relative.
 * `scope` distinguishes independent instances of one kind (e.g. a device summary hash) — omit for a
 * subject-wide condition (password changed, privilege changed, manual flag).
 */
export function detectionDedupeKey(input: { kind: SecurityDetectionKind; subjectType: SecurityDetectionSubjectType; subjectId: string; scope?: string }): string {
  return [input.kind, input.subjectType, input.subjectId, input.scope ?? ""].join("|");
}

/** Clamp to a deterministic 0..100 integer confidence. Non-finite ⇒ 0 (fail-closed). */
export function normalizeConfidence(n: number): Confidence {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Evidence hardening: keys whose NAME suggests a secret are dropped entirely; string values that look like
// a token/secret (very long, or a JWT-like dotted base64) are dropped; everything is bounded.
const FORBIDDEN_EVIDENCE_KEY = /(token|secret|password|passwd|api[_-]?key|encryption|authorization|auth[_-]?header|cookie|session[_-]?id|bearer|credential|private[_-]?key|access[_-]?key|refresh)/i;
const TOKENISH_VALUE = /^(?:[A-Za-z0-9_-]{40,}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const MAX_EVIDENCE_ENTRIES = 20;
const MAX_DETAIL_KEYS = 20;
const MAX_STRING_LEN = 200;
const MAX_CODE_LEN = 80;

function sanitizeDetail(detail: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, v] of Object.entries(detail)) {
    if (n >= MAX_DETAIL_KEYS) break;
    if (FORBIDDEN_EVIDENCE_KEY.test(k)) continue; // drop sensitive-named keys
    if (typeof v === "string") {
      if (v.length > MAX_STRING_LEN || TOKENISH_VALUE.test(v)) continue; // drop token-like / oversized strings
      out[k] = v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
    n++;
  }
  return out;
}

/**
 * Sanitize structured evidence before it is ever persisted. Deterministic. Guarantees no secret/token/PII
 * key survives and every value is bounded. NEVER trusts a detector to have sanitized already.
 */
export function sanitizeDetectionEvidence(evidence: readonly DetectionEvidence[]): DetectionEvidence[] {
  return evidence.slice(0, MAX_EVIDENCE_ENTRIES).map((e) => {
    const detail = e.detail ? sanitizeDetail(e.detail) : undefined;
    const clean: DetectionEvidence = { code: String(e.code).slice(0, MAX_CODE_LEN) };
    if (detail && Object.keys(detail).length > 0) clean.detail = detail;
    return clean;
  });
}

/**
 * Build a deterministic candidate for a HUMAN manual flag — the one detection an operator raises directly
 * (security:manage). No IP/geo/AI. Evidence is sanitized; the note is bounded and sanitized like any other
 * value. Same subject ⇒ same dedupeKey ⇒ the repeat increments occurrenceCount rather than duplicating.
 */
export function buildManualFlagCandidate(flag: ManualFlagFact, opts: { severity?: RiskLevel; confidence?: number } = {}): DetectionCandidate {
  const rawDetail: Record<string, string | number | boolean> = { raisedByUserId: flag.raisedByUserId };
  if (flag.note) rawDetail.note = flag.note;
  return {
    subjectType: flag.subjectType,
    subjectId: flag.subjectId,
    brandId: null,
    kind: SecurityDetectionKind.ManualFlag,
    severity: opts.severity ?? RiskLevel.Medium,
    confidence: normalizeConfidence(opts.confidence ?? 60),
    source: DetectionSource.Manual,
    evidence: sanitizeDetectionEvidence([{ code: "manual_flag", detail: rawDetail }]),
    dedupeKey: detectionDedupeKey({ kind: SecurityDetectionKind.ManualFlag, subjectType: flag.subjectType, subjectId: flag.subjectId }),
  };
}

// --- Lifecycle transition (domain-validated) ------------------------------------------------------------

export type DetectionTransitionError = "illegal_transition" | "terminal" | "no_change";

export interface DetectionTransitionResult {
  ok: boolean;
  from: SecurityDetectionStatus;
  to: SecurityDetectionStatus;
  error?: DetectionTransitionError;
}

/**
 * Validate a lifecycle transition against the deterministic state machine. Identity (from == to) is not a
 * move; a transition out of a terminal state is `terminal`; anything else illegal is `illegal_transition`.
 */
export function applyTransition(from: SecurityDetectionStatus, to: SecurityDetectionStatus): DetectionTransitionResult {
  if (from === to) return { ok: false, from, to, error: "no_change" };
  if (canTransitionDetection(from, to)) return { ok: true, from, to };
  const error: DetectionTransitionError = TERMINAL_DETECTION_STATUSES.includes(from) ? "terminal" : "illegal_transition";
  return { ok: false, from, to, error };
}

// --- Persistence outcome (reported by the repo's dedup-aware ingest) ------------------------------------

export type DetectionDeduplicationResult =
  | { outcome: "created"; id: string; occurrenceCount: 1 }
  | { outcome: "merged"; id: string; occurrenceCount: number };
