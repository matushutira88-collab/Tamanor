/**
 * Child Safety Partner Pilot Operations V1 — GATEWAY ENFORCEMENT tests (local DB). Proves that the signal
 * gateway enforces an ACTIVE authorized pilot for PRODUCTION installations (fail-closed + non-enumerating),
 * leaves SANDBOX behavior unchanged, and never weakens the existing signature/replay/idempotency checks.
 * Run: pnpm child-safety-partner-pilot-gateway:test
 */
import { createHash, generateKeyPairSync, sign as edSign, type KeyObject } from "node:crypto";
import {
  systemDb,
  createIntegrationPartner, createIntegrationApplication, createIntegrationInstallation, registerIntegrationKey, linkIntegrationSubject,
  processIntegrationSignal,
  createPartnerPilot, setPartnerPilotScope, setPartnerPilotAssessment, updatePartnerPilotCheck, upsertPartnerContact,
  runPartnerPilotCompatibilityTest, transitionPartnerPilot, activatePartnerPilot, suspendPartnerPilot, terminatePartnerPilot,
  type PilotActor,
} from "@guardora/db";
import { Role, WorkspaceKind, buildSigningString, CHILD_SAFETY_SIGNAL_PROTOCOL, CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION, PILOT_CHECK_TYPES } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `pgw_${process.pid}`; const tids: string[] = []; let k = 0;
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const PATH = "/api/v1/child-safety/integrations/signals";
let n = 0, ev = 0;

async function seedTenant() {
  const id = `f${k++}_${sfx}`; tids.push(id);
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  const u = await systemDb.user.create({ data: { id: `u_${id}`, email: `u_${id}@t.local` } });
  const m = await systemDb.membership.create({ data: { userId: u.id, tenantId: id, role: "admin" as never } });
  const profileId = (await systemDb.protectedProfile.create({ data: { tenantId: id, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  return { tenantId: id, profileId, actor: { tenantId: id, userId: u.id, membershipId: m.id, role: Role.Admin } as PilotActor };
}

interface Inst { partnerId: string; applicationId: string; installationId: string; keyVersion: number; privateKey: KeyObject; }
async function makeInstallation(actor: PilotActor, partnerId: string, applicationId: string, subjectProfileId?: string): Promise<Inst> {
  n++;
  const inst = await createIntegrationInstallation(actor, applicationId, { installationKey: `pi${n}` });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = await registerIntegrationKey(actor, inst.installationId, { publicKeyBase64: (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64") });
  if (subjectProfileId) await linkIntegrationSubject(actor, inst.installationId, { pseudonymousSubjectId: "subjG", protectedProfileId: subjectProfileId });
  return { partnerId, applicationId, installationId: inst.installationId, keyVersion: key.keyVersion, privateKey };
}
async function makeApp(actor: PilotActor, env: "sandbox" | "production") {
  n++;
  const p = await createIntegrationPartner(actor, { partnerKey: `pgp${n}`, displayName: "PG" });
  const a = await createIntegrationApplication(actor, p.partnerId, { applicationKey: `pga${n}`, displayName: "App", environment: env });
  return { partnerId: p.partnerId, applicationId: a.applicationId };
}
function submit(inst: Inst, o: { signalType?: string; ageBand?: string; subject?: string; tamperSig?: boolean; nonce?: string; idem?: string; event?: string; sentAt?: string } = {}, now = new Date()) {
  ev++;
  const iso = o.sentAt ?? now.toISOString();
  const env = {
    protocol: CHILD_SAFETY_SIGNAL_PROTOCOL, protocolVersion: CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION, eventId: o.event ?? `pev${ev}`, idempotencyKey: o.idem ?? `pidem${ev}`,
    partnerId: inst.partnerId, applicationId: inst.applicationId, installationId: inst.installationId, occurredAt: iso, sentAt: iso, nonce: o.nonce ?? `pn${ev}`,
    signal: { externalSignalId: `pext${ev}`, signalType: o.signalType ?? "GROOMING", confidenceBand: "high" },
    classification: { classifierType: "ml_model", classifierVersion: "1.0", classificationMethod: "automated", evaluatedAt: iso },
    subject: { pseudonymousSubjectId: o.subject ?? "subjG", ageBand: o.ageBand ?? "age_10_12" },
    context: { immediateDangerFlag: false },
  };
  const body = JSON.stringify(env);
  const ss = buildSigningString({ method: "POST", path: PATH, protocolVersion: env.protocolVersion, applicationId: env.applicationId, installationId: env.installationId, eventId: env.eventId, idempotencyKey: env.idempotencyKey, sentAt: env.sentAt, nonce: env.nonce, bodyHashHex: sha(body) });
  let sig: string | null = edSign(null, Buffer.from(ss, "utf8"), inst.privateKey).toString("base64");
  if (o.tamperSig) sig = Buffer.from("z".repeat(64)).toString("base64");
  return processIntegrationSignal({ method: "POST", path: PATH, rawBody: body, signatureBase64: sig, keyVersion: inst.keyVersion, installationIdHeader: env.installationId }, now);
}

async function activatePilotFor(actor: PilotActor, partnerId: string, applicationId: string, allowedInstall: string, over: { categories?: string[]; ageBands?: string[]; end?: string; start?: string } = {}) {
  const { pilotId } = await createPartnerPilot(actor, { partnerId, applicationId });
  await setPartnerPilotScope(actor, pilotId, { approvedCapabilities: ["signal.submit"], approvedRiskCategories: over.categories ?? ["GROOMING"], approvedAgeBands: over.ageBands ?? ["age_10_12"], allowedInstallationIds: [allowedInstall], monthlyVolumeBand: "LOW", peakRateBand: "HIGH", pilotStartDate: over.start ?? new Date(Date.now() - 1000).toISOString(), pilotEndDate: over.end ?? new Date(Date.now() + 7 * 864e5).toISOString(), pilotReviewDate: new Date(Date.now() + 3 * 864e5).toISOString() });
  await setPartnerPilotAssessment(actor, pilotId, "privacy", "APPROVED");
  await setPartnerPilotAssessment(actor, pilotId, "security", "APPROVED");
  await setPartnerPilotAssessment(actor, pilotId, "legal", "APPROVED");
  for (const t of PILOT_CHECK_TYPES) await updatePartnerPilotCheck(actor, pilotId, t, { status: "PASSED" });
  await upsertPartnerContact(actor, partnerId, { role: "TECHNICAL", displayName: "T", businessEmail: "t@p.example" });
  await upsertPartnerContact(actor, partnerId, { role: "INCIDENT_RESPONSE", displayName: "I", businessEmail: "i@p.example" });
  for (const t of ["SIGNATURE_COMPATIBILITY", "NONCE_REPLAY", "IDEMPOTENCY_DUPLICATE", "IDEMPOTENCY_CONFLICT", "PAYLOAD_VALIDATION"]) await runPartnerPilotCompatibilityTest(actor, pilotId, t);
  for (const a of ["submit", "begin_review", "approve_sandbox", "activate_sandbox", "start_readiness", "mark_ready"] as const) await transitionPartnerPilot(actor, pilotId, a);
  await activatePartnerPilot(actor, pilotId);
  return pilotId;
}

async function main() {
  const A = await seedTenant();
  const now = new Date();

  // ── A. SANDBOX UNCHANGED (no pilot required) ─────────────────────
  console.log("\nA. sandbox unchanged");
  const sbxApp = await makeApp(A.actor, "sandbox");
  const sbxInst = await makeInstallation(A.actor, sbxApp.partnerId, sbxApp.applicationId, A.profileId);
  check("★ SANDBOX installation with NO pilot still ACCEPTS a signed signal", (await submit(sbxInst)).code === "SIGNAL_ACCEPTED");

  // ── B. PRODUCTION REQUIRES AN ACTIVE PILOT ───────────────────────
  console.log("\nB. production requires an active pilot");
  const prodApp = await makeApp(A.actor, "production");
  const prodInst = await makeInstallation(A.actor, prodApp.partnerId, prodApp.applicationId, A.profileId);
  const noPilot = await submit(prodInst);
  check("★ PRODUCTION with NO pilot → INTEGRATION_SUSPENDED (403), fail-closed", noPilot.code === "INTEGRATION_SUSPENDED" && noPilot.httpStatus === 403);

  const pilotId = await activatePilotFor(A.actor, prodApp.partnerId, prodApp.applicationId, prodInst.installationId);
  const accepted = await submit(prodInst);
  check("★ PRODUCTION with an ACTIVE in-scope pilot → SIGNAL_ACCEPTED", accepted.code === "SIGNAL_ACCEPTED");

  // ── C. NON-ACTIVE PILOT STATES FAIL CLOSED (uniform, non-enumerating) ──
  console.log("\nC. non-active pilot states fail closed");
  const p = await systemDb.childSafetyPartnerPilot.findFirstOrThrow({ where: { id: pilotId } });
  await transitionPartnerPilot(A.actor, pilotId, "pause", { expectedVersion: p.version });
  const paused = await submit(prodInst);
  check("★ PAUSED pilot → INTEGRATION_SUSPENDED", paused.code === "INTEGRATION_SUSPENDED");
  await transitionPartnerPilot(A.actor, pilotId, "resume");
  check("★ RESUMED pilot accepts again", (await submit(prodInst)).code === "SIGNAL_ACCEPTED");
  await suspendPartnerPilot(A.actor, pilotId, "SECURITY_CONCERN");
  check("★ SUSPENDED pilot → INTEGRATION_SUSPENDED (signal acceptance immediately stopped)", (await submit(prodInst)).code === "INTEGRATION_SUSPENDED");
  await terminatePartnerPilot(A.actor, pilotId, "PILOT_COMPLETED");
  check("★ TERMINATED pilot → INTEGRATION_SUSPENDED", (await submit(prodInst)).code === "INTEGRATION_SUSPENDED");
  // Non-enumeration: missing-pilot, suspended, terminated all return the SAME code.
  check("★ missing / suspended / terminated all return the SAME non-enumerating code", noPilot.code === "INTEGRATION_SUSPENDED" && paused.code === "INTEGRATION_SUSPENDED");

  // ── D. EXPIRED PILOT ─────────────────────────────────────────────
  console.log("\nD. expired pilot");
  const expApp = await makeApp(A.actor, "production");
  const expInst = await makeInstallation(A.actor, expApp.partnerId, expApp.applicationId, A.profileId);
  await activatePilotFor(A.actor, expApp.partnerId, expApp.applicationId, expInst.installationId, { end: new Date(Date.now() - 864e5).toISOString(), start: new Date(Date.now() - 2 * 864e5).toISOString() });
  check("★ EXPIRED pilot (end date passed) → INTEGRATION_SUSPENDED", (await submit(expInst)).code === "INTEGRATION_SUSPENDED");

  // ── E. SCOPE ENFORCEMENT ─────────────────────────────────────────
  console.log("\nE. scope enforcement");
  const scApp = await makeApp(A.actor, "production");
  const scInst = await makeInstallation(A.actor, scApp.partnerId, scApp.applicationId, A.profileId);
  const scOther = await makeInstallation(A.actor, scApp.partnerId, scApp.applicationId, A.profileId); // same app, NOT in scope
  const scPilot = await activatePilotFor(A.actor, scApp.partnerId, scApp.applicationId, scInst.installationId, { categories: ["GROOMING"], ageBands: ["age_10_12"] });
  check("★ in-scope installation accepted", (await submit(scInst)).code === "SIGNAL_ACCEPTED");
  check("★ installation OUTSIDE the pilot scope → INTEGRATION_SUSPENDED", (await submit(scOther)).code === "INTEGRATION_SUSPENDED");
  check("★ risk category OUTSIDE approved scope → INTEGRATION_SUSPENDED", (await submit(scInst, { signalType: "SEXTORTION", nonce: `nc${ev}x` })).code === "INTEGRATION_SUSPENDED");
  check("★ age band OUTSIDE approved scope → INTEGRATION_SUSPENDED", (await submit(scInst, { ageBand: "age_16_17", nonce: `na${ev}x` })).code === "INTEGRATION_SUSPENDED");
  // capability out of scope: remove signal.submit post-activation
  await setPartnerPilotScope(A.actor, scPilot, { approvedCapabilities: ["signal.sandbox"] });
  check("★ capability OUTSIDE approved scope → INTEGRATION_SUSPENDED", (await submit(scInst, { nonce: `ncap${ev}x` })).code === "INTEGRATION_SUSPENDED");
  // A scope violation raised a content-free operational alert.
  const scopeAlerts = await systemDb.childSafetyPartnerOperationalAlert.findMany({ where: { pilotId: scPilot, alertType: "PILOT_SCOPE_VIOLATION" } });
  check("★ scope violations recorded a content-free PILOT_SCOPE_VIOLATION alert", scopeAlerts.length >= 1 && scopeAlerts.every((a) => !("body" in a) && a.count >= 1));

  // ── F. PILOT LAYER NEVER WEAKENS EXISTING CHECKS ─────────────────
  console.log("\nF. existing checks unchanged");
  const secApp = await makeApp(A.actor, "production");
  const secInst = await makeInstallation(A.actor, secApp.partnerId, secApp.applicationId, A.profileId);
  await activatePilotFor(A.actor, secApp.partnerId, secApp.applicationId, secInst.installationId);
  check("★ tampered signature on a PRODUCTION+active-pilot request → SIGNATURE_INVALID (pilot layer runs AFTER auth)", (await submit(secInst, { tamperSig: true })).code === "SIGNATURE_INVALID");
  const first = await submit(secInst, { nonce: `rp${ev}`, idem: `ri${ev}`, event: `re${ev}` });
  check("★ valid accepted", first.code === "SIGNAL_ACCEPTED");
  const replay = await submit(secInst, { nonce: `rp${ev - 1}`, idem: `ri2_${ev}`, event: `re2_${ev}` });
  check("★ replay still blocked under an active pilot (NONCE_REPLAYED)", replay.code === "NONCE_REPLAYED" || replay.code === "SIGNAL_DUPLICATE");
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Partner Pilot Gateway V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
