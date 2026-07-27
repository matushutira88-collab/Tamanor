/**
 * Child Safety Integration Protocol V1 — PURE tests (no DB/network/crypto). Proves strict envelope
 * validation (unknown fields, prohibited raw-content/PII/credential keys at any depth, enums, bounds),
 * deterministic canonicalization + signing-string construction, and the allow-listed partner→canonical
 * mapping. Content-free by construction.
 * Run: pnpm child-safety-integration-protocol:test
 */
import {
  CHILD_SAFETY_SIGNAL_PROTOCOL, CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION, INTEGRATION_LIMITS,
  validateSignalEnvelope, containsProhibitedKey, canonicalRequestContent, buildSigningString,
  mapPartnerRiskToCanonical, canonicalRiskFamily, signalToPolicyFacts, isSupportedProtocolVersion,
  PARTNER_RISK_TYPES, INTEGRATION_ERROR_CODES, PROHIBITED_FIELD_KEYS,
  type SignalEnvelope,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const NOW = "2026-07-27T12:00:00.000Z";
function validEnv(over: Record<string, unknown> = {}): SignalEnvelope {
  return {
    protocol: CHILD_SAFETY_SIGNAL_PROTOCOL, protocolVersion: CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION,
    eventId: "ev1", idempotencyKey: "idem1", partnerId: "p1", applicationId: "a1", installationId: "i1",
    occurredAt: NOW, sentAt: NOW, nonce: "nonce1",
    signal: { externalSignalId: "ext1", signalType: "GROOMING", confidenceBand: "high", severityHint: "high" },
    classification: { classifierType: "ml_model", classifierVersion: "1.2", classificationMethod: "automated", evaluatedAt: NOW },
    subject: { pseudonymousSubjectId: "subjA", ageBand: "age_10_12" },
    context: { immediateDangerFlag: true, repeatedSignalCount: 3, distinctActorCount: 2 },
    ...over,
  } as SignalEnvelope;
}

function main() {
  console.log("\n1. valid envelope + protocol identity");
  check("★ a valid envelope validates", validateSignalEnvelope(validEnv()).valid);
  check("★ protocol constant + version", CHILD_SAFETY_SIGNAL_PROTOCOL === "tamanor-child-safety-signal" && CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION === "1.0" && isSupportedProtocolVersion("1.0") && !isSupportedProtocolVersion("2.0"));
  check("★ max envelope size is bounded (≤32KB)", INTEGRATION_LIMITS.maxEnvelopeBytes === 32 * 1024);

  console.log("\n2. strict rejection");
  check("★ unknown TOP-LEVEL field rejected", !validateSignalEnvelope(validEnv({ extra: 1 })).valid);
  check("★ unknown nested (signal) field rejected", !validateSignalEnvelope(validEnv({ signal: { externalSignalId: "x", signalType: "GROOMING", confidenceBand: "high", foo: 1 } })).valid);
  check("★ bad protocol rejected", !validateSignalEnvelope(validEnv({ protocol: "evil" })).valid);
  check("★ unsupported protocol version rejected", !validateSignalEnvelope(validEnv({ protocolVersion: "9.9" })).valid);
  check("★ out-of-taxonomy risk type rejected", !validateSignalEnvelope(validEnv({ signal: { externalSignalId: "x", signalType: "NOT_A_RISK", confidenceBand: "high" } })).valid);
  check("★ bad confidence band rejected", !validateSignalEnvelope(validEnv({ signal: { externalSignalId: "x", signalType: "GROOMING", confidenceBand: "certain" } })).valid);
  check("★ bad age band rejected", !validateSignalEnvelope(validEnv({ subject: { pseudonymousSubjectId: "s", ageBand: "42" } })).valid);
  check("★ non-integer / negative count rejected", !validateSignalEnvelope(validEnv({ context: { repeatedSignalCount: -1 } })).valid && !validateSignalEnvelope(validEnv({ context: { repeatedSignalCount: 1.5 } })).valid);
  check("★ non-boolean flag rejected", !validateSignalEnvelope(validEnv({ context: { immediateDangerFlag: "yes" } })).valid);

  console.log("\n3. prohibited raw-content / PII / credential keys (any depth)");
  check("★ PROHIBITED_FIELD_KEYS covers message/text/image/url/email/token/password/deviceid/ip", ["message", "text", "image", "url", "email", "token", "password", "deviceid", "ip"].every((k) => PROHIBITED_FIELD_KEYS.includes(k)));
  check("★ message field rejected", !validateSignalEnvelope(validEnv({ message: "hi" })).valid && containsProhibitedKey({ message: "x" }) === "message");
  check("★ nested raw-content field rejected (deep scan)", !validateSignalEnvelope(validEnv({ signal: { externalSignalId: "x", signalType: "GROOMING", confidenceBand: "high", transcript: "..." } })).valid);
  check("★ credential/token field rejected at any depth", containsProhibitedKey({ a: { b: { accessToken: "secret" } } }) !== null);
  check("★ url / location / email / deviceId all flagged", ["url", "location", "email", "deviceId", "ipAddress", "password"].every((k) => containsProhibitedKey({ [k]: "x" }) !== null));
  check("★ a clean envelope has NO prohibited key", containsProhibitedKey(validEnv()) === null);

  console.log("\n4. deterministic canonicalization + signing string");
  const a = canonicalRequestContent(validEnv());
  const b = canonicalRequestContent(validEnv());
  check("★ canonical content is deterministic", a === b);
  check("★ canonical content stable regardless of key order", canonicalRequestContent({ ...validEnv(), signal: { confidenceBand: "high", signalType: "GROOMING", externalSignalId: "ext1", severityHint: "high" } as never }) === a);
  const sig1 = buildSigningString({ method: "post", path: "/p", protocolVersion: "1.0", applicationId: "a1", installationId: "i1", eventId: "ev1", idempotencyKey: "idem1", sentAt: NOW, nonce: "n1", bodyHashHex: "abcd" });
  check("★ signing string is deterministic + method-uppercased + newline-joined + binds body hash", sig1 === buildSigningString({ method: "POST", path: "/p", protocolVersion: "1.0", applicationId: "a1", installationId: "i1", eventId: "ev1", idempotencyKey: "idem1", sentAt: NOW, nonce: "n1", bodyHashHex: "abcd" }) && sig1.startsWith("TAMANOR-CS-SIGNAL-V1\nPOST\n/p\n") && sig1.endsWith("\nabcd") && sig1.split("\n").length === 11);
  check("★ changing ANY signed field changes the signing string", sig1 !== buildSigningString({ method: "POST", path: "/p", protocolVersion: "1.0", applicationId: "a1", installationId: "i1", eventId: "ev1", idempotencyKey: "idem1", sentAt: NOW, nonce: "n1", bodyHashHex: "abce" }) && sig1 !== buildSigningString({ method: "POST", path: "/DIFFERENT", protocolVersion: "1.0", applicationId: "a1", installationId: "i1", eventId: "ev1", idempotencyKey: "idem1", sentAt: NOW, nonce: "n1", bodyHashHex: "abcd" }));

  console.log("\n5. partner → canonical mapping (allow-listed)");
  check("★ direct mappings", mapPartnerRiskToCanonical("GROOMING") === "GROOMING" && mapPartnerRiskToCanonical("SEXTORTION") === "SEXTORTION" && mapPartnerRiskToCanonical("IMPERSONATION") === "IDENTITY_MANIPULATION" && mapPartnerRiskToCanonical("HARASSMENT") === "CYBERBULLYING" && mapPartnerRiskToCanonical("COERCION") === "THREAT");
  check("★ off-platform-migration maps to grooming pattern", mapPartnerRiskToCanonical("OFF_PLATFORM_MIGRATION") === "GROOMING");
  check("★ SELF_HARM_CONCERN / OTHER_REVIEW_REQUIRED → null (review-required, no canonical type)", mapPartnerRiskToCanonical("SELF_HARM_CONCERN") === null && mapPartnerRiskToCanonical("OTHER_REVIEW_REQUIRED") === null);
  check("★ every partner risk type either maps or is explicitly review-required", PARTNER_RISK_TYPES.every((r) => mapPartnerRiskToCanonical(r) !== undefined));
  check("★ canonical risk family mapping", canonicalRiskFamily("GROOMING") === "grooming" && canonicalRiskFamily("SEXTORTION") === "sexual" && canonicalRiskFamily("THREAT") === "violence");
  const facts = signalToPolicyFacts(validEnv());
  check("★ signalToPolicyFacts is content-free (canonical facts only)", facts.signalType === "GROOMING" && facts.riskFamily === "grooming" && facts.immediateDangerFlag === true && facts.repeatedSignalCount === 3 && !("externalSignalId" in facts) && !("message" in facts));

  console.log("\n6. error contract");
  check("★ INTEGRATION_ERROR_CODES has the full stable set", ["SIGNAL_ACCEPTED", "SIGNATURE_INVALID", "NONCE_REPLAYED", "IDEMPOTENCY_CONFLICT", "RATE_LIMITED", "INTERNAL_FAIL_CLOSED", "PAYLOAD_TOO_LARGE", "CAPABILITY_DENIED"].every((c) => (INTEGRATION_ERROR_CODES as readonly string[]).includes(c)));

  console.log("\n7. deterministic compatibility vector (SDK ⇄ gateway build the SAME string)");
  // A fixed, synthetic vector. The SDK and the gateway both call buildSigningString with these components;
  // this asserts the EXACT canonical string, so any drift between the two sides is caught.
  const vector = { method: "POST", path: "/api/v1/child-safety/integrations/signals", protocolVersion: "1.0", applicationId: "app_ABC", installationId: "inst_XYZ", eventId: "ev_123", idempotencyKey: "idem_456", sentAt: "2026-07-27T12:00:00.000Z", nonce: "nonce_789", bodyHashHex: "0123456789abcdef" };
  const EXPECTED = "TAMANOR-CS-SIGNAL-V1\nPOST\n/api/v1/child-safety/integrations/signals\n1.0\napp_ABC\ninst_XYZ\nev_123\nidem_456\n2026-07-27T12:00:00.000Z\nnonce_789\n0123456789abcdef";
  check("★ signing string matches the exact expected vector", buildSigningString(vector) === EXPECTED);
  check("★ changing EACH bound component invalidates the vector", (["method", "path", "protocolVersion", "applicationId", "installationId", "eventId", "idempotencyKey", "sentAt", "nonce", "bodyHashHex"] as const).every((f) => buildSigningString({ ...vector, [f]: vector[f] + "X" }) !== EXPECTED));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Integration Protocol V1: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
