/**
 * CS-C3 — deterministic detector + canonical signing + additive taxonomy (PURE, no DB/network).
 * Run: pnpm child-safety-detector:test
 */
import {
  DeterministicChildSafetyClassifier, DETERMINISTIC_DETECTOR_VERSION, toMinimizedSignals,
  confidenceBandToNumber, ChildSafetyReasonCode,
  RiskType, SafetySignalCode, SafetySeverity, SafetyUrgency, SafetyConfidenceBand,
  ALL_RISK_TYPES, SAFETY_TAXONOMY_VERSION, validateSafetySignalEnvelope,
  canonicalizeEnvelope, signEnvelope, verifyEnvelopeSignature, isTimestampFresh, SAFETY_SIGNING_ALGORITHM,
  decideChildSafetyOutcome, ChildSafetyOutcome, type ChildSafetyPolicyFacts,
  decideIntervention, riskFamilyOf, ChildSafetyRiskFamily, type InterventionFacts,
} from "../src/index";

const intv = (o: Partial<InterventionFacts> = {}): InterventionFacts => ({
  riskType: RiskType.Cyberbullying, severity: SafetySeverity.High, urgency: SafetyUrgency.Elevated, confidenceBand: SafetyConfidenceBand.High,
  hasValidGuardianAuthority: true, hasRecipientAuthorization: true, recipientSafe: true, consentValid: true, hasAuthorizedRecipient: true,
  repeatedSignalCount: 0, existingActiveIncidentId: null, alreadyEscalated: false, ...o,
});

const authorizedFacts = (o: Partial<ChildSafetyPolicyFacts> = {}): ChildSafetyPolicyFacts => ({
  severity: SafetySeverity.High, urgency: SafetyUrgency.Elevated, confidenceBand: SafetyConfidenceBand.High,
  hasValidGuardianAuthority: true, hasRecipientAuthorization: true, recipientSafe: true, consentValid: true, repeatedSignalCount: 0, ...o,
});

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const FIXED = new Date("2026-07-24T10:00:00.000Z");
const det = new DeterministicChildSafetyClassifier({ now: () => FIXED });
const classify = (content: string) => det.classify({ content });
const risks = (r: { candidates: { riskType: RiskType }[] }) => r.candidates.map((c) => c.riskType);

async function main() {
  // A. taxonomy additivity
  console.log("\nA. additive taxonomy (v2)");
  check("existing risk types preserved (verbatim values)", ["GROOMING", "SEXUAL_SOLICITATION", "SEXTORTION", "MEETING_ATTEMPT", "CYBERBULLYING", "THREAT", "IDENTITY_MANIPULATION"].every((v) => (ALL_RISK_TYPES as string[]).includes(v)));
  check("★ new risk types added: COERCION + SCAM_EXPLOITATION", (ALL_RISK_TYPES as string[]).includes("COERCION") && (ALL_RISK_TYPES as string[]).includes("SCAM_EXPLOITATION"));
  check("taxonomy version is explicit v2", SAFETY_TAXONOMY_VERSION === "child-safety-taxonomy-v2");
  check("★ envelope validator accepts a new risk type value", validateSafetySignalEnvelope({ riskType: "SCAM_EXPLOITATION" }).errors.every((e) => e.field !== "riskType"));
  check("envelope validator still rejects an unknown risk type", validateSafetySignalEnvelope({ riskType: "NONSENSE" }).errors.some((e) => e.field === "riskType" && e.code === "invalid_value"));

  // B. deterministic classification — all supported categories
  console.log("\nB. deterministic classification (all categories)");
  check("grooming (age probe)", risks(await classify("hey how old are you?")).includes(RiskType.Grooming));
  check("grooming (secrecy)", risks(await classify("this is our secret, don't tell your mom")).includes(RiskType.Grooming));
  check("off-platform migration → grooming signal", (await classify("let's move to whatsapp")).candidates.some((c) => c.signalCodes.includes(SafetySignalCode.OffPlatformMove)));
  check("sexual solicitation", risks(await classify("send me a pic")).includes(RiskType.SexualSolicitation));
  check("sextortion (critical/immediate)", (await classify("i have your nude photos, pay me or i will leak them")).candidates.some((c) => c.riskType === RiskType.Sextortion && c.severity === SafetySeverity.Critical && c.urgency === SafetyUrgency.Immediate));
  check("meeting attempt", risks(await classify("let's meet up, where do you live?")).includes(RiskType.MeetingAttempt));
  check("cyberbullying (self-harm → critical)", (await classify("nobody likes you, kys")).candidates.some((c) => c.riskType === RiskType.Cyberbullying && c.severity === SafetySeverity.Critical));
  check("threats", risks(await classify("i know where you live and i will hurt you")).includes(RiskType.Threat));
  check("★ coercion", risks(await classify("do what i say or i will tell everyone")).includes(RiskType.Coercion));
  check("★ identity manipulation", risks(await classify("i'm really your classmate, pretend to be nice")).includes(RiskType.IdentityManipulation));
  check("★ scam exploitation (payment demand)", risks(await classify("send me a steam gift card and i will give you free robux")).includes(RiskType.ScamExploitation));
  check("★ scam exploitation (credential request)", risks(await classify("send me your password and verification code")).includes(RiskType.ScamExploitation));
  check("no-risk input → NO candidates", (await classify("good luck at school tomorrow!")).candidates.length === 0);

  // C. determinism + versioning
  console.log("\nC. determinism + versioning");
  const r1 = await classify("send me a pic"); const r2 = await classify("send me a pic");
  check("identical input → identical result", JSON.stringify(r1) === JSON.stringify(r2));
  check("result carries detector + taxonomy version + timestamp", r1.detectorVersion === DETERMINISTIC_DETECTOR_VERSION && r1.taxonomyVersion === SAFETY_TAXONOMY_VERSION && r1.classifiedAt === FIXED.toISOString());
  check("bounded reason codes only (from the enum)", r1.candidates.every((c) => c.reasonCodes.every((rc) => Object.values(ChildSafetyReasonCode).includes(rc))));

  // D. PRIVACY — raw content never in the result
  console.log("\nD. privacy: raw content absent from result/minimized");
  const secret = "my-secret-address-is-42-elm-street-sextortion";
  const rr = await classify(`i have your nude photos ${secret}`);
  check("★ raw content NOT in serialized classification result", !JSON.stringify(rr).includes(secret) && !JSON.stringify(rr).includes("elm-street"));
  const mins = toMinimizedSignals(rr);
  check("★ raw content NOT in minimized signals", !JSON.stringify(mins).includes(secret));
  check("minimized signal has calibrated confidence (band→number)", mins.every((m) => m.confidence === confidenceBandToNumber(m.confidenceBand)) && confidenceBandToNumber(SafetyConfidenceBand.High) === 0.85);

  // E. AbortSignal
  console.log("\nE. cancellation");
  const ac = new AbortController(); ac.abort();
  let aborted = false;
  try { await det.classify({ content: "send me a pic" }, { signal: ac.signal }); } catch (e) { aborted = (e as Error).name === "AbortError"; }
  check("aborted classify rejects with AbortError", aborted);

  // F. canonical signing
  console.log("\nF. canonical signing (HMAC-SHA256)");
  const KEY = "installation-secret-abc";
  const env: Record<string, unknown> = {
    contractVersion: "safety-signal-v1", eventId: "evt_1", sourcePlatform: "test", sourceEnvironment: "local",
    protectedProfileReference: "pp_ref", conversationReferenceHash: "conv_hash", actorReferenceHash: "actor_hash",
    riskType: "GROOMING", severity: "high", urgency: "elevated", confidence: 0.85, signalCodes: ["SECRECY_REQUEST"],
    detectedAt: FIXED.toISOString(), taxonomyVersion: SAFETY_TAXONOMY_VERSION, detectorVersion: DETERMINISTIC_DETECTOR_VERSION,
    nonce: "nonce_1", signature: "",
  };
  const sig = signEnvelope(env, KEY);
  const signed = { ...env, signature: sig };
  check("signature has algorithm:version prefix", sig.startsWith(`${SAFETY_SIGNING_ALGORITHM}:v1:`));
  check("★ valid signature verifies", verifyEnvelopeSignature(signed, KEY).ok);
  check("canonicalization is key-order independent (deterministic)", canonicalizeEnvelope(env) === canonicalizeEnvelope({ signature: "", nonce: "nonce_1", contractVersion: "safety-signal-v1", eventId: "evt_1", sourcePlatform: "test", sourceEnvironment: "local", protectedProfileReference: "pp_ref", conversationReferenceHash: "conv_hash", actorReferenceHash: "actor_hash", riskType: "GROOMING", severity: "high", urgency: "elevated", confidence: 0.85, signalCodes: ["SECRECY_REQUEST"], detectedAt: FIXED.toISOString(), taxonomyVersion: SAFETY_TAXONOMY_VERSION, detectorVersion: DETERMINISTIC_DETECTOR_VERSION }));
  check("★ tampered field → signature mismatch", !verifyEnvelopeSignature({ ...signed, riskType: "THREAT" }, KEY).ok);
  check("wrong secret → mismatch", !verifyEnvelopeSignature(signed, "wrong-key").ok);
  const vMal = verifyEnvelopeSignature({ ...env, signature: "garbage" }, KEY);
  check("malformed signature → malformed", !vMal.ok && vMal.reason === "malformed");
  const vAlg = verifyEnvelopeSignature({ ...env, signature: "rsa-sha256:v1:deadbeef" }, KEY);
  check("★ unsupported algorithm → unsupported_algorithm", !vAlg.ok && vAlg.reason === "unsupported_algorithm");
  check("signature excludes the signature field itself", canonicalizeEnvelope(signed) === canonicalizeEnvelope(env));

  // G. timestamp freshness / skew
  console.log("\nG. timestamp freshness + skew");
  const now = new Date("2026-07-24T10:00:30.000Z");
  check("within skew → fresh", isTimestampFresh(FIXED.toISOString(), now, 60_000).ok);
  check("★ too old → expired", isTimestampFresh("2026-07-24T09:00:00.000Z", now, 60_000).reason === "expired");
  check("★ too far future → future", isTimestampFresh("2026-07-24T11:00:00.000Z", now, 60_000).reason === "future");
  check("unparseable → unparseable", isTimestampFresh("not-a-date", now, 60_000).reason === "unparseable");

  // H. deterministic policy decision (mandatory fail-closed rules)
  console.log("\nH. policy decision (fail-closed)");
  check("★ low confidence → QUEUE_FOR_REVIEW, NEVER notify", (() => { const d = decideChildSafetyOutcome(authorizedFacts({ confidenceBand: SafetyConfidenceBand.Low })); return d.outcome === ChildSafetyOutcome.QueueForReview && d.notifyGuardian === false; })());
  check("★ missing guardian authority → blocked (no notify)", decideChildSafetyOutcome(authorizedFacts({ hasValidGuardianAuthority: false })).notifyGuardian === false);
  check("★ missing recipient authorization → blocked", decideChildSafetyOutcome(authorizedFacts({ hasRecipientAuthorization: false })).notifyGuardian === false);
  check("★ unsafe recipient → blocked", decideChildSafetyOutcome(authorizedFacts({ recipientSafe: false })).notifyGuardian === false);
  check("★ expired/withdrawn consent → blocked", decideChildSafetyOutcome(authorizedFacts({ consentValid: false })).notifyGuardian === false);
  check("authorized + high → incident + notify", (() => { const d = decideChildSafetyOutcome(authorizedFacts()); return d.outcome === ChildSafetyOutcome.CreateOrUpdateIncident && d.notifyGuardian === true; })());
  check("authorized + medium → NOTIFY_AUTHORIZED_GUARDIAN", (() => { const d = decideChildSafetyOutcome(authorizedFacts({ severity: SafetySeverity.Medium, urgency: SafetyUrgency.Routine })); return d.outcome === ChildSafetyOutcome.NotifyAuthorizedGuardian && d.notifyGuardian === true; })());
  check("★ urgent eligible → URGENT_ESCALATION", decideChildSafetyOutcome(authorizedFacts({ urgency: SafetyUrgency.Immediate })).outcome === ChildSafetyOutcome.UrgentEscalation);
  check("★ repeated eligible signals (>=3) → deterministic escalation", decideChildSafetyOutcome(authorizedFacts({ severity: SafetySeverity.Medium, urgency: SafetyUrgency.Routine, repeatedSignalCount: 3 })).outcome === ChildSafetyOutcome.CreateOrUpdateIncident);
  check("blocked-but-critical → incident (record), still no notify", (() => { const d = decideChildSafetyOutcome(authorizedFacts({ severity: SafetySeverity.Critical, consentValid: false })); return d.outcome === ChildSafetyOutcome.CreateOrUpdateIncident && d.notifyGuardian === false; })());

  // I. CS-C15 enriched intervention policy (full matrix + risk family)
  console.log("\nI. CS-C15 intervention policy");
  check("risk family mapping (sextortion→sexual, coercion→coercion, cyberbullying→bullying)", riskFamilyOf(RiskType.Sextortion) === ChildSafetyRiskFamily.Sexual && riskFamilyOf(RiskType.Coercion) === ChildSafetyRiskFamily.Coercion && riskFamilyOf(RiskType.Cyberbullying) === ChildSafetyRiskFamily.Bullying);
  check("★ low confidence → LOCAL_SAFETY_GUIDANCE, no notify/incident/escalate", (() => { const d = decideIntervention(intv({ confidenceBand: SafetyConfidenceBand.Low })); return d.outcome === ChildSafetyOutcome.LocalSafetyGuidance && !d.notifyGuardian && !d.createOrUpdateIncident && !d.escalate; })());
  check("high severity + complete authorization → incident + notify", (() => { const d = decideIntervention(intv()); return d.outcome === ChildSafetyOutcome.CreateOrUpdateIncident && d.notifyGuardian && d.createOrUpdateIncident; })());
  check("★ high severity + NO authorized recipient → incident, NO notify (internal only)", (() => { const d = decideIntervention(intv({ hasAuthorizedRecipient: false, hasValidGuardianAuthority: false })); return d.createOrUpdateIncident && !d.notifyGuardian; })());
  check("★ missing consent → no notify", !decideIntervention(intv({ consentValid: false })).notifyGuardian);
  check("★ unsafe recipient → no notify", !decideIntervention(intv({ recipientSafe: false })).notifyGuardian);
  check("★ missing recipient authorization → no notify", !decideIntervention(intv({ hasRecipientAuthorization: false })).notifyGuardian);
  check("★ urgent risk type (sextortion) → URGENT_ESCALATION + incident + escalate", (() => { const d = decideIntervention(intv({ riskType: RiskType.Sextortion, severity: SafetySeverity.Critical, urgency: SafetyUrgency.Immediate })); return d.outcome === ChildSafetyOutcome.UrgentEscalation && d.createOrUpdateIncident && d.escalate; })());
  check("★ urgent + already escalated → escalate=false (idempotent)", decideIntervention(intv({ riskType: RiskType.Sextortion, severity: SafetySeverity.Critical, alreadyEscalated: true })).escalate === false);
  check("★ urgent without authorized recipient → escalate internally, no notify", (() => { const d = decideIntervention(intv({ riskType: RiskType.MeetingAttempt, severity: SafetySeverity.Critical, hasAuthorizedRecipient: false })); return d.escalate && !d.notifyGuardian; })());
  check("★ repeated related signals (>=3) → create/update incident", decideIntervention(intv({ severity: SafetySeverity.Medium, urgency: SafetyUrgency.Routine, repeatedSignalCount: 3 })).createOrUpdateIncident === true);
  check("moderate + authorized → NOTIFY_AUTHORIZED_GUARDIAN (no incident)", (() => { const d = decideIntervention(intv({ severity: SafetySeverity.Medium, urgency: SafetyUrgency.Routine })); return d.outcome === ChildSafetyOutcome.NotifyAuthorizedGuardian && !d.createOrUpdateIncident; })());
  check("moderate + NOT authorized → QUEUE_FOR_REVIEW, no notify", (() => { const d = decideIntervention(intv({ severity: SafetySeverity.Medium, urgency: SafetyUrgency.Routine, hasAuthorizedRecipient: false })); return d.outcome === ChildSafetyOutcome.QueueForReview && !d.notifyGuardian; })());
}

main().then(() => {
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS-C3 detector + signing + taxonomy: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
});
