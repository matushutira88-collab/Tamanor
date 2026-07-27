/**
 * Child Safety Integration Signal Protocol V1 — pure protocol vocabulary, STRICT validation, deterministic
 * canonicalization, and the partner→canonical mapping. This module is the shared contract used by BOTH the
 * server gateway (@guardora/db) and the partner SDK (@guardora/child-safety-sdk).
 *
 * PRIVACY BY CONSTRUCTION: a partner sends only a MINIMAL, content-free structured signal. This module
 * rejects anything that looks like raw communication content (message/text/transcript/media/url/etc.),
 * unknown fields, oversized envelopes, and out-of-taxonomy values. It contains NO I/O, NO clock, NO
 * randomness, and NO `node:crypto` — it only BUILDS the deterministic strings that the server/SDK hash and
 * sign (crypto stays on the server-only boundary). Tamanor never receives raw content, credentials, tokens,
 * device data, or private keys.
 */
import { Role } from "./tenant";
import { Permission, can } from "./permissions";

// ── Protocol identity + bounds ────────────────────────────────────────────────
export const CHILD_SAFETY_SIGNAL_PROTOCOL = "tamanor-child-safety-signal";
export const CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION = "1.0";
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = ["1.0"];
export const isSupportedProtocolVersion = (v: unknown): v is string => typeof v === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(v);

export const INTEGRATION_LIMITS = {
  maxEnvelopeBytes: 32 * 1024,
  clockSkewMs: 5 * 60 * 1000, // ±5 minutes
  maxIdLen: 128,
  maxNonceLen: 128,
  maxOpaqueLen: 128,
  maxCount: 100_000,
} as const;

// ── Permissions (partner API auth is separate from these user-session capabilities) ──
export const canViewChildSafetyIntegration = (r: Role): boolean => can(r, Permission.ChildSafetyIntegrationView);
export const canManageChildSafetyIntegration = (r: Role): boolean => can(r, Permission.ChildSafetyIntegrationManage);
export const canManageChildSafetyIntegrationKeys = (r: Role): boolean => can(r, Permission.ChildSafetyIntegrationKeysManage);
export const canViewChildSafetyIntegrationReceipts = (r: Role): boolean => can(r, Permission.ChildSafetyIntegrationReceiptsView);
export const canUseChildSafetyIntegrationSandbox = (r: Role): boolean => can(r, Permission.ChildSafetyIntegrationSandboxUse);

// ── Bounded enums ─────────────────────────────────────────────────────────────
export enum PartnerRiskType {
  Grooming = "GROOMING", SexualSolicitation = "SEXUAL_SOLICITATION", Sextortion = "SEXTORTION",
  OffPlatformMigration = "OFF_PLATFORM_MIGRATION", MeetingAttempt = "MEETING_ATTEMPT",
  Cyberbullying = "CYBERBULLYING", Threat = "THREAT", Harassment = "HARASSMENT",
  Coercion = "COERCION", Impersonation = "IMPERSONATION", SelfHarmConcern = "SELF_HARM_CONCERN",
  OtherReviewRequired = "OTHER_REVIEW_REQUIRED",
}
export const PARTNER_RISK_TYPES: readonly string[] = Object.values(PartnerRiskType);
export const PARTNER_CONFIDENCE_BANDS: readonly string[] = ["low", "medium", "high"];
export const PARTNER_SEVERITY_HINTS: readonly string[] = ["low", "medium", "high", "critical"];
export const PARTNER_URGENCY_HINTS: readonly string[] = ["routine", "elevated", "immediate"];
export const PARTNER_CLASSIFIER_TYPES: readonly string[] = ["ml_model", "rule_engine", "human_review", "hybrid"];
export const PARTNER_CLASSIFICATION_METHODS: readonly string[] = ["automated", "assisted", "manual"];
export const PARTNER_AGE_BANDS: readonly string[] = ["under_10", "age_10_12", "age_13_15", "age_16_17"];
export const INTEGRATION_ENVIRONMENTS: readonly string[] = ["sandbox", "production"];

// ── Envelope + payload types (data only) ──────────────────────────────────────
export interface MinimalSignal {
  externalSignalId: string;
  signalType: string; // PartnerRiskType
  riskFamily?: string;
  confidenceBand: string;
  severityHint?: string;
  urgencyHint?: string;
}
export interface ClassificationMeta {
  classifierType: string;
  classifierVersion: string;
  modelVersion?: string;
  ruleVersion?: string;
  classificationMethod: string;
  evaluatedAt: string; // ISO
}
export interface PseudonymousSubject {
  pseudonymousSubjectId: string; // opaque, partner-scoped
  pseudonymousActorId?: string; // opaque
  ageBand?: string;
}
export interface SignalContext {
  conversationContextId?: string; // opaque partner-scoped token
  repeatedSignalCount?: number;
  recentRelatedSignalCount?: number;
  distinctActorCount?: number;
  offPlatformMigrationFlag?: boolean;
  meetingAttemptFlag?: boolean;
  immediateDangerFlag?: boolean;
  coercionFlag?: boolean;
  threatFlag?: boolean;
  partnerAlreadyBlockedContact?: boolean;
  partnerAlreadyRestrictedAccount?: boolean;
  partnerWarningDisplayed?: boolean;
  partnerHumanReviewRequested?: boolean;
}
export interface SignalEnvelope {
  protocol: string;
  protocolVersion: string;
  eventId: string;
  idempotencyKey: string;
  partnerId: string;
  applicationId: string;
  installationId: string;
  occurredAt: string; // ISO
  sentAt: string; // ISO
  nonce: string;
  signal: MinimalSignal;
  classification: ClassificationMeta;
  subject: PseudonymousSubject;
  context?: SignalContext;
}

// ── Prohibited raw-content / PII / credential keys (defense in depth) ──────────
/** Any of these keys appearing ANYWHERE in the envelope means raw content / PII / credential leakage. */
export const PROHIBITED_FIELD_KEYS: readonly string[] = [
  "message", "messagetext", "text", "body", "content", "transcript", "conversation", "chatlog",
  "image", "images", "video", "audio", "file", "attachment", "media", "screenshot", "thumbnail",
  "url", "link", "href", "location", "latitude", "longitude", "geo", "coordinates", "address",
  "email", "phone", "phonenumber", "name", "firstname", "lastname", "fullname", "realname",
  "username", "handle", "displayname", "dob", "dateofbirth", "birthdate", "ssn", "nationalid",
  "guardian", "guardianname", "guardianemail", "guardianphone", "parent",
  "password", "passcode", "pin", "token", "accesstoken", "refreshtoken", "apikey", "secret",
  "sessioncookie", "cookie", "authorization", "credential", "privatekey", "deviceid", "imei",
  "ipaddress", "ip", "useragent", "macaddress",
];
const PROHIBITED_SET = new Set(PROHIBITED_FIELD_KEYS);

// ── Strict validation ─────────────────────────────────────────────────────────
export interface IntegrationValidationResult { valid: boolean; errors: string[]; }

const TOP_KEYS = ["protocol", "protocolVersion", "eventId", "idempotencyKey", "partnerId", "applicationId", "installationId", "occurredAt", "sentAt", "nonce", "signal", "classification", "subject", "context"];
const SIGNAL_KEYS = ["externalSignalId", "signalType", "riskFamily", "confidenceBand", "severityHint", "urgencyHint"];
const CLASSIFICATION_KEYS = ["classifierType", "classifierVersion", "modelVersion", "ruleVersion", "classificationMethod", "evaluatedAt"];
const SUBJECT_KEYS = ["pseudonymousSubjectId", "pseudonymousActorId", "ageBand"];
const CONTEXT_KEYS = ["conversationContextId", "repeatedSignalCount", "recentRelatedSignalCount", "distinctActorCount", "offPlatformMigrationFlag", "meetingAttemptFlag", "immediateDangerFlag", "coercionFlag", "threatFlag", "partnerAlreadyBlockedContact", "partnerAlreadyRestrictedAccount", "partnerWarningDisplayed", "partnerHumanReviewRequested"];
const COUNT_FIELDS = ["repeatedSignalCount", "recentRelatedSignalCount", "distinctActorCount"];
const FLAG_FIELDS = ["offPlatformMigrationFlag", "meetingAttemptFlag", "immediateDangerFlag", "coercionFlag", "threatFlag", "partnerAlreadyBlockedContact", "partnerAlreadyRestrictedAccount", "partnerWarningDisplayed", "partnerHumanReviewRequested"];

const isIso = (v: unknown): boolean => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const isOpaqueId = (v: unknown, max = INTEGRATION_LIMITS.maxIdLen): boolean => typeof v === "string" && v.length > 0 && v.length <= max && /^[A-Za-z0-9._:-]+$/.test(v);

/** Recursively assert no prohibited key appears anywhere (raw content / PII / credential guard). */
export function containsProhibitedKey(obj: unknown, depth = 0): string | null {
  if (depth > 6 || obj === null || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (PROHIBITED_SET.has(k.toLowerCase())) return k;
    const nested = containsProhibitedKey(v, depth + 1);
    if (nested) return nested;
  }
  return null;
}
function onlyKeys(obj: Record<string, unknown>, allowed: string[], label: string, err: (c: string) => void): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) err(`${label}_unknown_key:${k}`);
}

/**
 * Validate a decoded envelope object (already parsed + size-checked by the caller). STRICT: rejects unknown
 * top-level/nested keys, any prohibited raw-content/PII/credential key at any depth, out-of-taxonomy enums,
 * malformed ids/timestamps, and out-of-range counts. Never throws.
 */
export function validateSignalEnvelope(raw: unknown): IntegrationValidationResult {
  const errors: string[] = [];
  const err = (c: string) => { if (errors.length < 60) errors.push(c); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { valid: false, errors: ["not_an_object"] };
  const e = raw as Record<string, unknown>;

  const prohibited = containsProhibitedKey(e);
  if (prohibited) err(`prohibited_field:${prohibited}`); // raw content / PII / credential

  onlyKeys(e, TOP_KEYS, "envelope", err);
  if (e.protocol !== CHILD_SAFETY_SIGNAL_PROTOCOL) err("bad_protocol");
  if (!isSupportedProtocolVersion(e.protocolVersion)) err("unsupported_protocol_version");
  for (const f of ["eventId", "idempotencyKey", "partnerId", "applicationId", "installationId", "nonce"] as const) if (!isOpaqueId(e[f])) err(`bad_${f}`);
  if (!isIso(e.occurredAt)) err("bad_occurredAt");
  if (!isIso(e.sentAt)) err("bad_sentAt");

  // signal
  const s = e.signal as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object") err("missing_signal");
  else {
    onlyKeys(s, SIGNAL_KEYS, "signal", err);
    if (!isOpaqueId(s.externalSignalId)) err("bad_externalSignalId");
    if (!PARTNER_RISK_TYPES.includes(s.signalType as string)) err("bad_signalType");
    if (!PARTNER_CONFIDENCE_BANDS.includes(s.confidenceBand as string)) err("bad_confidenceBand");
    if (s.severityHint !== undefined && !PARTNER_SEVERITY_HINTS.includes(s.severityHint as string)) err("bad_severityHint");
    if (s.urgencyHint !== undefined && !PARTNER_URGENCY_HINTS.includes(s.urgencyHint as string)) err("bad_urgencyHint");
    if (s.riskFamily !== undefined && (typeof s.riskFamily !== "string" || s.riskFamily.length > 32)) err("bad_riskFamily");
  }
  // classification
  const c = e.classification as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") err("missing_classification");
  else {
    onlyKeys(c, CLASSIFICATION_KEYS, "classification", err);
    if (!PARTNER_CLASSIFIER_TYPES.includes(c.classifierType as string)) err("bad_classifierType");
    if (!PARTNER_CLASSIFICATION_METHODS.includes(c.classificationMethod as string)) err("bad_classificationMethod");
    for (const f of ["classifierVersion", "modelVersion", "ruleVersion"] as const) if (c[f] !== undefined && (typeof c[f] !== "string" || (c[f] as string).length > 64)) err(`bad_${f}`);
    if (typeof c.classifierVersion !== "string" || !c.classifierVersion) err("missing_classifierVersion");
    if (!isIso(c.evaluatedAt)) err("bad_evaluatedAt");
  }
  // subject
  const sub = e.subject as Record<string, unknown> | undefined;
  if (!sub || typeof sub !== "object") err("missing_subject");
  else {
    onlyKeys(sub, SUBJECT_KEYS, "subject", err);
    if (!isOpaqueId(sub.pseudonymousSubjectId, INTEGRATION_LIMITS.maxOpaqueLen)) err("bad_pseudonymousSubjectId");
    if (sub.pseudonymousActorId !== undefined && !isOpaqueId(sub.pseudonymousActorId, INTEGRATION_LIMITS.maxOpaqueLen)) err("bad_pseudonymousActorId");
    if (sub.ageBand !== undefined && !PARTNER_AGE_BANDS.includes(sub.ageBand as string)) err("bad_ageBand");
  }
  // context (optional)
  if (e.context !== undefined) {
    const ctx = e.context as Record<string, unknown>;
    if (typeof ctx !== "object" || ctx === null) err("bad_context");
    else {
      onlyKeys(ctx, CONTEXT_KEYS, "context", err);
      if (ctx.conversationContextId !== undefined && !isOpaqueId(ctx.conversationContextId, INTEGRATION_LIMITS.maxOpaqueLen)) err("bad_conversationContextId");
      for (const f of COUNT_FIELDS) if (ctx[f] !== undefined && (typeof ctx[f] !== "number" || !Number.isInteger(ctx[f]) || (ctx[f] as number) < 0 || (ctx[f] as number) > INTEGRATION_LIMITS.maxCount)) err(`bad_${f}`);
      for (const f of FLAG_FIELDS) if (ctx[f] !== undefined && typeof ctx[f] !== "boolean") err(`bad_${f}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// ── Deterministic canonicalization (pure; crypto happens server/SDK side) ─────
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
/** Canonical CONTENT string for the request fingerprint (stable key order; excludes volatile/signature).
 *  Two semantically-identical envelopes (any key order) produce the same fingerprint → clean idempotency. */
export function canonicalRequestContent(e: SignalEnvelope): string {
  return stableStringify({ protocolVersion: e.protocolVersion, eventId: e.eventId, signal: e.signal, classification: e.classification, subject: e.subject, context: e.context ?? null });
}

/** The EXACT canonical signing string (documented in the protocol spec). Newline-joined, order-fixed. The
 *  server and SDK build this identically; the SDK signs sha256/Ed25519 over it, the server verifies it.
 *  `bodyHashHex` binds the request body; every security-relevant field is bound so nothing can be swapped. */
export function buildSigningString(p: {
  method: string; path: string; protocolVersion: string; applicationId: string; installationId: string;
  eventId: string; idempotencyKey: string; sentAt: string; nonce: string; bodyHashHex: string;
}): string {
  return [
    "TAMANOR-CS-SIGNAL-V1",
    p.method.toUpperCase(),
    p.path,
    p.protocolVersion,
    p.applicationId,
    p.installationId,
    p.eventId,
    p.idempotencyKey,
    p.sentAt,
    p.nonce,
    p.bodyHashHex,
  ].join("\n");
}

// ── Partner → canonical mapping (allow-listed; no arbitrary spread) ───────────
/** Map a partner risk type to a canonical SafetySignal signalType, or null when it has no direct canonical
 *  type (SELF_HARM_CONCERN / OTHER_REVIEW_REQUIRED → receipt accepted for manual review, no canonical signal). */
export function mapPartnerRiskToCanonical(risk: string): string | null {
  switch (risk) {
    case PartnerRiskType.Grooming:
    case PartnerRiskType.OffPlatformMigration: return "GROOMING";
    case PartnerRiskType.SexualSolicitation: return "SEXUAL_SOLICITATION";
    case PartnerRiskType.Sextortion: return "SEXTORTION";
    case PartnerRiskType.MeetingAttempt: return "MEETING_ATTEMPT";
    case PartnerRiskType.Cyberbullying:
    case PartnerRiskType.Harassment: return "CYBERBULLYING";
    case PartnerRiskType.Threat:
    case PartnerRiskType.Coercion: return "THREAT";
    case PartnerRiskType.Impersonation: return "IDENTITY_MANIPULATION";
    default: return null; // SELF_HARM_CONCERN, OTHER_REVIEW_REQUIRED → no direct canonical type
  }
}
const CANONICAL_RISK_FAMILY: Record<string, string> = {
  GROOMING: "grooming", SEXUAL_SOLICITATION: "sexual", SEXTORTION: "sexual", MEETING_ATTEMPT: "grooming",
  CYBERBULLYING: "bullying", THREAT: "violence", IDENTITY_MANIPULATION: "identity",
};
export function canonicalRiskFamily(canonicalSignalType: string): string {
  return CANONICAL_RISK_FAMILY[canonicalSignalType] ?? "identity";
}
/** Deterministic hint→canonical severity (never a raw score). Defaults conservatively to the confidence band. */
export function mapSeverity(signal: MinimalSignal): string {
  if (signal.severityHint && PARTNER_SEVERITY_HINTS.includes(signal.severityHint)) return signal.severityHint;
  return signal.confidenceBand === "high" ? "high" : signal.confidenceBand === "medium" ? "medium" : "low";
}
export function mapUrgency(signal: MinimalSignal, ctx?: SignalContext): string {
  if (ctx?.immediateDangerFlag) return "immediate";
  if (signal.urgencyHint && PARTNER_URGENCY_HINTS.includes(signal.urgencyHint)) return signal.urgencyHint;
  return signal.confidenceBand === "high" ? "elevated" : "routine";
}

/** Extract the bounded SIGNAL_TRIAGE policy facts from an envelope (content-free). */
export function signalToPolicyFacts(e: SignalEnvelope): Record<string, unknown> {
  const canonical = mapPartnerRiskToCanonical(e.signal.signalType);
  const ctx = e.context ?? {};
  return {
    signalType: canonical ?? undefined,
    riskFamily: canonical ? canonicalRiskFamily(canonical) : undefined,
    confidenceBand: e.signal.confidenceBand,
    repeatedSignalCount: ctx.repeatedSignalCount ?? 0,
    distinctSourceCount: ctx.distinctActorCount ?? 0,
    immediateDangerFlag: Boolean(ctx.immediateDangerFlag),
    ageBand: e.subject.ageBand,
  };
}

// ── Stable error contract ─────────────────────────────────────────────────────
export const INTEGRATION_ERROR_CODES = [
  "INTEGRATION_AUTH_REQUIRED", "INTEGRATION_UNKNOWN", "INTEGRATION_SUSPENDED", "KEY_REVOKED",
  "SIGNATURE_INVALID", "TIMESTAMP_OUT_OF_WINDOW", "NONCE_REPLAYED", "IDEMPOTENCY_CONFLICT",
  "PROTOCOL_UNSUPPORTED", "PAYLOAD_INVALID", "PAYLOAD_TOO_LARGE", "CAPABILITY_DENIED",
  "RATE_LIMITED", "SIGNAL_ACCEPTED", "SIGNAL_DUPLICATE", "INTERNAL_FAIL_CLOSED",
] as const;
export type IntegrationErrorCode = (typeof INTEGRATION_ERROR_CODES)[number];

export const INTEGRATION_CAPABILITIES: readonly string[] = ["signal.submit", "signal.sandbox"];
