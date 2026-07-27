/**
 * Child Safety Integration Signal Protocol V1 — the operational service layer (SYSTEM-scoped, systemDb).
 *
 * Two surfaces:
 *   1. REGISTRY management (session-authorized): partners/applications/installations/keys/subjects/receipts.
 *      Tamanor stores ONLY public keys — a partner private key is never uploaded, stored, or logged.
 *   2. GATEWAY (NO user session — authenticated by per-installation Ed25519 signature). It authenticates,
 *      verifies the signature, checks the timestamp window, prevents replay, enforces idempotency, strictly
 *      validates the minimal (content-free) payload, checks capability, maps to a canonical SafetySignal
 *      (only when the pseudonymous subject is authorized-linked), evaluates the active SIGNAL_TRIAGE policy
 *      (advisory), and persists an append-only content-free receipt — atomically, FAIL-CLOSED at every step.
 *
 * Every function is tenant-isolated (SYSTEM tables — explicit scoping + composite (id, tenantId) FKs). No
 * raw request body, signature value, or private key is ever persisted. Cross-tenant access is impossible.
 */
import { createHash, verify as cryptoVerify, createPublicKey, generateKeyPairSync, sign as edSign, randomUUID } from "node:crypto";
import { ActorKind } from "@prisma/client";
import {
  Role,
  validateSignalEnvelope, canonicalRequestContent, buildSigningString, signalToPolicyFacts,
  mapPartnerRiskToCanonical, canonicalRiskFamily, mapSeverity, mapUrgency,
  isSupportedProtocolVersion, INTEGRATION_LIMITS, INTEGRATION_CAPABILITIES, INCIDENT_CORRELATION_WINDOW_MS,
  ChildSafetyPolicyPurpose, CHILD_SAFETY_SIGNAL_PROTOCOL, CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION,
  canViewChildSafetyIntegration, canManageChildSafetyIntegration, canManageChildSafetyIntegrationKeys,
  canViewChildSafetyIntegrationReceipts, canUseChildSafetyIntegrationSandbox,
  type SignalEnvelope, type IntegrationErrorCode,
} from "@guardora/core";
import { systemDb } from "./index";
import { evaluateChildSafetyPolicyForTenant } from "./child-safety-policy";

export interface IntegrationActor { tenantId: string; userId: string; membershipId: string; role: Role; }
export class ChildSafetyIntegrationForbiddenError extends Error { constructor(public readonly reason: string) { super("child_safety_integration_forbidden"); } }
export class ChildSafetyIntegrationNotFoundError extends Error { constructor() { super("child_safety_integration_not_found"); } }
export class ChildSafetyIntegrationStateError extends Error { constructor(public readonly code: string) { super(code); } }

const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // replay/idempotency window
const ROTATION_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 120; // per installation per minute (V1 local; not revealed to callers)

const sha256hex = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");
const KEY_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

async function audit(tenantId: string, actorUserId: string | null, event: string, targetId: string, metadata: Record<string, string | number | boolean>): Promise<void> {
  const isSystem = !actorUserId || actorUserId === "system";
  await systemDb.auditLog.create({ data: { tenantId, event, actorKind: isSystem ? ActorKind.system : ActorKind.human, ...(isSystem ? {} : { actorUserId }), targetType: "child_safety_integration", targetId, metadata: metadata as never } }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRY (session-authorized)
// ═══════════════════════════════════════════════════════════════════════════════
const assertView = (a: IntegrationActor) => { if (!canViewChildSafetyIntegration(a.role)) throw new ChildSafetyIntegrationForbiddenError("view"); };
const assertManage = (a: IntegrationActor) => { if (!canManageChildSafetyIntegration(a.role)) throw new ChildSafetyIntegrationForbiddenError("manage"); };
const assertKeys = (a: IntegrationActor) => { if (!canManageChildSafetyIntegrationKeys(a.role)) throw new ChildSafetyIntegrationForbiddenError("keys_manage"); };
const assertReceipts = (a: IntegrationActor) => { if (!canViewChildSafetyIntegrationReceipts(a.role)) throw new ChildSafetyIntegrationForbiddenError("receipts_view"); };

export async function createIntegrationPartner(actor: IntegrationActor, input: { partnerKey: string; displayName: string }): Promise<{ partnerId: string }> {
  assertManage(actor);
  if (!KEY_RE.test(input.partnerKey)) throw new ChildSafetyIntegrationStateError("bad_partner_key");
  if (!input.displayName?.trim() || input.displayName.length > 120) throw new ChildSafetyIntegrationStateError("bad_display_name");
  if (await systemDb.childSafetyIntegrationPartner.findFirst({ where: { tenantId: actor.tenantId, partnerKey: input.partnerKey }, select: { id: true } })) throw new ChildSafetyIntegrationStateError("duplicate_partner_key");
  const p = await systemDb.childSafetyIntegrationPartner.create({ data: { tenantId: actor.tenantId, partnerKey: input.partnerKey, displayName: input.displayName.trim(), createdByMembershipId: actor.membershipId } });
  await audit(actor.tenantId, actor.userId, "child_safety.integration.partner_created", p.id, { partnerKey: input.partnerKey });
  return { partnerId: p.id };
}

export async function createIntegrationApplication(actor: IntegrationActor, partnerId: string, input: { applicationKey: string; displayName: string; environment?: string; capabilities?: string[] }): Promise<{ applicationId: string }> {
  assertManage(actor);
  const partner = await systemDb.childSafetyIntegrationPartner.findFirst({ where: { id: partnerId, tenantId: actor.tenantId } });
  if (!partner) throw new ChildSafetyIntegrationNotFoundError();
  if (!KEY_RE.test(input.applicationKey)) throw new ChildSafetyIntegrationStateError("bad_application_key");
  const env = input.environment === "production" ? "production" : "sandbox";
  const caps = (input.capabilities ?? ["signal.submit", "signal.sandbox"]).filter((c) => INTEGRATION_CAPABILITIES.includes(c));
  if (caps.length === 0) throw new ChildSafetyIntegrationStateError("no_capabilities");
  if (await systemDb.childSafetyIntegrationApplication.findFirst({ where: { partnerId, applicationKey: input.applicationKey }, select: { id: true } })) throw new ChildSafetyIntegrationStateError("duplicate_application_key");
  const app = await systemDb.childSafetyIntegrationApplication.create({ data: { tenantId: actor.tenantId, partnerId, applicationKey: input.applicationKey, displayName: input.displayName.slice(0, 120), environment: env, allowedCapabilities: caps.join(",") } });
  await audit(actor.tenantId, actor.userId, "child_safety.integration.application_created", app.id, { environment: env });
  return { applicationId: app.id };
}

export async function createIntegrationInstallation(actor: IntegrationActor, applicationId: string, input: { installationKey: string }): Promise<{ installationId: string }> {
  assertManage(actor);
  const app = await systemDb.childSafetyIntegrationApplication.findFirst({ where: { id: applicationId, tenantId: actor.tenantId } });
  if (!app) throw new ChildSafetyIntegrationNotFoundError();
  if (!KEY_RE.test(input.installationKey)) throw new ChildSafetyIntegrationStateError("bad_installation_key");
  if (await systemDb.childSafetyIntegrationInstallation.findFirst({ where: { applicationId, installationKey: input.installationKey }, select: { id: true } })) throw new ChildSafetyIntegrationStateError("duplicate_installation_key");
  const inst = await systemDb.childSafetyIntegrationInstallation.create({ data: { tenantId: actor.tenantId, partnerId: app.partnerId, applicationId, installationKey: input.installationKey } });
  await audit(actor.tenantId, actor.userId, "child_safety.integration.installation_created", inst.id, {});
  return { installationId: inst.id };
}

/** Register a PUBLIC key (base64 SPKI DER, Ed25519). REJECTS anything that is not a public key — a private
 *  key is never accepted. Keys-manage permission only (Owner/Admin). */
export async function registerIntegrationKey(actor: IntegrationActor, installationId: string, input: { publicKeyBase64: string; algorithm?: string }): Promise<{ keyId: string; keyVersion: number; fingerprint: string }> {
  assertKeys(actor);
  const inst = await systemDb.childSafetyIntegrationInstallation.findFirst({ where: { id: installationId, tenantId: actor.tenantId } });
  if (!inst) throw new ChildSafetyIntegrationNotFoundError();
  const algorithm = input.algorithm ?? "ed25519";
  if (algorithm !== "ed25519") throw new ChildSafetyIntegrationStateError("unsupported_algorithm");
  // Validate it is a PUBLIC Ed25519 key and REJECT any private-key material.
  if (/PRIVATE KEY/i.test(input.publicKeyBase64)) throw new ChildSafetyIntegrationStateError("private_key_rejected");
  let publicKeyDer: Buffer;
  try {
    const keyObj = createPublicKey({ key: Buffer.from(input.publicKeyBase64, "base64"), format: "der", type: "spki" });
    if (keyObj.asymmetricKeyType !== "ed25519") throw new Error("not_ed25519");
    publicKeyDer = keyObj.export({ type: "spki", format: "der" }) as Buffer;
  } catch { throw new ChildSafetyIntegrationStateError("invalid_public_key"); }
  const publicKey = publicKeyDer.toString("base64");
  const fingerprint = sha256hex(publicKeyDer);
  const latest = await systemDb.childSafetyIntegrationKey.findFirst({ where: { tenantId: actor.tenantId, installationId }, orderBy: { keyVersion: "desc" }, select: { keyVersion: true } });
  const keyVersion = (latest?.keyVersion ?? 0) + 1;
  const key = await systemDb.childSafetyIntegrationKey.create({ data: { tenantId: actor.tenantId, installationId, keyVersion, algorithm, publicKey, fingerprint, status: "active" } });
  await audit(actor.tenantId, actor.userId, "child_safety.integration.key_registered", key.id, { keyVersion, fingerprint: fingerprint.slice(0, 16) });
  return { keyId: key.id, keyVersion, fingerprint };
}

/** Begin rotation: mark the current active key as `rotating` with a bounded overlap window (both remain
 *  valid until the new key is registered/activated). */
export async function startIntegrationKeyRotation(actor: IntegrationActor, keyId: string, now: Date = new Date()): Promise<{ status: string }> {
  assertKeys(actor);
  const key = await systemDb.childSafetyIntegrationKey.findFirst({ where: { id: keyId, tenantId: actor.tenantId } });
  if (!key) throw new ChildSafetyIntegrationNotFoundError();
  if (key.status !== "active") throw new ChildSafetyIntegrationStateError("not_active");
  await systemDb.childSafetyIntegrationKey.update({ where: { id: keyId }, data: { status: "rotating", validUntil: new Date(now.getTime() + ROTATION_OVERLAP_MS) } });
  await audit(actor.tenantId, actor.userId, "child_safety.integration.key_rotated", keyId, {});
  return { status: "rotating" };
}

export async function revokeIntegrationKey(actor: IntegrationActor, keyId: string, now: Date = new Date()): Promise<{ status: string }> {
  assertKeys(actor);
  const key = await systemDb.childSafetyIntegrationKey.findFirst({ where: { id: keyId, tenantId: actor.tenantId } });
  if (!key) throw new ChildSafetyIntegrationNotFoundError();
  await systemDb.childSafetyIntegrationKey.update({ where: { id: keyId }, data: { status: "revoked", revokedAt: now } });
  await audit(actor.tenantId, actor.userId, "child_safety.integration.key_revoked", keyId, {});
  return { status: "revoked" };
}

export async function setInstallationStatus(actor: IntegrationActor, installationId: string, status: "active" | "suspended" | "revoked", now: Date = new Date()): Promise<{ status: string }> {
  assertManage(actor);
  const inst = await systemDb.childSafetyIntegrationInstallation.findFirst({ where: { id: installationId, tenantId: actor.tenantId } });
  if (!inst) throw new ChildSafetyIntegrationNotFoundError();
  await systemDb.childSafetyIntegrationInstallation.update({ where: { id: installationId }, data: { status, ...(status === "revoked" ? { revokedAt: now } : {}) } });
  await audit(actor.tenantId, actor.userId, `child_safety.integration.installation_${status}`, installationId, {});
  return { status };
}

/** Authorized-only link from an opaque partner subject to a Tamanor ProtectedProfile (enables canonical
 *  signal creation). The partner never learns the profile identity. */
export async function linkIntegrationSubject(actor: IntegrationActor, installationId: string, input: { pseudonymousSubjectId: string; protectedProfileId: string }): Promise<{ subjectId: string }> {
  assertManage(actor);
  const inst = await systemDb.childSafetyIntegrationInstallation.findFirst({ where: { id: installationId, tenantId: actor.tenantId } });
  if (!inst) throw new ChildSafetyIntegrationNotFoundError();
  const profile = await systemDb.protectedProfile.findFirst({ where: { id: input.protectedProfileId, tenantId: actor.tenantId }, select: { id: true } });
  if (!profile) throw new ChildSafetyIntegrationNotFoundError();
  const existing = await systemDb.childSafetyIntegrationSubject.findFirst({ where: { installationId, pseudonymousSubjectId: input.pseudonymousSubjectId }, select: { id: true } });
  if (existing) return { subjectId: existing.id };
  const s = await systemDb.childSafetyIntegrationSubject.create({ data: { tenantId: actor.tenantId, installationId, pseudonymousSubjectId: input.pseudonymousSubjectId, protectedProfileId: input.protectedProfileId, createdByMembershipId: actor.membershipId } });
  await audit(actor.tenantId, actor.userId, "child_safety.integration.subject_linked", s.id, {});
  return { subjectId: s.id };
}

export async function listIntegrationPartners(actor: IntegrationActor) {
  assertView(actor);
  const partners = await systemDb.childSafetyIntegrationPartner.findMany({ where: { tenantId: actor.tenantId }, orderBy: { createdAt: "desc" },
    include: { applications: { select: { id: true, applicationKey: true, environment: true, status: true, installations: { select: { id: true, installationKey: true, status: true } } } } } });
  return partners.map((p) => ({ id: p.id, partnerKey: p.partnerKey, displayName: p.displayName, status: p.status, applications: p.applications }));
}

export async function getIntegrationInstallation(actor: IntegrationActor, installationId: string) {
  assertView(actor);
  const inst = await systemDb.childSafetyIntegrationInstallation.findFirst({ where: { id: installationId, tenantId: actor.tenantId },
    include: { keys: { orderBy: { keyVersion: "desc" }, select: { id: true, keyVersion: true, algorithm: true, fingerprint: true, status: true, validFrom: true, validUntil: true, revokedAt: true } } } });
  if (!inst) throw new ChildSafetyIntegrationNotFoundError();
  return {
    id: inst.id, installationKey: inst.installationKey, status: inst.status, applicationId: inst.applicationId, partnerId: inst.partnerId,
    keys: inst.keys.map((k) => ({ ...k, validFrom: k.validFrom.toISOString(), validUntil: k.validUntil?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null })),
  };
}

export async function listIntegrationReceipts(actor: IntegrationActor, input: { installationId?: string; resultCode?: string; page?: number; pageSize?: number } = {}) {
  assertReceipts(actor);
  const where: Record<string, unknown> = { tenantId: actor.tenantId };
  if (input.installationId) where.installationId = input.installationId;
  if (input.resultCode) where.resultCode = input.resultCode.slice(0, 40);
  const pageSize = Math.min(Math.max(1, Math.floor(input.pageSize || 25)), 100);
  const page = Math.max(1, Math.floor(input.page || 1));
  const [total, rows] = await Promise.all([
    systemDb.childSafetySignalReceipt.count({ where }),
    systemDb.childSafetySignalReceipt.findMany({ where, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize,
      // Content-free projection: NO idempotencyKey/nonceHash/fingerprint raw values exposed in normal UI.
      select: { id: true, partnerId: true, applicationId: true, installationId: true, externalEventId: true, protocolVersion: true, keyVersion: true, resultCode: true, failureCategory: true, canonicalSignalId: true, policyDecisionId: true, receivedAt: true, processedAt: true } }),
  ]);
  return { total, page, pageSize, hasMore: page * pageSize < total, items: rows.map((r) => ({ ...r, receivedAt: r.receivedAt.toISOString(), processedAt: r.processedAt?.toISOString() ?? null })) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GATEWAY (signature-authenticated; NO user session)
// ═══════════════════════════════════════════════════════════════════════════════
export interface GatewayInput {
  method: string; path: string; rawBody: string;
  signatureBase64: string | null; keyVersion: number | null; installationIdHeader: string | null;
  sourceIpHash?: string | null; // pre-hashed by the web layer for rate-limit only; never stored raw
}
export interface GatewayResult { httpStatus: number; code: IntegrationErrorCode; eventId?: string; receiptId?: string; canonicalSignalId?: string; retryAfterSeconds?: number; }

const HTTP: Record<IntegrationErrorCode, number> = {
  SIGNAL_ACCEPTED: 202, SIGNAL_DUPLICATE: 200, PAYLOAD_TOO_LARGE: 413, PAYLOAD_INVALID: 400, PROTOCOL_UNSUPPORTED: 400,
  INTEGRATION_AUTH_REQUIRED: 401, SIGNATURE_INVALID: 401, KEY_REVOKED: 401, TIMESTAMP_OUT_OF_WINDOW: 401,
  INTEGRATION_UNKNOWN: 404, INTEGRATION_SUSPENDED: 403, CAPABILITY_DENIED: 403, NONCE_REPLAYED: 409,
  IDEMPOTENCY_CONFLICT: 409, RATE_LIMITED: 429, INTERNAL_FAIL_CLOSED: 500,
};
const R = (code: IntegrationErrorCode, extra: Partial<GatewayResult> = {}): GatewayResult => ({ httpStatus: HTTP[code], code, ...extra });

/** Verify an Ed25519 signature over the canonical signing string. Cryptographically constant-time. */
function verifyEd25519(signingString: string, publicKeyBase64: string, signatureBase64: string): boolean {
  try {
    const pub = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });
    return cryptoVerify(null, Buffer.from(signingString, "utf8"), pub, Buffer.from(signatureBase64, "base64"));
  } catch { return false; }
}

/**
 * The gateway pipeline (fail-closed at every step; the strict processing order is documented in the spec).
 * Persists an append-only, content-free receipt. Never stores the raw body, signature, or private key.
 */
export async function processIntegrationSignal(input: GatewayInput, now: Date = new Date()): Promise<GatewayResult> {
  try {
    // 1. size
    if (Buffer.byteLength(input.rawBody, "utf8") > INTEGRATION_LIMITS.maxEnvelopeBytes) return R("PAYLOAD_TOO_LARGE");
    // 2. auth headers
    if (!input.signatureBase64 || input.keyVersion === null || !input.installationIdHeader) return R("INTEGRATION_AUTH_REQUIRED");
    // parse body
    let env: SignalEnvelope;
    try { env = JSON.parse(input.rawBody) as SignalEnvelope; } catch { return R("PAYLOAD_INVALID"); }
    if (!env || typeof env !== "object" || env.installationId !== input.installationIdHeader) return R("INTEGRATION_AUTH_REQUIRED");

    // 3. resolve installation (determines tenant) — content-free "unknown" on any miss (no existence leak of tenant)
    const inst = await systemDb.childSafetyIntegrationInstallation.findFirst({ where: { id: env.installationId }, include: { application: true, partner: true } });
    if (!inst) return R("INTEGRATION_UNKNOWN");
    // envelope's declared app/partner must match the installation
    if (env.applicationId !== inst.applicationId || env.partnerId !== inst.partnerId) return R("INTEGRATION_UNKNOWN");
    // 4. status
    if (inst.status !== "active") return R("INTEGRATION_SUSPENDED");
    if (inst.application.status !== "active" || inst.partner.status !== "active") return R("INTEGRATION_SUSPENDED");
    const tenantId = inst.tenantId;

    // 5. protocol version (supported + within the application's declared range)
    if (!isSupportedProtocolVersion(env.protocolVersion) || env.protocolVersion < inst.application.protocolMinVersion || env.protocolVersion > inst.application.protocolMaxVersion) {
      await audit(tenantId, "system", "child_safety.integration.protocol_rejected", inst.id, { v: String(env.protocolVersion).slice(0, 16) });
      return R("PROTOCOL_UNSUPPORTED");
    }
    // 6. timestamp window
    const sentAtMs = Date.parse(env.sentAt);
    if (Number.isNaN(sentAtMs) || Math.abs(now.getTime() - sentAtMs) > INTEGRATION_LIMITS.clockSkewMs) return R("TIMESTAMP_OUT_OF_WINDOW");

    // Reject control characters in ANY signed field BEFORE building the signing string — no CRLF/ambiguity
    // can ever enter the newline-joined canonical string (defense in depth; a forge already needs the key).
    const signedFields = [env.protocolVersion, env.applicationId, env.installationId, env.eventId, env.idempotencyKey, env.sentAt, env.nonce];
    if (signedFields.some((f) => typeof f !== "string" || /[\u0000-\u001f\u007f]/.test(f))) return R("PAYLOAD_INVALID");

    // 7. rate limit (DB-backed; count receipts for the installation in the window — accepted + rejected)
    const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);
    const recent = await systemDb.childSafetySignalReceipt.count({ where: { installationId: inst.id, receivedAt: { gte: windowStart } } });
    if (recent >= RATE_LIMIT_MAX) return R("RATE_LIMITED", { retryAfterSeconds: 60 });

    // 8. body hash + key resolution
    const bodyHashHex = sha256hex(input.rawBody);
    const key = await systemDb.childSafetyIntegrationKey.findFirst({ where: { tenantId, installationId: inst.id, keyVersion: input.keyVersion } });
    if (!key) return R("SIGNATURE_INVALID");
    if (key.status === "revoked" || key.status === "suspended" || (key.validUntil && key.validUntil.getTime() < now.getTime())) {
      await audit(tenantId, "system", "child_safety.integration.key_revoked_attempt", inst.id, { keyVersion: key.keyVersion });
      return R("KEY_REVOKED");
    }
    // 9. signature verification (binds method/path/protocol/app/installation/event/idempotency/sentAt/nonce/body)
    const signingString = buildSigningString({ method: input.method, path: input.path, protocolVersion: env.protocolVersion, applicationId: env.applicationId, installationId: env.installationId, eventId: env.eventId, idempotencyKey: env.idempotencyKey, sentAt: env.sentAt, nonce: env.nonce, bodyHashHex });
    if (!verifyEd25519(signingString, key.publicKey, input.signatureBase64)) {
      await audit(tenantId, "system", "child_safety.integration.invalid_signature", inst.id, { keyVersion: key.keyVersion });
      return R("SIGNATURE_INVALID");
    }

    // 10. idempotency / replay
    const requestFingerprint = sha256hex(canonicalRequestContent(env));
    const nonceHash = sha256hex(`${inst.id}:${env.nonce}`);
    const prior = await systemDb.childSafetySignalReceipt.findFirst({ where: { installationId: inst.id, idempotencyKey: env.idempotencyKey } });
    if (prior) {
      if (prior.requestFingerprint === requestFingerprint) return R("SIGNAL_DUPLICATE", { eventId: env.eventId, receiptId: prior.id, canonicalSignalId: prior.canonicalSignalId ?? undefined });
      await audit(tenantId, "system", "child_safety.integration.idempotency_conflict", inst.id, {});
      return R("IDEMPOTENCY_CONFLICT");
    }
    // Nonce pre-check (a fresh idempotency key reusing a spent nonce = replay). The unique (installation,
    // nonceHash) index remains the concurrency backstop; this pre-check keeps the common path clean.
    if (await systemDb.childSafetySignalReceipt.findFirst({ where: { installationId: inst.id, nonceHash }, select: { id: true } })) {
      await audit(tenantId, "system", "child_safety.integration.replay_attempt", inst.id, {});
      return R("NONCE_REPLAYED");
    }

    // 11. strict payload validation (content-free; rejects raw content / unknown fields)
    const val = validateSignalEnvelope(env);
    if (!val.valid) return R("PAYLOAD_INVALID");
    // 12. capability
    if (!inst.application.allowedCapabilities.split(",").includes("signal.submit")) return R("CAPABILITY_DENIED");

    // 12.5 PILOT ENFORCEMENT (production installations only). A production signal requires an ACTIVE
    // authorized pilot in scope; every unauthorized pilot state fails closed via the existing
    // INTEGRATION_SUSPENDED result (non-enumerating — never reveals whether a pilot exists). Sandbox
    // installations are unaffected. Lazy-imported to keep this module's dependency surface minimal; any
    // error propagates to the outer fail-closed catch.
    if (inst.application.environment === "production") {
      const { enforceProductionPilotForSignal } = await import("./child-safety-partner-pilot");
      const pilotBlock = await enforceProductionPilotForSignal(tenantId, inst.id, inst.applicationId, env.signal?.signalType ?? "", env.subject?.ageBand ?? null, now);
      if (pilotBlock) return R(pilotBlock, pilotBlock === "RATE_LIMITED" ? { retryAfterSeconds: 60 } : {});
    }

    // 13-15. map → canonical → policy → persist (atomic)
    const canonicalType = mapPartnerRiskToCanonical(env.signal.signalType);
    const subject = await systemDb.childSafetyIntegrationSubject.findFirst({ where: { installationId: inst.id, pseudonymousSubjectId: env.subject.pseudonymousSubjectId }, select: { protectedProfileId: true } });

    // Advisory SIGNAL_TRIAGE policy evaluation (fail-closed inside; never enables automatic action here).
    let policyDecisionId: string | null = null;
    try {
      const decision = await evaluateChildSafetyPolicyForTenant(tenantId, ChildSafetyPolicyPurpose.SignalTriage, signalToPolicyFacts(env), { contextType: "integration_signal", contextId: env.eventId, correlationId: env.idempotencyKey });
      policyDecisionId = decision.policyVersionId ? env.eventId : null; // decision persisted by the policy layer; store a bounded ref
    } catch { policyDecisionId = null; } // policy failure → still fail-closed; canonical signal (if any) enters manual review

    let canonicalSignalId: string | null = null;
    const receipt = await systemDb.$transaction(async (tx) => {
      // Create a canonical SafetySignal ONLY when the risk maps to a canonical type AND the subject is authorized-linked.
      if (canonicalType && subject) {
        const sig = await tx.safetySignal.create({ data: {
          tenantId, protectedProfileId: subject.protectedProfileId, signalType: canonicalType, severity: mapSeverity(env.signal), confidenceBand: env.signal.confidenceBand,
          sourceType: "integration_partner", sourceReference: env.signal.externalSignalId.slice(0, 64), occurrenceBucket: nonceHash.slice(0, 32),
          detectedAt: new Date(Date.parse(env.occurredAt)), receivedAt: now,
        } });
        canonicalSignalId = sig.id;
      }
      const rec = await tx.childSafetySignalReceipt.create({ data: {
        tenantId, partnerId: inst.partnerId, applicationId: inst.applicationId, installationId: inst.id,
        externalEventId: env.eventId, idempotencyKey: env.idempotencyKey, nonceHash, requestFingerprint, protocolVersion: env.protocolVersion,
        keyVersion: key.keyVersion, resultCode: "SIGNAL_ACCEPTED", canonicalSignalId, policyDecisionId, receivedAt: now, processedAt: now,
        expiresAt: new Date(now.getTime() + RECEIPT_RETENTION_MS),
      } });
      await tx.childSafetyIntegrationInstallation.update({ where: { id: inst.id }, data: { lastSeenAt: now } });
      return rec;
    }).catch((e: unknown) => {
      // Unique-constraint races: another identical delivery won, or a nonce was replayed under a different key.
      const msg = String((e as Error)?.message ?? "");
      if (/nonceHash/.test(msg)) return { conflict: "NONCE_REPLAYED" as const };
      if (/idempotencyKey/.test(msg)) return { conflict: "IDEMPOTENCY_DUP" as const };
      throw e;
    });

    if ("conflict" in receipt) {
      if (receipt.conflict === "NONCE_REPLAYED") { await audit(tenantId, "system", "child_safety.integration.replay_attempt", inst.id, {}); return R("NONCE_REPLAYED"); }
      const dup = await systemDb.childSafetySignalReceipt.findFirst({ where: { installationId: inst.id, idempotencyKey: env.idempotencyKey } });
      return R("SIGNAL_DUPLICATE", { eventId: env.eventId, receiptId: dup?.id, canonicalSignalId: dup?.canonicalSignalId ?? undefined });
    }

    // Correlate the canonical signal into the incident domain (best-effort; failure never blocks the receipt).
    if (canonicalSignalId && canonicalType && subject) {
      try {
        const { correlateAndLinkSignal } = await import("./child-safety-incident");
        await correlateAndLinkSignal({ tenantId, protectedProfileId: subject.protectedProfileId, safetySignalId: canonicalSignalId, riskFamily: canonicalRiskFamily(canonicalType), severity: mapSeverity(env.signal), urgency: mapUrgency(env.signal, env.context), signalAt: new Date(Date.parse(env.occurredAt)), windowMs: INCIDENT_CORRELATION_WINDOW_MS, now });
      } catch { /* correlation is advisory; the accepted signal remains for reviewer surfacing */ }
    }
    await audit(tenantId, "system", "child_safety.integration.signal_accepted", inst.id, { canonical: Boolean(canonicalSignalId) });
    return R("SIGNAL_ACCEPTED", { eventId: env.eventId, receiptId: receipt.id, canonicalSignalId: canonicalSignalId ?? undefined });
  } catch {
    return R("INTERNAL_FAIL_CLOSED"); // fail-closed: never a permissive fallback, never leak internals
  }
}

// ── LOCAL SANDBOX end-to-end (sandbox-environment only; ephemeral key revoked immediately) ──
export interface SandboxSignalInput { signalType?: string; confidenceBand?: string; severityHint?: string; immediateDangerFlag?: boolean; pseudonymousSubjectId?: string; externalSignalId?: string; }
/**
 * Run the full signed loop for a SANDBOX installation: generate an EPHEMERAL Ed25519 key in-memory (private
 * key never persisted/logged), register its PUBLIC key, sign a synthetic minimal signal, submit it through
 * the real gateway, then REVOKE the ephemeral key immediately. Gated by sandbox_use AND restricted to
 * `environment = "sandbox"` applications, so it can never add a signing key to a production installation.
 */
export async function runSandboxSignal(actor: IntegrationActor, installationId: string, input: SandboxSignalInput = {}, now: Date = new Date()): Promise<{ keyVersion: number; result: GatewayResult }> {
  if (!canUseChildSafetyIntegrationSandbox(actor.role)) throw new ChildSafetyIntegrationForbiddenError("sandbox_use");
  const inst = await systemDb.childSafetyIntegrationInstallation.findFirst({ where: { id: installationId, tenantId: actor.tenantId }, include: { application: true } });
  if (!inst) throw new ChildSafetyIntegrationNotFoundError();
  if (inst.application.environment !== "sandbox") throw new ChildSafetyIntegrationStateError("sandbox_only"); // never a production installation

  // Ephemeral key (in-memory). Register the PUBLIC key internally (NOT keys_manage — this is a throwaway
  // sandbox key that is revoked seconds later), NEVER the private key.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const latest = await systemDb.childSafetyIntegrationKey.findFirst({ where: { tenantId: actor.tenantId, installationId }, orderBy: { keyVersion: "desc" }, select: { keyVersion: true } });
  const keyVersion = (latest?.keyVersion ?? 0) + 1;
  const key = await systemDb.childSafetyIntegrationKey.create({ data: { tenantId: actor.tenantId, installationId, keyVersion, algorithm: "ed25519", publicKey: publicKeyDer.toString("base64"), fingerprint: sha256hex(publicKeyDer), status: "active" } });
  await audit(actor.tenantId, actor.userId, "child_safety.integration.sandbox_key", key.id, { keyVersion });

  try {
    const iso = now.toISOString();
    const env: SignalEnvelope = {
      protocol: CHILD_SAFETY_SIGNAL_PROTOCOL, protocolVersion: CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION,
      eventId: randomUUID(), idempotencyKey: randomUUID(), partnerId: inst.partnerId, applicationId: inst.applicationId, installationId,
      occurredAt: iso, sentAt: iso, nonce: randomUUID(),
      signal: { externalSignalId: (input.externalSignalId ?? `sbx_${randomUUID().slice(0, 8)}`), signalType: input.signalType ?? "GROOMING", confidenceBand: input.confidenceBand ?? "high", ...(input.severityHint ? { severityHint: input.severityHint } : {}) },
      classification: { classifierType: "rule_engine", classifierVersion: "sandbox-1", classificationMethod: "automated", evaluatedAt: iso },
      subject: { pseudonymousSubjectId: input.pseudonymousSubjectId ?? "sandbox_subject", ageBand: "age_10_12" },
      context: { immediateDangerFlag: Boolean(input.immediateDangerFlag) },
    };
    const body = JSON.stringify(env);
    const bodyHashHex = sha256hex(body);
    const signingString = buildSigningString({ method: "POST", path: SANDBOX_GATEWAY_PATH, protocolVersion: env.protocolVersion, applicationId: env.applicationId, installationId, eventId: env.eventId, idempotencyKey: env.idempotencyKey, sentAt: env.sentAt, nonce: env.nonce, bodyHashHex });
    const signatureBase64 = edSign(null, Buffer.from(signingString, "utf8"), privateKey).toString("base64");
    // privateKey goes out of scope here — never persisted, never logged.
    const result = await processIntegrationSignal({ method: "POST", path: SANDBOX_GATEWAY_PATH, rawBody: body, signatureBase64, keyVersion, installationIdHeader: installationId }, now);
    return { keyVersion, result };
  } finally {
    // Revoke the ephemeral key IMMEDIATELY so it can never sign again.
    await systemDb.childSafetyIntegrationKey.update({ where: { id: key.id }, data: { status: "revoked", revokedAt: now } }).catch(() => {});
  }
}
const SANDBOX_GATEWAY_PATH = "/api/v1/child-safety/integrations/signals";
