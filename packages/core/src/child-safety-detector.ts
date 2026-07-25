/**
 * CS-C3 — Deterministic Child Safety Signal Detector.
 *
 * Maps a MINIMIZED observation (raw content held only in the caller's process) into canonical,
 * privacy-safe signal candidates: {@link RiskType}, {@link SafetySignalCode}, {@link SafetySeverity},
 * {@link SafetyUrgency}, a coarse confidence band, bounded reason codes, and explicit detector +
 * taxonomy versions. Deterministic and versioned — NO external AI provider, no network, no randomness.
 *
 * ── PRIVACY INVARIANT ────────────────────────────────────────────────────────────────────────────
 * `content` may exist transiently inside the classifier call. It is NEVER copied into the RESULT,
 * NEVER persisted, NEVER logged, and NEVER placed in errors/diagnostics. The result carries only
 * bounded codes, bands, and versions — never raw text, offsets, or matched substrings.
 *
 * The {@link ChildSafetyClassifier} abstraction lets integrations later inject deterministic local
 * rules, platform-native classifiers, on-device models, or third-party classifiers. The bundled
 * {@link DeterministicChildSafetyClassifier} is for TESTS and LOCAL EXAMPLES ONLY — it is a coarse
 * keyword ruleset and is NOT sufficient for complete real-world protection.
 */
import {
  RiskType, SafetySignalCode, SafetySeverity, SafetyUrgency, SAFETY_TAXONOMY_VERSION, AgeBand,
} from "./child-safety-signal";
// Reuses the canonical coarse {@link SafetyConfidenceBand} (unknown|low|medium|high) — never a raw score.
import { SafetyConfidenceBand } from "./child-safety-safety-signal";

/** Bounded, predefined reason codes. NEVER a free-text explanation of the content. */
export enum ChildSafetyReasonCode {
  AgeProbe = "age_probe",
  ParentalMonitoringProbe = "parental_monitoring_probe",
  SecrecyRequest = "secrecy_request",
  IntimateImageRequest = "intimate_image_request",
  OffPlatformMove = "off_platform_move",
  MeetingProposal = "meeting_proposal",
  ThreatLanguage = "threat_language",
  SelfHarmEncouragement = "self_harm_encouragement",
  CoerciveControl = "coercive_control",
  ComplianceThreat = "compliance_threat",
  FinancialScam = "financial_scam",
  CredentialRequest = "credential_request",
  PaymentDemand = "payment_demand",
  TrustExploitation = "trust_exploitation",
  IdentityManipulation = "identity_manipulation",
}
export const ALL_REASON_CODES: readonly ChildSafetyReasonCode[] = Object.values(ChildSafetyReasonCode);

/** Detector input. `content` stays in-process — see the privacy invariant. */
export interface ChildSafetyClassificationInput {
  content: string;
  locale?: string;
  /** Optional coarse age band to tune severity. Never persisted as raw data. */
  ageBand?: AgeBand;
}

/** One canonical minimized candidate — carries NO raw content. */
export interface ClassifiedSignalCandidate {
  riskType: RiskType;
  signalCodes: SafetySignalCode[];
  severity: SafetySeverity;
  urgency: SafetyUrgency;
  confidenceBand: SafetyConfidenceBand;
  reasonCodes: ChildSafetyReasonCode[];
}

export interface ChildSafetyClassificationResult {
  detectorVersion: string;
  taxonomyVersion: string;
  classifiedAt: string; // ISO
  /** Empty = no signal. Otherwise one or more minimized candidates (one per risk type). */
  candidates: ClassifiedSignalCandidate[];
}

export interface ChildSafetyClassifier {
  classify(
    input: ChildSafetyClassificationInput,
    options?: { signal?: AbortSignal },
  ): Promise<ChildSafetyClassificationResult>;
}

// ── severity / band ordering helpers (pure) ────────────────────────────────────────────────────
const SEVERITY_ORDER: SafetySeverity[] = [SafetySeverity.Low, SafetySeverity.Medium, SafetySeverity.High, SafetySeverity.Critical];
const URGENCY_ORDER: SafetyUrgency[] = [SafetyUrgency.Routine, SafetyUrgency.Elevated, SafetyUrgency.Immediate];
const BAND_ORDER: SafetyConfidenceBand[] = [SafetyConfidenceBand.Unknown, SafetyConfidenceBand.Low, SafetyConfidenceBand.Medium, SafetyConfidenceBand.High];
const maxBy = <T>(order: T[], a: T, b: T): T => (order.indexOf(a) >= order.indexOf(b) ? a : b);

/** A single deterministic rule. `pattern` is matched against lowercased content; nothing is captured. */
type Rule = {
  pattern: RegExp;
  reason: ChildSafetyReasonCode;
  code: SafetySignalCode;
  risk: RiskType;
  severity: SafetySeverity;
  urgency: SafetyUrgency;
  band: SafetyConfidenceBand;
};

/**
 * The bundled deterministic ruleset (coarse, illustrative — NOT real-world sufficient). Covers all
 * supported categories: grooming, sexual solicitation, sextortion, off-platform migration, meeting
 * attempts, cyberbullying, threats, coercion, identity manipulation, scam-related exploitation.
 */
const RULES: readonly Rule[] = [
  // grooming
  { pattern: /\bhow old are you\b|\bwhat'?s your age\b|\bare you \d{1,2}\b/, reason: ChildSafetyReasonCode.AgeProbe, code: SafetySignalCode.AgeProbe, risk: RiskType.Grooming, severity: SafetySeverity.Medium, urgency: SafetyUrgency.Elevated, band: SafetyConfidenceBand.Medium },
  { pattern: /\bour secret\b|\bdon'?t tell (your|any)\b|\bkeep this between us\b/, reason: ChildSafetyReasonCode.SecrecyRequest, code: SafetySignalCode.SecrecyRequest, risk: RiskType.Grooming, severity: SafetySeverity.High, urgency: SafetyUrgency.Elevated, band: SafetyConfidenceBand.High },
  { pattern: /\bare your parents (home|around|there)\b|\bdo your parents (know|check|monitor)\b/, reason: ChildSafetyReasonCode.ParentalMonitoringProbe, code: SafetySignalCode.ParentalMonitoringProbe, risk: RiskType.Grooming, severity: SafetySeverity.Medium, urgency: SafetyUrgency.Elevated, band: SafetyConfidenceBand.Medium },
  // off-platform migration (a grooming tactic)
  { pattern: /\b(move|switch|talk|chat) (to|on) (whatsapp|telegram|snap(chat)?|signal|kik|discord)\b|\badd me on\b/, reason: ChildSafetyReasonCode.OffPlatformMove, code: SafetySignalCode.OffPlatformMove, risk: RiskType.Grooming, severity: SafetySeverity.High, urgency: SafetyUrgency.Elevated, band: SafetyConfidenceBand.High },
  // sexual solicitation
  { pattern: /\bsend (me )?(a )?(pic|picture|photo|nude|selfie)\b|\bshow me your\b/, reason: ChildSafetyReasonCode.IntimateImageRequest, code: SafetySignalCode.IntimateImageRequest, risk: RiskType.SexualSolicitation, severity: SafetySeverity.High, urgency: SafetyUrgency.Immediate, band: SafetyConfidenceBand.High },
  // sextortion
  { pattern: /\b(i have|i'?ve got) your (pic|photo|nude|video)s?\b|\bunless you .* i(?:'| wi)ll (share|post|send|leak)\b|\bpay .* or i(?:'| wi)ll (share|post|leak)\b/, reason: ChildSafetyReasonCode.IntimateImageRequest, code: SafetySignalCode.IntimateImageRequest, risk: RiskType.Sextortion, severity: SafetySeverity.Critical, urgency: SafetyUrgency.Immediate, band: SafetyConfidenceBand.High },
  // meeting attempts
  { pattern: /\blet'?s meet\b|\bmeet (up|in person|irl)\b|\bcome (to|over) (my|to)\b|\bwhere do you live\b|\bwhat'?s your address\b/, reason: ChildSafetyReasonCode.MeetingProposal, code: SafetySignalCode.MeetingProposal, risk: RiskType.MeetingAttempt, severity: SafetySeverity.High, urgency: SafetyUrgency.Immediate, band: SafetyConfidenceBand.High },
  // cyberbullying
  { pattern: /\bkill yourself\b|\bkys\b|\byou should (just )?die\b/, reason: ChildSafetyReasonCode.SelfHarmEncouragement, code: SafetySignalCode.SelfHarmEncouragement, risk: RiskType.Cyberbullying, severity: SafetySeverity.Critical, urgency: SafetyUrgency.Immediate, band: SafetyConfidenceBand.High },
  { pattern: /\beveryone hates you\b|\byou'?re (worthless|a loser|ugly|pathetic|nobody)\b|\bnobody likes you\b/, reason: ChildSafetyReasonCode.ThreatLanguage, code: SafetySignalCode.Threat, risk: RiskType.Cyberbullying, severity: SafetySeverity.Medium, urgency: SafetyUrgency.Elevated, band: SafetyConfidenceBand.Medium },
  // threats
  { pattern: /\bi(?:'| wi)ll (hurt|beat|find|get) you\b|\bi know where you live\b|\byou'?re dead\b/, reason: ChildSafetyReasonCode.ThreatLanguage, code: SafetySignalCode.Threat, risk: RiskType.Threat, severity: SafetySeverity.High, urgency: SafetyUrgency.Immediate, band: SafetyConfidenceBand.High },
  // coercion
  { pattern: /\bdo (what|as) i say\b|\byou have to\b|\byou owe me\b|\bif you don'?t .* (i(?:'| wi)ll|then)\b/, reason: ChildSafetyReasonCode.CoerciveControl, code: SafetySignalCode.CoerciveControl, risk: RiskType.Coercion, severity: SafetySeverity.High, urgency: SafetyUrgency.Elevated, band: SafetyConfidenceBand.Medium },
  { pattern: /\bor else\b|\bor i(?:'| wi)ll tell\b|\bdo it or\b/, reason: ChildSafetyReasonCode.ComplianceThreat, code: SafetySignalCode.ComplianceThreat, risk: RiskType.Coercion, severity: SafetySeverity.High, urgency: SafetyUrgency.Elevated, band: SafetyConfidenceBand.Medium },
  // identity manipulation / impersonation
  { pattern: /\bi'?m (really|actually) your (friend|classmate|teacher)\b|\bpretend(ing)? to be\b|\bthis is (really )?me\b/, reason: ChildSafetyReasonCode.IdentityManipulation, code: SafetySignalCode.CoerciveControl, risk: RiskType.IdentityManipulation, severity: SafetySeverity.Medium, urgency: SafetyUrgency.Elevated, band: SafetyConfidenceBand.Low },
  // scam-related exploitation
  { pattern: /\bgift ?card\b|\bsteam (card|code)\b|\bsend .* (money|cash|crypto|bitcoin)\b|\bwire (me )?\b/, reason: ChildSafetyReasonCode.PaymentDemand, code: SafetySignalCode.PaymentDemand, risk: RiskType.ScamExploitation, severity: SafetySeverity.High, urgency: SafetyUrgency.Elevated, band: SafetyConfidenceBand.Medium },
  { pattern: /\b(your|the) (password|login|verification code|bank details|card number)\b|\bsend me your (password|code|pin)\b/, reason: ChildSafetyReasonCode.CredentialRequest, code: SafetySignalCode.CredentialRequest, risk: RiskType.ScamExploitation, severity: SafetySeverity.High, urgency: SafetyUrgency.Elevated, band: SafetyConfidenceBand.Medium },
  { pattern: /\binvest(ment)?\b.*\b(profit|returns|double)\b|\bfree (robux|v-?bucks|money|prize)\b|\byou won\b/, reason: ChildSafetyReasonCode.FinancialScam, code: SafetySignalCode.FinancialScam, risk: RiskType.ScamExploitation, severity: SafetySeverity.Medium, urgency: SafetyUrgency.Elevated, band: SafetyConfidenceBand.Low },
];

/** The bundled deterministic detector version. Bump on any rule/mapping change. */
export const DETERMINISTIC_DETECTOR_VERSION = "cs-det-rules-v1";

/**
 * A deterministic, rule-based classifier for TESTS + LOCAL EXAMPLES ONLY. Coarse keyword matching;
 * NOT sufficient for complete real-world protection. Deterministic given (content, clock).
 */
export class DeterministicChildSafetyClassifier implements ChildSafetyClassifier {
  private readonly now: () => Date;
  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  async classify(
    input: ChildSafetyClassificationInput,
    options?: { signal?: AbortSignal },
  ): Promise<ChildSafetyClassificationResult> {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const base = {
      detectorVersion: DETERMINISTIC_DETECTOR_VERSION,
      taxonomyVersion: SAFETY_TAXONOMY_VERSION,
      classifiedAt: this.now().toISOString(),
    };
    // Lowercase locally; matched substrings/offsets are never retained.
    const hay = typeof input.content === "string" ? input.content.toLowerCase() : "";
    // Aggregate matches per risk type into one minimized candidate each (deterministic order).
    const byRisk = new Map<RiskType, ClassifiedSignalCandidate>();
    for (const r of RULES) {
      if (!r.pattern.test(hay)) continue;
      const existing = byRisk.get(r.risk);
      if (!existing) {
        byRisk.set(r.risk, {
          riskType: r.risk, signalCodes: [r.code], severity: r.severity, urgency: r.urgency,
          confidenceBand: r.band, reasonCodes: [r.reason],
        });
      } else {
        if (!existing.signalCodes.includes(r.code)) existing.signalCodes.push(r.code);
        if (!existing.reasonCodes.includes(r.reason)) existing.reasonCodes.push(r.reason);
        existing.severity = maxBy(SEVERITY_ORDER, existing.severity, r.severity);
        existing.urgency = maxBy(URGENCY_ORDER, existing.urgency, r.urgency);
        existing.confidenceBand = maxBy(BAND_ORDER, existing.confidenceBand, r.band);
      }
    }
    // Stable ordering by RiskType declaration order.
    const candidates = [...byRisk.values()].sort((a, b) => Object.values(RiskType).indexOf(a.riskType) - Object.values(RiskType).indexOf(b.riskType));
    return { ...base, candidates };
  }
}

/** Map a coarse confidence band to the envelope's calibrated 0..1 confidence. Never a raw model score. */
export function confidenceBandToNumber(band: SafetyConfidenceBand): number {
  switch (band) {
    case SafetyConfidenceBand.High: return 0.85;
    case SafetyConfidenceBand.Medium: return 0.6;
    case SafetyConfidenceBand.Low: return 0.3;
    default: return 0;
  }
}

/**
 * The SDK-facing minimized signal (one canonical candidate + detector context), produced from a
 * classification and then wrapped into a signed {@link SafetySignalEnvelope}. Carries NO raw content.
 */
export interface MinimizedSafetySignal {
  riskType: RiskType;
  signalCodes: SafetySignalCode[];
  severity: SafetySeverity;
  urgency: SafetyUrgency;
  confidence: number;
  confidenceBand: SafetyConfidenceBand;
  reasonCodes: ChildSafetyReasonCode[];
  detectorVersion: string;
  taxonomyVersion: string;
  detectedAt: string;
}

/** Convert a classification result into minimized signals (no raw content). Deterministic. */
export function toMinimizedSignals(result: ChildSafetyClassificationResult): MinimizedSafetySignal[] {
  return result.candidates.map((c) => ({
    riskType: c.riskType,
    signalCodes: [...c.signalCodes],
    severity: c.severity,
    urgency: c.urgency,
    confidence: confidenceBandToNumber(c.confidenceBand),
    confidenceBand: c.confidenceBand,
    reasonCodes: [...c.reasonCodes],
    detectorVersion: result.detectorVersion,
    taxonomyVersion: result.taxonomyVersion,
    detectedAt: result.classifiedAt,
  }));
}
