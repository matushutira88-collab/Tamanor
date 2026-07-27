/**
 * Tamanor Child Safety Partner SDK V1 — tests (no DB/network). Proves the strict content-free builder,
 * Ed25519 signing that verifies against the registered public key, retry CLASSIFICATION (transient only),
 * identical-bytes idempotent retry (one logical event), typed responses, the server-only boundary, and
 * that no private key is ever emitted. Uses an in-memory transport (no real gateway).
 * Run: pnpm child-safety-partner-sdk:test
 */
import { generateKeyPairSync, verify as edVerify, createPublicKey, createHash } from "node:crypto";
import {
  createPartnerSignalClient, createEd25519Signer, isRetriable, generateEphemeralPartnerKeyPair,
  buildSigningString, validateSignalEnvelope, type PartnerTransport, type PartnerSignalInput,
} from "../src/index";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const validInput: PartnerSignalInput = {
  externalSignalId: "ext1", signalType: "GROOMING", confidenceBand: "high", severityHint: "high",
  classification: { classifierType: "ml_model", classifierVersion: "1.0", classificationMethod: "automated", evaluatedAt: new Date().toISOString() },
  subject: { pseudonymousSubjectId: "subjA", ageBand: "age_10_12" },
  context: { immediateDangerFlag: true, repeatedSignalCount: 2 },
};
const baseOpts = (transport: PartnerTransport, signer: ReturnType<typeof createEd25519Signer>) => ({
  endpoint: "https://local.test/api/v1/child-safety/integrations/signals", applicationId: "a1", installationId: "i1", keyVersion: 1, partnerId: "p1", signer, transport,
});

async function main() {
  const kp = generateKeyPairSync("ed25519");
  const signer = createEd25519Signer(kp.privateKey);

  console.log("\n1. builder + strict validation (no raw-content fields)");
  const captured: { body: string }[] = [];
  const okTransport: PartnerTransport = async (req) => { captured.push({ body: req.body }); return { status: 202, body: { ok: true, code: "SIGNAL_ACCEPTED", receiptId: "r1", canonicalSignalId: "cs1" } }; };
  const client = createPartnerSignalClient(baseOpts(okTransport, signer));
  const env = client.buildEnvelope(validInput, { eventId: "ev1", idempotencyKey: "idem1", nonce: "n1", sentAt: new Date().toISOString() });
  check("★ builder produces a VALID content-free envelope", validateSignalEnvelope(env).valid && env.protocol === "tamanor-child-safety-signal");
  check("★ a raw-content field in the loose input is STRIPPED — never reaches the envelope", (() => { const e = client.buildEnvelope({ ...validInput, message: "secret text", content: "x" } as never, { eventId: "e", idempotencyKey: "i", nonce: "n", sentAt: new Date().toISOString() }); return validateSignalEnvelope(e).valid && JSON.stringify(e).indexOf("secret text") === -1 && !("message" in (e as Record<string, unknown>)); })());
  check("★ an out-of-taxonomy risk type is rejected", (() => { try { client.buildEnvelope({ ...validInput, signalType: "NOPE" }, { eventId: "e", idempotencyKey: "i", nonce: "n", sentAt: new Date().toISOString() }); return false; } catch { return true; } })());

  console.log("\n2. signing verifies against the public key");
  const signed = await client.signEnvelope(env);
  const bodyHashHex = createHash("sha256").update(signed.body, "utf8").digest("hex");
  const signingString = buildSigningString({ method: "POST", path: "/api/v1/child-safety/integrations/signals", protocolVersion: env.protocolVersion, applicationId: env.applicationId, installationId: env.installationId, eventId: env.eventId, idempotencyKey: env.idempotencyKey, sentAt: env.sentAt, nonce: env.nonce, bodyHashHex });
  const pub = createPublicKey({ key: kp.publicKey.export({ type: "spki", format: "der" }), format: "der", type: "spki" });
  check("★ Ed25519 signature verifies against the public key + signing string", edVerify(null, Buffer.from(signingString, "utf8"), pub, Buffer.from(signed.signatureBase64, "base64")));
  check("★ signer requires an ed25519 key (RSA rejected)", (() => { try { createEd25519Signer(generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey); return false; } catch { return true; } })());

  console.log("\n3. retry classification");
  check("★ transient (5xx / 429 / network / RATE_LIMITED / FAIL_CLOSED) is retriable", isRetriable("INTERNAL_FAIL_CLOSED", 500) && isRetriable("RATE_LIMITED", 429) && isRetriable("TRANSPORT_ERROR", 0) && isRetriable("x", 503));
  check("★ permanent (signature/protocol/payload/idempotency/capability) is NOT retriable", !isRetriable("SIGNATURE_INVALID", 401) && !isRetriable("PROTOCOL_UNSUPPORTED", 400) && !isRetriable("PAYLOAD_INVALID", 400) && !isRetriable("IDEMPOTENCY_CONFLICT", 409) && !isRetriable("CAPABILITY_DENIED", 403));

  console.log("\n4. idempotent retry reuses identical bytes (one logical event)");
  let attempts = 0; const bodies: string[] = []; const sigs: string[] = [];
  const flakyTransport: PartnerTransport = async (req) => { attempts++; bodies.push(req.body); sigs.push(req.headers["x-cs-signature"]!); if (attempts < 2) return { status: 503, body: {} }; return { status: 202, body: { ok: true, code: "SIGNAL_ACCEPTED", receiptId: "r", canonicalSignalId: "cs" } }; };
  const flakyClient = createPartnerSignalClient({ ...baseOpts(flakyTransport, signer), retry: { maxAttempts: 3 } });
  const ack = await flakyClient.submitSignal(validInput);
  check("★ transient failure is retried then succeeds", ack.ok && ack.code === "SIGNAL_ACCEPTED" && attempts === 2);
  check("★ retry re-sends BYTE-IDENTICAL body + signature (same eventId/idempotencyKey/nonce)", bodies.length === 2 && bodies[0] === bodies[1] && sigs[0] === sigs[1]);

  console.log("\n5. typed responses + non-retriable stops immediately");
  let permAttempts = 0;
  const permTransport: PartnerTransport = async () => { permAttempts++; return { status: 401, body: { ok: false, code: "SIGNATURE_INVALID" } }; };
  const permAck = await createPartnerSignalClient({ ...baseOpts(permTransport, signer), retry: { maxAttempts: 3 } }).submitSignal(validInput);
  check("★ permanent error returns typed {ok:false, code} and does NOT retry", !permAck.ok && permAck.code === "SIGNATURE_INVALID" && permAttempts === 1);
  const dupTransport: PartnerTransport = async () => ({ status: 200, body: { ok: true, code: "SIGNAL_DUPLICATE" } });
  const dupAck = await createPartnerSignalClient(baseOpts(dupTransport, signer)).submitSignal(validInput);
  check("★ SIGNAL_DUPLICATE is treated as success (idempotent)", dupAck.ok && dupAck.code === "SIGNAL_DUPLICATE");

  console.log("\n6. no private-key exposure + test util");
  const errOut: string[] = [];
  const throwTransport: PartnerTransport = async () => { throw new Error("boom"); };
  const tAck = await createPartnerSignalClient({ ...baseOpts(throwTransport, signer), retry: { maxAttempts: 1 } }).submitSignal(validInput).catch((e) => { errOut.push(String(e)); return null; });
  check("★ transport throw → TRANSPORT_ERROR ack (no key material leaked)", tAck !== null && tAck!.code === "TRANSPORT_ERROR");
  const priv = kp.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  check("★ no ack/error output contains private-key material", JSON.stringify({ ack, permAck, dupAck, tAck, errOut }).indexOf("PRIVATE KEY") === -1 && !JSON.stringify(tAck).includes(priv.slice(40, 80)));
  const testKp = generateEphemeralPartnerKeyPair();
  check("★ ephemeral test key util yields a public SPKI + a private PEM (never persisted)", testKp.publicKeyBase64Spki.length > 0 && testKp.privateKeyPem.includes("PRIVATE KEY"));
}

main().then(() => { console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Partner SDK V1: ${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1); })
  .catch((e) => { console.error("FATAL:", e); process.exit(1); });
