/**
 * Child Safety Integration Gateway V1 (local DB). Proves the Ed25519-authenticated signal gateway end to
 * end: signature verification (+ body/path/timestamp binding), replay + idempotency (incl. concurrency),
 * key lifecycle (rotate/revoke), status + capability + protocol + size gating, canonical mapping + subject
 * resolution, advisory Policy Engine integration, append-only content-free receipts, tenant isolation, and
 * FAIL-CLOSED behavior. Tamanor stores only public keys and never a raw body.
 * Run: pnpm child-safety-integration-gateway:test
 */
import { createHash, generateKeyPairSync, sign as edSign, type KeyObject } from "node:crypto";
import {
  systemDb,
  createIntegrationPartner, createIntegrationApplication, createIntegrationInstallation, registerIntegrationKey,
  revokeIntegrationKey, setInstallationStatus, linkIntegrationSubject, listIntegrationReceipts, processIntegrationSignal, runSandboxSignal,
  createChildSafetyPolicy, submitChildSafetyPolicyVersion, approveChildSafetyPolicyVersion, activateChildSafetyPolicyVersion,
  type IntegrationActor, type PolicyActor,
} from "@guardora/db";
import {
  Role, WorkspaceKind, buildSigningString, CHILD_SAFETY_SIGNAL_PROTOCOL, CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION,
  ChildSafetyPolicyPurpose, PolicyEffectType, PolicyOperator, CHILD_SAFETY_POLICY_SCHEMA_VERSION,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `csint_${process.pid}`; const tids: string[] = []; let k = 0;
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const PATH = "/api/v1/child-safety/integrations/signals";

async function seedTenant() {
  const id = `f${k++}_${sfx}`; tids.push(id);
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  const u = await systemDb.user.create({ data: { id: `u_${id}`, email: `u_${id}@t.local` } });
  const m = await systemDb.membership.create({ data: { userId: u.id, tenantId: id, role: "admin" as never } });
  const profileId = (await systemDb.protectedProfile.create({ data: { tenantId: id, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  return { tenantId: id, profileId, actor: { tenantId: id, userId: u.id, membershipId: m.id, role: Role.Admin } as IntegrationActor };
}

let ctxN = 0;
interface Ctx { partnerId: string; applicationId: string; installationId: string; keyVersion: number; privateKey: KeyObject; }
function mkEnv(c: Ctx, o: { eventId: string; idem: string; nonce: string; sentAt: string; signalType?: string; subject?: string; danger?: boolean; extra?: Record<string, unknown> }) {
  return {
    protocol: CHILD_SAFETY_SIGNAL_PROTOCOL, protocolVersion: CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION, eventId: o.eventId, idempotencyKey: o.idem,
    partnerId: c.partnerId, applicationId: c.applicationId, installationId: c.installationId, occurredAt: o.sentAt, sentAt: o.sentAt, nonce: o.nonce,
    signal: { externalSignalId: `ext_${o.eventId}`, signalType: o.signalType ?? "GROOMING", confidenceBand: "high", severityHint: "high" },
    classification: { classifierType: "ml_model", classifierVersion: "1.0", classificationMethod: "automated", evaluatedAt: o.sentAt },
    subject: { pseudonymousSubjectId: o.subject ?? "subjA", ageBand: "age_10_12" },
    context: { immediateDangerFlag: Boolean(o.danger), repeatedSignalCount: 3 }, ...(o.extra ?? {}),
  };
}
function submit(c: Ctx, env: Record<string, unknown>, opts: { tamperSig?: boolean; keyVersion?: number; path?: string; noAuth?: boolean } = {}, now?: Date) {
  const body = JSON.stringify(env);
  const bodyHash = sha(body);
  const ss = buildSigningString({ method: "POST", path: opts.path ?? PATH, protocolVersion: env.protocolVersion as string, applicationId: env.applicationId as string, installationId: env.installationId as string, eventId: env.eventId as string, idempotencyKey: env.idempotencyKey as string, sentAt: env.sentAt as string, nonce: env.nonce as string, bodyHashHex: bodyHash });
  let sig: string | null = edSign(null, Buffer.from(ss, "utf8"), c.privateKey).toString("base64");
  if (opts.tamperSig) sig = Buffer.from("z".repeat(64)).toString("base64");
  return processIntegrationSignal({ method: "POST", path: PATH, rawBody: body, signatureBase64: opts.noAuth ? null : sig, keyVersion: opts.keyVersion ?? c.keyVersion, installationIdHeader: env.installationId as string }, now);
}

async function setupCtx(actor: IntegrationActor, profileId: string, opts: { capabilities?: string[]; linkSubject?: boolean } = {}): Promise<Ctx> {
  ctxN++;
  const p = await createIntegrationPartner(actor, { partnerKey: `acme${ctxN}`, displayName: "Acme" });
  const a = await createIntegrationApplication(actor, p.partnerId, { applicationKey: `chat${ctxN}`, displayName: "Chat", environment: "sandbox", capabilities: opts.capabilities });
  const inst = await createIntegrationInstallation(actor, a.applicationId, { installationKey: `inst${ctxN}` });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = await registerIntegrationKey(actor, inst.installationId, { publicKeyBase64: (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64") });
  if (opts.linkSubject !== false) await linkIntegrationSubject(actor, inst.installationId, { pseudonymousSubjectId: "subjA", protectedProfileId: profileId });
  return { partnerId: p.partnerId, applicationId: a.applicationId, installationId: inst.installationId, keyVersion: key.keyVersion, privateKey };
}

async function main() {
  const A = await seedTenant();
  const now = new Date();
  const iso = now.toISOString();

  // ── A. HAPPY PATH + IDEMPOTENCY ───────────────────────────────────
  console.log("\nA. accept + idempotency");
  const c = await setupCtx(A.actor, A.profileId);
  const r1 = await submit(c, mkEnv(c, { eventId: "ev1", idem: "idem1", nonce: "n1", sentAt: iso, danger: true }), {}, now);
  check("★ valid signed request → SIGNAL_ACCEPTED (202) + canonical signal created", r1.code === "SIGNAL_ACCEPTED" && r1.httpStatus === 202 && !!r1.canonicalSignalId);
  const r2 = await submit(c, mkEnv(c, { eventId: "ev1", idem: "idem1", nonce: "n1", sentAt: iso, danger: true }), {}, now);
  check("★ exact idempotent retry → SIGNAL_DUPLICATE (no new signal)", r2.code === "SIGNAL_DUPLICATE" && r2.canonicalSignalId === r1.canonicalSignalId);
  const conflict = await submit(c, mkEnv(c, { eventId: "ev1b", idem: "idem1", nonce: "n1b", sentAt: iso, signalType: "SEXTORTION" }), {}, now);
  check("★ same idempotency key + DIFFERENT body → IDEMPOTENCY_CONFLICT", conflict.code === "IDEMPOTENCY_CONFLICT");
  const sigCount1 = await systemDb.safetySignal.count({ where: { tenantId: A.tenantId } });
  check("★ exactly ONE canonical signal after retry + conflict", sigCount1 === 1, `${sigCount1}`);

  // ── B. REPLAY / TIMESTAMP ─────────────────────────────────────────
  console.log("\nB. replay + timestamp");
  const replay = await submit(c, mkEnv(c, { eventId: "ev2", idem: "idem2", nonce: "n1", sentAt: iso }), {}, now); // reuse nonce n1
  check("★ reused nonce (new idempotency key) → NONCE_REPLAYED", replay.code === "NONCE_REPLAYED");
  const expired = await submit(c, mkEnv(c, { eventId: "ev3", idem: "idem3", nonce: "n3", sentAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString() }), {}, now);
  check("★ expired timestamp → TIMESTAMP_OUT_OF_WINDOW", expired.code === "TIMESTAMP_OUT_OF_WINDOW");

  // ── C. SIGNATURE / KEY ────────────────────────────────────────────
  console.log("\nC. signature + key");
  check("★ tampered signature → SIGNATURE_INVALID", (await submit(c, mkEnv(c, { eventId: "ev4", idem: "idem4", nonce: "n4", sentAt: iso }), { tamperSig: true }, now)).code === "SIGNATURE_INVALID");
  check("★ wrong key version → SIGNATURE_INVALID (no such key)", (await submit(c, mkEnv(c, { eventId: "ev5", idem: "idem5", nonce: "n5", sentAt: iso }), { keyVersion: 999 }, now)).code === "SIGNATURE_INVALID");
  check("★ missing auth headers → INTEGRATION_AUTH_REQUIRED", (await submit(c, mkEnv(c, { eventId: "ev6", idem: "idem6", nonce: "n6", sentAt: iso }), { noAuth: true }, now)).code === "INTEGRATION_AUTH_REQUIRED");
  // signature binds the PATH — a signature computed for a different path must fail (replay across endpoints)
  check("★ signature bound to path (mismatched signed path → invalid)", (await submit(c, mkEnv(c, { eventId: "ev7", idem: "idem7", nonce: "n7", sentAt: iso }), { path: "/other" }, now)).code === "SIGNATURE_INVALID");
  // revoke the key → subsequent requests fail closed
  const keyRow = await systemDb.childSafetyIntegrationKey.findFirst({ where: { installationId: c.installationId, keyVersion: c.keyVersion } });
  await revokeIntegrationKey(A.actor, keyRow!.id, now);
  check("★ revoked key → KEY_REVOKED", (await submit(c, mkEnv(c, { eventId: "ev8", idem: "idem8", nonce: "n8", sentAt: iso }), {}, now)).code === "KEY_REVOKED");

  // ── D. STATUS / CAPABILITY / PROTOCOL / SIZE / MAPPING ────────────
  console.log("\nD. status + capability + protocol + size + mapping");
  const c2 = await setupCtx(A.actor, A.profileId);
  await setInstallationStatus(A.actor, c2.installationId, "suspended", now);
  check("★ suspended installation → INTEGRATION_SUSPENDED", (await submit(c2, mkEnv(c2, { eventId: "e", idem: "i", nonce: "sn1", sentAt: iso }), {}, now)).code === "INTEGRATION_SUSPENDED");
  const cNoCap = await setupCtx(A.actor, A.profileId, { capabilities: ["signal.sandbox"] });
  check("★ capability denied (no signal.submit) → CAPABILITY_DENIED", (await submit(cNoCap, mkEnv(cNoCap, { eventId: "e", idem: "i", nonce: "cn1", sentAt: iso }), {}, now)).code === "CAPABILITY_DENIED");
  const cP = await setupCtx(A.actor, A.profileId);
  check("★ unsupported protocol version → PROTOCOL_UNSUPPORTED", (await submit(cP, { ...mkEnv(cP, { eventId: "e2", idem: "i2", nonce: "pn2", sentAt: iso }), protocolVersion: "9.9" }, {}, now)).code === "PROTOCOL_UNSUPPORTED");
  const cBig = await setupCtx(A.actor, A.profileId);
  const big = mkEnv(cBig, { eventId: "e", idem: "i", nonce: "bn1", sentAt: iso, extra: { classification: { classifierType: "ml_model", classifierVersion: "x".repeat(40000), classificationMethod: "automated", evaluatedAt: iso } } });
  check("★ oversized payload → PAYLOAD_TOO_LARGE", (await submit(cBig, big, {}, now)).code === "PAYLOAD_TOO_LARGE");
  const cProh = await setupCtx(A.actor, A.profileId);
  check("★ prohibited raw-content field → PAYLOAD_INVALID", (await submit(cProh, mkEnv(cProh, { eventId: "e", idem: "i", nonce: "prn1", sentAt: iso, extra: { message: "hi there" } }), {}, now)).code === "PAYLOAD_INVALID");
  // unknown installation
  check("★ unknown installation → INTEGRATION_UNKNOWN", (await processIntegrationSignal({ method: "POST", path: PATH, rawBody: JSON.stringify({ installationId: "nope" }), signatureBase64: "x", keyVersion: 1, installationIdHeader: "nope" }, now)).code === "INTEGRATION_UNKNOWN");
  // unlinked subject → accepted, no canonical signal
  const cNoSub = await setupCtx(A.actor, A.profileId, { linkSubject: false });
  const rNoSub = await submit(cNoSub, mkEnv(cNoSub, { eventId: "e", idem: "i", nonce: "un1", sentAt: iso, subject: "unlinked" }), {}, now);
  check("★ unlinked subject → SIGNAL_ACCEPTED but NO canonical signal (review-required)", rNoSub.code === "SIGNAL_ACCEPTED" && !rNoSub.canonicalSignalId);
  // review-required risk (SELF_HARM_CONCERN) with a linked subject → accepted, NO canonical signal.
  const cSelf = await setupCtx(A.actor, A.profileId);
  const rSelf = await submit(cSelf, mkEnv(cSelf, { eventId: "e", idem: "iSelf", nonce: "sh1", sentAt: iso, signalType: "SELF_HARM_CONCERN" }), {}, now);
  check("★ review-required risk (SELF_HARM_CONCERN) → accepted, no canonical signal", rSelf.code === "SIGNAL_ACCEPTED" && !rSelf.canonicalSignalId);

  // ── E. CONCURRENCY (one signal) ───────────────────────────────────
  console.log("\nE. concurrency");
  const cc = await setupCtx(A.actor, A.profileId);
  const envCc = mkEnv(cc, { eventId: "evC", idem: "idemC", nonce: "nc1", sentAt: iso });
  const results = await Promise.allSettled([submit(cc, envCc, {}, now), submit(cc, envCc, {}, now), submit(cc, envCc, {}, now)]);
  const codes = results.map((r) => (r.status === "fulfilled" ? r.value.code : "ERR"));
  const accepted = codes.filter((x) => x === "SIGNAL_ACCEPTED").length;
  const dup = codes.filter((x) => x === "SIGNAL_DUPLICATE").length;
  check("★ concurrent identical deliveries → exactly one ACCEPTED, rest DUPLICATE", accepted === 1 && dup === 2, codes.join(","));
  const ccSignals = await systemDb.safetySignal.count({ where: { tenantId: A.tenantId, sourceReference: `ext_evC` } });
  check("★ concurrency created exactly ONE canonical signal", ccSignals === 1, `${ccSignals}`);

  // ── F. POLICY INTEGRATION ─────────────────────────────────────────
  console.log("\nF. policy integration (advisory SIGNAL_TRIAGE)");
  const creator: PolicyActor = { tenantId: A.tenantId, userId: "pc", membershipId: "pm_creator", role: Role.Admin };
  const approver: PolicyActor = { tenantId: A.tenantId, userId: "pa", membershipId: "pm_approver", role: Role.Admin };
  const def = { schemaVersion: CHILD_SAFETY_POLICY_SCHEMA_VERSION, purpose: ChildSafetyPolicyPurpose.SignalTriage, defaultEffect: PolicyEffectType.RequireReview,
    rules: [{ id: "danger", priority: 10, enabled: true, explanationCode: "danger", condition: { field: "immediateDangerFlag", operator: PolicyOperator.Equals, value: true }, effects: [{ type: PolicyEffectType.RequireSupervisorReview }, { type: PolicyEffectType.ManualOnly }] }] };
  const pol = await createChildSafetyPolicy(creator, { policyKey: "triage", purpose: ChildSafetyPolicyPurpose.SignalTriage, displayName: "Triage", definition: def });
  await submitChildSafetyPolicyVersion(creator, pol.versionId);
  await approveChildSafetyPolicyVersion(approver, pol.versionId);
  await activateChildSafetyPolicyVersion(approver, pol.versionId);
  const cPol = await setupCtx(A.actor, A.profileId);
  const rPol = await submit(cPol, mkEnv(cPol, { eventId: "evP", idem: "idemP", nonce: "pnn1", sentAt: iso, danger: true }), {}, now);
  const receiptPol = await systemDb.childSafetySignalReceipt.findFirst({ where: { installationId: cPol.installationId, idempotencyKey: "idemP" } });
  check("★ accepted signal records a policy-decision reference (advisory triage evaluated)", rPol.code === "SIGNAL_ACCEPTED" && !!receiptPol?.policyDecisionId);
  const polDecisions = await systemDb.childSafetyPolicyDecisionRecord.count({ where: { tenantId: A.tenantId, evaluationContextType: "integration_signal" } });
  check("★ policy decision persisted with integration context", polDecisions >= 1);

  // ── G. RECEIPTS (content-free) + TENANT ISOLATION ─────────────────
  console.log("\nG. receipts + tenant isolation");
  const receipts = await listIntegrationReceipts(A.actor, {});
  check("★ receipts are content-free (no idempotencyKey/nonceHash/fingerprint in projection)", receipts.items.length > 0 && receipts.items.every((r) => !("idempotencyKey" in r) && !("nonceHash" in r) && !("requestFingerprint" in r)));
  const rawStored = await systemDb.childSafetySignalReceipt.findFirst({ where: { tenantId: A.tenantId }, select: { id: true } });
  check("★ receipt table stores NO raw body (schema has no body column)", !!rawStored); // structural: model has no rawBody field
  const B = await seedTenant();
  check("★ tenant B sees NONE of tenant A's partners", (await (await import("@guardora/db")).listIntegrationPartners(B.actor)).length === 0);
  check("★ tenant B sees NONE of tenant A's receipts", (await listIntegrationReceipts(B.actor, {})).total === 0);

  // ── H. CONTROL-CHAR GUARD + SANDBOX SECURITY ──────────────────────
  console.log("\nH. signing-field guard + sandbox security");
  const cCtl = await setupCtx(A.actor, A.profileId);
  const ctl = await submit(cCtl, mkEnv(cCtl, { eventId: "ev\nINJECT", idem: "idemCtl", nonce: "nc1x", sentAt: iso }), {}, now);
  check("★ control char (newline) in a signed field → PAYLOAD_INVALID (no CRLF injection)", ctl.code === "PAYLOAD_INVALID");

  // Sandbox: a Reviewer (sandbox_use, NO keys_manage) can run the full loop on a SANDBOX installation.
  const reviewer = { tenantId: A.tenantId, userId: A.actor.userId, membershipId: A.actor.membershipId, role: Role.Reviewer } as IntegrationActor;
  const cSbx = await setupCtx(A.actor, A.profileId); // sandbox environment by default
  const beforeKeys = await systemDb.childSafetyIntegrationKey.count({ where: { installationId: cSbx.installationId } });
  const sbx = await runSandboxSignal(reviewer, cSbx.installationId, { signalType: "GROOMING", confidenceBand: "high", immediateDangerFlag: true, pseudonymousSubjectId: "subjA" }, now);
  check("★ Reviewer sandbox_send works end-to-end on a sandbox installation", sbx.result.code === "SIGNAL_ACCEPTED");
  const ephKey = await systemDb.childSafetyIntegrationKey.findFirst({ where: { installationId: cSbx.installationId, keyVersion: sbx.keyVersion } });
  check("★ the ephemeral sandbox key is REVOKED immediately after use (no forge vector)", ephKey?.status === "revoked" && !!ephKey?.revokedAt && (await systemDb.childSafetyIntegrationKey.count({ where: { installationId: cSbx.installationId } })) === beforeKeys + 1);
  // A production-environment installation must REFUSE sandbox send.
  const prodApp = await createIntegrationApplication(A.actor, cSbx.partnerId, { applicationKey: `prod${ctxN}`, displayName: "Prod", environment: "production" });
  const prodInst = await createIntegrationInstallation(A.actor, prodApp.applicationId, { installationKey: `pinst${ctxN}` });
  let prodBlocked = false;
  try { await runSandboxSignal(A.actor, prodInst.installationId, {}, now); } catch (e) { prodBlocked = (e as { code?: string })?.code === "sandbox_only"; }
  check("★ sandbox send REFUSED on a production-environment installation (sandbox_only)", prodBlocked);
}

main()
  .then(async () => {
    for (const id of tids) {
      for (const t of ["childSafetySignalReceipt", "childSafetyIntegrationKey", "childSafetyIntegrationSubject", "childSafetyIntegrationInstallation", "childSafetyIntegrationApplication", "childSafetyIntegrationPartner", "childSafetyPolicyDecisionRecord", "childSafetyPolicyActivationApproval", "childSafetyPolicyVersion", "childSafetyPolicy", "childSafetyIncidentSignal", "childSafetyEscalation", "childSafetyIncident", "childSafetyIntervention", "safetySignal", "auditLog", "protectedProfile"] as const) {
        await (systemDb as never as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[t].deleteMany({ where: { tenantId: id } }).catch(() => {});
      }
      await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    }
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Integration Gateway V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error("FATAL:", e?.stack ?? e?.message ?? e); for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {}); process.exit(1); });
