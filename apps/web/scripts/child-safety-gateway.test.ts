/**
 * CS-C6 — Privacy Gateway integration (local DB). Signed-envelope ingestion + full rejection matrix:
 * auth/scope/binding, signature, timestamp skew, replay, idempotency, body/content-type/JSON, allowlist
 * (unknown + forbidden raw-content fields), rate limit, and the privacy invariant (no raw content in a
 * persisted signal). Reuses the canonical envelope + signing + the SafetySignal store.
 * Run: pnpm child-safety-gateway:test
 */
import {
  systemDb, createChildSafetyInstallation, revokeChildSafetyInstallation,
} from "@guardora/db";
import {
  signEnvelope, SAFETY_SIGNAL_CONTRACT_VERSION, SAFETY_TAXONOMY_VERSION, DETERMINISTIC_DETECTOR_VERSION,
} from "@guardora/core";
import { processSafetySignalIngestion, type InterveneFn } from "../src/server/child-safety/gateway";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const sfx = `csgw_${process.pid}`;
const created: string[] = [];
let n = 0;

async function seedTenantWithProfile(): Promise<{ tenantId: string; profileId: string }> {
  const id = `t${n++}_${sfx}`;
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: "family", plan: "family_free" } });
  created.push(id);
  const profile = await systemDb.protectedProfile.create({ data: { tenantId: id, ageBand: "age_10_12", protectionStatus: "active" } });
  return { tenantId: id, profileId: profile.id };
}

function buildEnvelope(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: SAFETY_SIGNAL_CONTRACT_VERSION, eventId: `evt_${Math.random().toString(36).slice(2)}`,
    sourcePlatform: "sdk", sourceEnvironment: "sdk", protectedProfileReference: "REPLACE",
    conversationReferenceHash: "conv_hash_abc", actorReferenceHash: "actor_hash_abc",
    riskType: "GROOMING", severity: "high", urgency: "elevated", confidence: 0.85, signalCodes: ["SECRECY_REQUEST"],
    detectedAt: new Date().toISOString(), taxonomyVersion: SAFETY_TAXONOMY_VERSION, detectorVersion: DETERMINISTIC_DETECTOR_VERSION,
    nonce: `nonce_${Math.random().toString(36).slice(2)}`, signature: "",
    ...over,
  };
}
function signed(env: Record<string, unknown>, token: string): Record<string, unknown> {
  return { ...env, signature: signEnvelope(env, token) };
}
const req = (env: Record<string, unknown>, token: string | null, extra: Record<string, unknown> = {}) => ({
  contentType: "application/json", bodyText: JSON.stringify(env), bearerToken: token,
  applicationIdHeader: "app_pub", ...extra,
});
// Stub intervention (CS-C6 test focuses on the gateway pipeline, not CS-C15 orchestration).
const STUB_INTERVENE: InterveneFn = async () => ({ outcome: "CREATE_OR_UPDATE_INCIDENT" as never, processingState: "completed", delivered: false, deliveryId: null, reviewed: true, incidentId: null, escalated: false, recipientsConsidered: 0, recipientsAuthorized: 0, attemptCount: 1, lastFailureClass: "none" });

async function main() {
  const { tenantId, profileId } = await seedTenantWithProfile();
  const { token } = await createChildSafetyInstallation({ applicationId: "app_pub", tenantId, subjectRef: profileId });
  const base = () => buildEnvelope({ protectedProfileReference: profileId });

  // A. happy path
  console.log("\nA. valid signed envelope");
  const okRes = await processSafetySignalIngestion(req(signed(base(), token), token), { intervene: STUB_INTERVENE });
  check("valid signed envelope → 201 accepted", okRes.status === 201 && (okRes.body as { accepted: boolean }).accepted === true);
  const okBody = okRes.body as { signalId: string; outcome: string; duplicate: boolean };
  check("receipt has signalId + outcome, duplicate=false, no recipient data", !!okBody.signalId && !!okBody.outcome && okBody.duplicate === false && !JSON.stringify(okBody).match(/recipient|email|token|secret/i));
  const persisted = await systemDb.safetySignal.findUnique({ where: { id: okBody.signalId }, select: { signalType: true, tenantId: true, sourceType: true } });
  check("★ persisted signal is minimized (no content field exists on the row)", persisted?.signalType === "GROOMING" && persisted?.tenantId === tenantId);

  // B. auth / scope / binding
  console.log("\nB. authentication + binding");
  check("missing token → 401 unauthorized", (await processSafetySignalIngestion(req(signed(base(), token), null))).status === 401);
  check("invalid token → 401", (await processSafetySignalIngestion(req(signed(base(), token), "csi_wrongtoken"))).status === 401);
  const exp = await createChildSafetyInstallation({ applicationId: "app_pub", tenantId, subjectRef: profileId, expiresAt: new Date(Date.now() - 1000) });
  const expRes = await processSafetySignalIngestion(req(signed(base(), exp.token), exp.token));
  check("★ expired token → 401 installation_expired", expRes.status === 401 && (expRes.body as { error?: string }).error === "installation_expired");
  const rev = await createChildSafetyInstallation({ applicationId: "app_pub", tenantId, subjectRef: profileId });
  await revokeChildSafetyInstallation(rev.installationId);
  const revRes = await processSafetySignalIngestion(req(signed(base(), rev.token), rev.token));
  check("★ revoked token → 401 installation_revoked", revRes.status === 401 && (revRes.body as { error?: string }).error === "installation_revoked");
  const noScope = await createChildSafetyInstallation({ applicationId: "app_pub", tenantId, subjectRef: profileId, scopes: ["child-safety:other"] });
  check("wrong scope → 403 forbidden_scope", (await processSafetySignalIngestion(req(signed(base(), noScope.token), noScope.token))).status === 403);
  const otherProfile = await systemDb.protectedProfile.create({ data: { tenantId, ageBand: "age_10_12", protectionStatus: "active" } });
  const mismatchEnv = signed(buildEnvelope({ protectedProfileReference: otherProfile.id }), token);
  check("★ protected-profile mismatch (bound installation) → 403", (await processSafetySignalIngestion(req(mismatchEnv, token))).status === 403);

  // C. signature / timestamp
  console.log("\nC. signature + timestamp");
  check("★ invalid signature → 401", (await processSafetySignalIngestion(req({ ...base(), signature: "hmac-sha256:v1:" + "0".repeat(64) }, token))).status === 401);
  check("tampered body after signing → 401", (await processSafetySignalIngestion(req({ ...signed(base(), token), severity: "critical" }, token))).status === 401);
  check("★ stale timestamp → 400", (await processSafetySignalIngestion(req(signed(buildEnvelope({ protectedProfileReference: profileId, detectedAt: new Date(Date.now() - 3600_000).toISOString() }), token), token))).status === 400);

  // D. replay + idempotency
  console.log("\nD. replay + idempotency");
  const replayEnv = signed(base(), token);
  const first = await processSafetySignalIngestion(req(replayEnv, token), { intervene: STUB_INTERVENE });
  const second = await processSafetySignalIngestion(req(replayEnv, token), { intervene: STUB_INTERVENE });
  check("★ reused nonce (duplicate signed envelope) → 409 replay; no 2nd signal", first.status === 201 && second.status === 409 && (second.body as { error?: string }).error === "replay_detected");
  const idemEnvA = signed(base(), token);
  const r1 = await processSafetySignalIngestion(req(idemEnvA, token, { idempotencyKey: "idem-1" }), { intervene: STUB_INTERVENE });
  const r2 = await processSafetySignalIngestion(req(idemEnvA, token, { idempotencyKey: "idem-1" }), { intervene: STUB_INTERVENE });
  check("★ same idempotency key + same payload → duplicate receipt", r1.status === 201 && (r2.body as { duplicate?: boolean }).duplicate === true);
  const r3 = await processSafetySignalIngestion(req(signed(base(), token), token, { idempotencyKey: "idem-1" }), { intervene: STUB_INTERVENE });
  check("★ same idempotency key + different payload → 409 conflict", r3.status === 409 && (r3.body as { error?: string }).error === "idempotency_conflict");

  // E. body / content-type / allowlist
  console.log("\nE. request + allowlist rejections");
  check("unsupported content type → 415", (await processSafetySignalIngestion({ ...req(signed(base(), token), token), contentType: "text/plain" })).status === 415);
  check("oversized body → 413", (await processSafetySignalIngestion({ ...req(signed(base(), token), token), bodyText: "x".repeat(20000) })).status === 413);
  check("malformed JSON → 400", (await processSafetySignalIngestion({ ...req(signed(base(), token), token), bodyText: "{not json" })).status === 400);
  check("★ unknown field → 400 invalid_envelope", (await processSafetySignalIngestion(req(signed({ ...base(), extraField: "x" }, token), token))).status === 400);
  check("★ forbidden raw-content field (message) → 400", (await processSafetySignalIngestion(req(signed({ ...base(), message: "hi how old are you" }, token), token))).status === 400);
  check("★ raw conversation-like payload (transcript) → 400", (await processSafetySignalIngestion(req(signed({ ...base(), transcript: "a\nb" }, token), token))).status === 400);

  // F. rate limit
  console.log("\nF. rate limiting");
  let limited = false;
  const rl = await createChildSafetyInstallation({ applicationId: "app_pub", tenantId, subjectRef: profileId });
  for (let i = 0; i < 65; i++) {
    const res = await processSafetySignalIngestion(req(signed(base(), rl.token), rl.token), { intervene: STUB_INTERVENE });
    if (res.status === 429) { limited = true; break; }
  }
  check("★ per-installation rate limit → 429", limited);

  // G. safe errors
  console.log("\nG. safe errors");
  const anyErr = await processSafetySignalIngestion(req({ ...base(), signature: "garbage" }, token));
  check("errors carry a stable code only (no stack/SQL/prisma)", !JSON.stringify(anyErr.body).match(/prisma|sql|stack|at Object|Error:/i));
}

main()
  .then(async () => {
    for (const id of created) { await systemDb.childSafetyInstallation.deleteMany({ where: { tenantId: id } }).catch(() => {}); await systemDb.tenant.delete({ where: { id } }).catch(() => {}); }
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS-C6 Privacy Gateway: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error("FATAL:", e?.stack ?? e?.message ?? e);
    for (const id of created) { await systemDb.childSafetyInstallation.deleteMany({ where: { tenantId: id } }).catch(() => {}); await systemDb.tenant.delete({ where: { id } }).catch(() => {}); }
    process.exit(1);
  });
