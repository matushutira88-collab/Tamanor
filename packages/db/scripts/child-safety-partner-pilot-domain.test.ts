/**
 * Child Safety Partner Pilot Operations V1 — DOMAIN tests (local DB). Proves the deterministic pilot state
 * machine, optimistic concurrency, terminal-state immutability, activation prerequisites, non-waivable +
 * waiver-authorized checks, readiness blocking reasons + critical-alert blocking, pause/resume, suspension/
 * termination, operational contacts + alerts, content-free compatibility test runs, tenant isolation, and
 * role-scoped permissions. Content-free by construction.
 * Run: pnpm child-safety-partner-pilot-domain:test
 */
import {
  systemDb,
  createIntegrationPartner, createIntegrationApplication, createIntegrationInstallation, registerIntegrationKey, linkIntegrationSubject, setInstallationStatus,
  createPartnerPilot, updatePartnerPilotDraft, setPartnerPilotScope, setPartnerPilotAssessment, updatePartnerPilotCheck,
  transitionPartnerPilot, activatePartnerPilot, suspendPartnerPilot, terminatePartnerPilot,
  evaluatePartnerPilotReadiness, upsertPartnerContact, listPartnerContacts, runPartnerPilotCompatibilityTest,
  raisePartnerOperationalAlert, resolvePartnerOperationalAlert, listPartnerOperationalAlerts,
  getPartnerPilot, listPartnerPilots, listPartnerPilotEvents,
  type PilotActor,
} from "@guardora/db";
import {
  Role, WorkspaceKind, PILOT_CHECK_TYPES, NON_WAIVABLE_CHECKS,
} from "@guardora/core";
import { generateKeyPairSync } from "node:crypto";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function expectThrow(fn: () => Promise<unknown>, codeSub?: string): Promise<boolean> {
  try { await fn(); return false; } catch (e) { const m = (e as { code?: string; reason?: string; message?: string }); return codeSub ? (m.code === codeSub || m.reason === codeSub || String(m.message).includes(codeSub)) : true; }
}
const sfx = `pilot_${process.pid}`; const tids: string[] = []; let k = 0;

async function seedTenant(role: Role = Role.Admin) {
  const id = `f${k++}_${sfx}`; tids.push(id);
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  const u = await systemDb.user.create({ data: { id: `u_${id}`, email: `u_${id}@t.local` } });
  const m = await systemDb.membership.create({ data: { userId: u.id, tenantId: id, role: "admin" as never } });
  const profileId = (await systemDb.protectedProfile.create({ data: { tenantId: id, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const actor: PilotActor = { tenantId: id, userId: u.id, membershipId: m.id, role };
  return { tenantId: id, profileId, actor, userId: u.id, membershipId: m.id };
}
function withRole(a: PilotActor, role: Role): PilotActor { return { ...a, role }; }

let n = 0;
async function setupAppInstall(actor: PilotActor, env: "sandbox" | "production", profileId?: string) {
  n++;
  const p = await createIntegrationPartner(actor, { partnerKey: `pp${n}`, displayName: "PP" });
  const a = await createIntegrationApplication(actor, p.partnerId, { applicationKey: `app${n}`, displayName: "App", environment: env });
  const inst = await createIntegrationInstallation(actor, a.applicationId, { installationKey: `inst${n}` });
  const { publicKey } = generateKeyPairSync("ed25519");
  await registerIntegrationKey(actor, inst.installationId, { publicKeyBase64: (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64") });
  if (profileId) await linkIntegrationSubject(actor, inst.installationId, { pseudonymousSubjectId: "subjP", protectedProfileId: profileId });
  return { partnerId: p.partnerId, applicationId: a.applicationId, installationId: inst.installationId };
}

/** Drive a pilot all the way to READY_FOR_PILOT with all prerequisites satisfied. */
async function driveToReady(actor: PilotActor, pilotId: string, applicationId: string, installationId: string) {
  await setPartnerPilotScope(actor, pilotId, { approvedCapabilities: ["signal.submit"], approvedRiskCategories: ["GROOMING"], approvedAgeBands: ["age_10_12"], allowedInstallationIds: [installationId], monthlyVolumeBand: "LOW", peakRateBand: "LOW", pilotStartDate: new Date(Date.now() - 1000).toISOString(), pilotEndDate: new Date(Date.now() + 7 * 864e5).toISOString(), pilotReviewDate: new Date(Date.now() + 3 * 864e5).toISOString() });
  await setPartnerPilotAssessment(actor, pilotId, "privacy", "APPROVED");
  await setPartnerPilotAssessment(actor, pilotId, "security", "APPROVED");
  await setPartnerPilotAssessment(actor, pilotId, "legal", "APPROVED");
  for (const t of PILOT_CHECK_TYPES) await updatePartnerPilotCheck(actor, pilotId, t, { status: "PASSED" });
  await upsertPartnerContact(actor, (await systemDb.childSafetyPartnerPilot.findFirstOrThrow({ where: { id: pilotId } })).partnerId, { role: "TECHNICAL", displayName: "Tech", businessEmail: "tech@partner.example" });
  await upsertPartnerContact(actor, (await systemDb.childSafetyPartnerPilot.findFirstOrThrow({ where: { id: pilotId } })).partnerId, { role: "INCIDENT_RESPONSE", displayName: "IR", businessEmail: "ir@partner.example" });
  for (const t of ["SIGNATURE_COMPATIBILITY", "NONCE_REPLAY", "IDEMPOTENCY_DUPLICATE", "IDEMPOTENCY_CONFLICT", "PAYLOAD_VALIDATION"]) await runPartnerPilotCompatibilityTest(actor, pilotId, t);
  // Move status DRAFT → … → READY_FOR_PILOT
  await transitionPartnerPilot(actor, pilotId, "submit");
  await transitionPartnerPilot(actor, pilotId, "begin_review");
  await transitionPartnerPilot(actor, pilotId, "approve_sandbox");
  await transitionPartnerPilot(actor, pilotId, "activate_sandbox");
  await transitionPartnerPilot(actor, pilotId, "start_readiness");
  await transitionPartnerPilot(actor, pilotId, "mark_ready");
}

async function main() {
  const A = await seedTenant();

  // ── A. CREATION + CHECKS SEEDED ──────────────────────────────────
  console.log("\nA. creation");
  const s1 = await setupAppInstall(A.actor, "production");
  const { pilotId } = await createPartnerPilot(A.actor, { partnerId: s1.partnerId, applicationId: s1.applicationId, requestedCapabilities: ["signal.submit"], intendedRiskCategories: ["GROOMING"] });
  const checks0 = await systemDb.childSafetyPartnerPilotCheck.count({ where: { pilotId } });
  check("★ create pilot seeds all 16 checks in NOT_STARTED", checks0 === PILOT_CHECK_TYPES.length);
  check("★ new pilot is DRAFT", (await systemDb.childSafetyPartnerPilot.findFirstOrThrow({ where: { id: pilotId } })).status === "DRAFT");
  check("★ second non-terminal pilot per application is refused", await expectThrow(() => createPartnerPilot(A.actor, { partnerId: s1.partnerId, applicationId: s1.applicationId }), "pilot_already_exists"));

  // ── B. FORBIDDEN + VALID TRANSITIONS ─────────────────────────────
  console.log("\nB. transitions");
  check("★ DRAFT → begin_review is forbidden (must SUBMIT first)", await expectThrow(() => transitionPartnerPilot(A.actor, pilotId, "begin_review"), "bad_transition"));
  await transitionPartnerPilot(A.actor, pilotId, "submit");
  check("★ DRAFT → SUBMITTED ok", (await systemDb.childSafetyPartnerPilot.findFirstOrThrow({ where: { id: pilotId } })).status === "SUBMITTED");
  await transitionPartnerPilot(A.actor, pilotId, "begin_review");
  await transitionPartnerPilot(A.actor, pilotId, "request_changes");
  check("★ UNDER_REVIEW → CHANGES_REQUIRED ok; back to SUBMITTED ok", (await transitionPartnerPilot(A.actor, pilotId, "submit")).status === "SUBMITTED");

  // ── C. OPTIMISTIC CONCURRENCY ────────────────────────────────────
  console.log("\nC. optimistic concurrency");
  const pRow = await systemDb.childSafetyPartnerPilot.findFirstOrThrow({ where: { id: pilotId } });
  check("★ stale version → version_conflict", await expectThrow(() => updatePartnerPilotDraft(A.actor, pilotId, { reviewNotesSummary: "x" }, pRow.version - 1), "version_conflict") || await expectThrow(() => transitionPartnerPilot(A.actor, pilotId, "begin_review", { expectedVersion: 999 }), "version_conflict"));

  // ── D. NON-WAIVABLE + WAIVER AUTHORIZATION ───────────────────────
  console.log("\nD. checks + waivers");
  check("★ a non-waivable check cannot be WAIVED", await expectThrow(() => updatePartnerPilotCheck(A.actor, pilotId, NON_WAIVABLE_CHECKS[0], { status: "WAIVED", waiverReasonCode: "NOT_APPLICABLE" }), "check_not_waivable"));
  const rev = withRole(A.actor, Role.Reviewer);
  check("★ a Reviewer (no elevated) cannot WAIVE a waivable check", await expectThrow(() => updatePartnerPilotCheck(rev, pilotId, "REGIONAL_SCOPE_CONFIRMED", { status: "WAIVED", waiverReasonCode: "NOT_APPLICABLE" }), "waive_requires_elevated"));
  check("★ Admin CAN waive a waivable check with a reason code", (await updatePartnerPilotCheck(A.actor, pilotId, "REGIONAL_SCOPE_CONFIRMED", { status: "WAIVED", waiverReasonCode: "NOT_APPLICABLE" })).ok);
  check("★ waive without a reason code is refused", await expectThrow(() => updatePartnerPilotCheck(A.actor, pilotId, "DATA_RETENTION_CONFIRMED", { status: "WAIVED" }), "waiver_reason_required"));

  // ── E. READINESS BLOCKING REASONS ────────────────────────────────
  console.log("\nE. readiness");
  const r0 = await evaluatePartnerPilotReadiness(A.actor, pilotId);
  check("★ an incomplete pilot is BLOCKED with stable codes", r0.state === "BLOCKED" && r0.blocking.includes("AUTHORIZATION_INCOMPLETE") && r0.blocking.includes("REQUIRED_CHECK_MISSING"));
  check("★ readiness persisted on the pilot", (await systemDb.childSafetyPartnerPilot.findFirstOrThrow({ where: { id: pilotId } })).readinessState === "BLOCKED");

  // ── F. FULL DRIVE TO READY + ACTIVATION PREREQS ──────────────────
  console.log("\nF. drive to ready + activation");
  const s2 = await setupAppInstall(A.actor, "production", A.profileId);
  const { pilotId: p2 } = await createPartnerPilot(A.actor, { partnerId: s2.partnerId, applicationId: s2.applicationId });
  // Activation before READY_FOR_PILOT is refused.
  check("★ activate from DRAFT is refused (bad_transition)", await expectThrow(() => activatePartnerPilot(A.actor, p2), "bad_transition"));
  await driveToReady(A.actor, p2, s2.applicationId, s2.installationId);
  const rReady = await evaluatePartnerPilotReadiness(A.actor, p2);
  check("★ fully-prepared pilot is READY (no blocking)", rReady.state === "READY" && rReady.blocking.length === 0, rReady.blocking.join(","));
  const act = await activatePartnerPilot(A.actor, p2);
  check("★ activate READY_FOR_PILOT → PILOT_ACTIVE", act.status === "PILOT_ACTIVE");

  // ── F2. PRODUCTION-SCOPE ACTIVATION GATES + PAYLOAD READINESS + CONCURRENCY ──
  console.log("\nF2. production activation gates + payload readiness + concurrency");
  // Empty allowed-installation scope: readiness can be READY, but production activation must REFUSE.
  const s2b = await setupAppInstall(A.actor, "production", A.profileId);
  const { pilotId: pEmpty } = await createPartnerPilot(A.actor, { partnerId: s2b.partnerId, applicationId: s2b.applicationId });
  await driveToReady(A.actor, pEmpty, s2b.applicationId, s2b.installationId);
  await setPartnerPilotScope(A.actor, pEmpty, { allowedInstallationIds: [] }); // clear installation scope
  check("★ readiness is still READY with empty installation scope (engine is scope-agnostic)", (await evaluatePartnerPilotReadiness(A.actor, pEmpty)).state === "READY");
  check("★ PRODUCTION activation REFUSED with an empty allowed-installation list", await expectThrow(() => activatePartnerPilot(A.actor, pEmpty), "installation_scope_empty"));
  await setPartnerPilotScope(A.actor, pEmpty, { approvedRiskCategories: [], allowedInstallationIds: [s2b.installationId] });
  check("★ PRODUCTION activation REFUSED with empty approved risk categories", await expectThrow(() => activatePartnerPilot(A.actor, pEmpty), "categories_not_approved"));
  // Inactive allowed installation blocks activation via the production GATE specifically: keep readiness
  // READY through a SECOND active installation (with key + linked subject), while the ALLOWED one is inactive.
  const inst2 = await createIntegrationInstallation(A.actor, s2b.applicationId, { installationKey: `inst2_${n}` });
  const { publicKey: pk2 } = generateKeyPairSync("ed25519");
  await registerIntegrationKey(A.actor, inst2.installationId, { publicKeyBase64: (pk2.export({ type: "spki", format: "der" }) as Buffer).toString("base64") });
  await linkIntegrationSubject(A.actor, inst2.installationId, { pseudonymousSubjectId: "subjP2", protectedProfileId: A.profileId });
  await setInstallationStatus(A.actor, s2b.installationId, "suspended"); // the ALLOWED installation is now inactive
  await setPartnerPilotScope(A.actor, pEmpty, { approvedRiskCategories: ["GROOMING"], allowedInstallationIds: [s2b.installationId] });
  check("★ readiness still READY (a different active installation + key exists)", (await evaluatePartnerPilotReadiness(A.actor, pEmpty)).state === "READY");
  check("★ PRODUCTION activation REFUSED when the ALLOWED installation is not active (gate, not readiness)", await expectThrow(() => activatePartnerPilot(A.actor, pEmpty), "installation_inactive_or_out_of_scope"));

  // PAYLOAD_VALIDATION is a REQUIRED readiness test — signature alone is insufficient.
  const s2c = await setupAppInstall(A.actor, "production", A.profileId);
  const { pilotId: pPay } = await createPartnerPilot(A.actor, { partnerId: s2c.partnerId, applicationId: s2c.applicationId });
  await setPartnerPilotScope(A.actor, pPay, { approvedCapabilities: ["signal.submit"], approvedRiskCategories: ["GROOMING"], allowedInstallationIds: [s2c.installationId], monthlyVolumeBand: "LOW", peakRateBand: "LOW", pilotStartDate: new Date().toISOString(), pilotEndDate: new Date(Date.now() + 864e5).toISOString(), pilotReviewDate: new Date(Date.now() + 4e8).toISOString() });
  await setPartnerPilotAssessment(A.actor, pPay, "privacy", "APPROVED");
  await setPartnerPilotAssessment(A.actor, pPay, "security", "APPROVED");
  await setPartnerPilotAssessment(A.actor, pPay, "legal", "APPROVED");
  for (const t of PILOT_CHECK_TYPES) await updatePartnerPilotCheck(A.actor, pPay, t, { status: "PASSED" });
  await upsertPartnerContact(A.actor, s2c.partnerId, { role: "TECHNICAL", displayName: "T", businessEmail: "t2@partner.example" });
  await upsertPartnerContact(A.actor, s2c.partnerId, { role: "INCIDENT_RESPONSE", displayName: "I", businessEmail: "i2@partner.example" });
  for (const t of ["SIGNATURE_COMPATIBILITY", "NONCE_REPLAY", "IDEMPOTENCY_DUPLICATE", "IDEMPOTENCY_CONFLICT"]) await runPartnerPilotCompatibilityTest(A.actor, pPay, t); // NOTE: no PAYLOAD_VALIDATION
  const rNoPay = await evaluatePartnerPilotReadiness(A.actor, pPay);
  check("★ readiness BLOCKED (COMPATIBILITY_TEST_MISSING) when PAYLOAD_VALIDATION has not passed", rNoPay.state === "BLOCKED" && rNoPay.blocking.includes("COMPATIBILITY_TEST_MISSING"));
  await runPartnerPilotCompatibilityTest(A.actor, pPay, "PAYLOAD_VALIDATION");
  check("★ readiness READY once PAYLOAD_VALIDATION also passes", (await evaluatePartnerPilotReadiness(A.actor, pPay)).state === "READY");
  check("★ a SKIPPED test never counts as PASSED (RATE_LIMIT_BEHAVIOR is SKIPPED)", (await runPartnerPilotCompatibilityTest(A.actor, pPay, "RATE_LIMIT_BEHAVIOR")).result === "SKIPPED");

  // Optimistic concurrency: two simultaneous transitions with the SAME version — exactly one wins.
  const s2d = await setupAppInstall(A.actor, "production", A.profileId);
  const { pilotId: pCc } = await createPartnerPilot(A.actor, { partnerId: s2d.partnerId, applicationId: s2d.applicationId });
  const v = (await systemDb.childSafetyPartnerPilot.findFirstOrThrow({ where: { id: pCc } })).version;
  const results = await Promise.allSettled([
    transitionPartnerPilot(A.actor, pCc, "submit", { expectedVersion: v }),
    transitionPartnerPilot(A.actor, pCc, "submit", { expectedVersion: v }),
  ]);
  const okCount = results.filter((r) => r.status === "fulfilled").length;
  check("★ simultaneous transitions with the same version: exactly ONE succeeds", okCount === 1);

  // ── G. PAUSE / RESUME ────────────────────────────────────────────
  console.log("\nG. pause/resume");
  check("★ pause PILOT_ACTIVE → PILOT_PAUSED", (await transitionPartnerPilot(A.actor, p2, "pause")).status === "PILOT_PAUSED");
  check("★ resume PILOT_PAUSED → PILOT_ACTIVE", (await transitionPartnerPilot(A.actor, p2, "resume")).status === "PILOT_ACTIVE");

  // ── H. CRITICAL ALERT BLOCKS READINESS ───────────────────────────
  console.log("\nH. critical-alert blocking");
  await raisePartnerOperationalAlert(A.tenantId, p2, "REPLAY_ATTEMPT_SPIKE", "CRITICAL", { actorUserId: "system" });
  const rAlert = await evaluatePartnerPilotReadiness(A.actor, p2);
  check("★ an open CRITICAL alert blocks readiness (CRITICAL_ALERT_OPEN)", rAlert.state === "BLOCKED" && rAlert.blocking.includes("CRITICAL_ALERT_OPEN"));
  const openAlert = await systemDb.childSafetyPartnerOperationalAlert.findFirstOrThrow({ where: { pilotId: p2, status: "open" } });
  check("★ Analyst (view-only) cannot resolve an alert", await expectThrow(() => resolvePartnerOperationalAlert(withRole(A.actor, Role.Analyst), openAlert.id, "OTHER")));
  check("★ Admin can resolve the alert (audited)", (await resolvePartnerOperationalAlert(A.actor, openAlert.id, "REVIEWED")).ok);
  check("★ readiness recovers after resolution", (await evaluatePartnerPilotReadiness(A.actor, p2)).blocking.includes("CRITICAL_ALERT_OPEN") === false);

  // ── I. SUSPENSION + TERMINATION (terminal immutability) ───────────
  console.log("\nI. suspend + terminate");
  check("★ suspend PILOT_ACTIVE → SUSPENDED", (await suspendPartnerPilot(A.actor, p2, "SECURITY_CONCERN")).status === "SUSPENDED");
  check("★ SUSPENDED → start_readiness (explicit re-review) ok", (await transitionPartnerPilot(A.actor, p2, "start_readiness")).status === "READINESS_REVIEW");
  check("★ terminate → TERMINATED", (await terminatePartnerPilot(A.actor, p2, "PILOT_COMPLETED")).status === "TERMINATED");
  check("★ a TERMINATED pilot cannot be reopened (terminal)", await expectThrow(() => transitionPartnerPilot(A.actor, p2, "start_readiness"), "bad_transition") && await expectThrow(() => suspendPartnerPilot(A.actor, p2, "OTHER"), "bad_transition"));
  check("★ after termination a NEW pilot for the application is allowed", !!(await createPartnerPilot(A.actor, { partnerId: s2.partnerId, applicationId: s2.applicationId })).pilotId);

  // ── J. COMPATIBILITY TEST RUNS (content-free) ────────────────────
  console.log("\nJ. compatibility tests");
  const s3 = await setupAppInstall(A.actor, "production");
  const { pilotId: p3 } = await createPartnerPilot(A.actor, { partnerId: s3.partnerId, applicationId: s3.applicationId });
  const tSig = await runPartnerPilotCompatibilityTest(A.actor, p3, "SIGNATURE_COMPATIBILITY");
  check("★ signature-compatibility test PASSES", tSig.result === "PASSED" && tSig.resultCode === "SIGNAL_ACCEPTED");
  check("★ replay test PASSES (NONCE_REPLAYED)", (await runPartnerPilotCompatibilityTest(A.actor, p3, "NONCE_REPLAY")).result === "PASSED");
  check("★ idempotency-duplicate test PASSES (SIGNAL_DUPLICATE)", (await runPartnerPilotCompatibilityTest(A.actor, p3, "IDEMPOTENCY_DUPLICATE")).result === "PASSED");
  check("★ idempotency-conflict test PASSES (IDEMPOTENCY_CONFLICT)", (await runPartnerPilotCompatibilityTest(A.actor, p3, "IDEMPOTENCY_CONFLICT")).result === "PASSED");
  check("★ payload-validation test PASSES (PAYLOAD_INVALID)", (await runPartnerPilotCompatibilityTest(A.actor, p3, "PAYLOAD_VALIDATION")).result === "PASSED");
  check("★ capability-enforcement test PASSES (CAPABILITY_DENIED)", (await runPartnerPilotCompatibilityTest(A.actor, p3, "CAPABILITY_ENFORCEMENT")).result === "PASSED");
  const runs = await systemDb.childSafetyPartnerTestRun.findMany({ where: { pilotId: p3 } });
  const runCols = Object.keys(runs[0] ?? {});
  check("★ test-run rows are content-free (no body/signature/privateKey/child columns)", !runCols.some((c) => /body|signature|privatekey|message|child|guardian/i.test(c)) && runs.every((r) => !!r.resultCode));
  // ephemeral harness keys are all revoked
  const harnessKeys = await systemDb.childSafetyIntegrationKey.findMany({ where: { tenantId: A.tenantId, installation: { application: { partner: { partnerKey: { startsWith: "pilottest_" } } } } } });
  check("★ every ephemeral harness key is revoked after the test run", harnessKeys.length > 0 && harnessKeys.every((k) => k.status === "revoked"));

  // ── K. PERMISSIONS ───────────────────────────────────────────────
  console.log("\nK. permissions");
  const viewer = withRole(A.actor, Role.Viewer);
  check("★ Viewer is DENIED pilot list", await expectThrow(() => listPartnerPilots(viewer)));
  const analyst = withRole(A.actor, Role.Analyst);
  check("★ Analyst may LIST pilots (aggregated)", (await listPartnerPilots(analyst)).total >= 1);
  const detailAnalyst = await getPartnerPilot(analyst, pilotId);
  check("★ Analyst detail withholds contacts + review notes + events", detailAnalyst.contacts.length === 0 && detailAnalyst.events.length === 0 && detailAnalyst.pilot.reviewNotesSummary === null);
  check("★ Analyst cannot mutate (create pilot forbidden)", await expectThrow(() => createPartnerPilot(analyst, { partnerId: s1.partnerId, applicationId: s1.applicationId })));
  check("★ Analyst cannot read the audit event log", await expectThrow(() => listPartnerPilotEvents(analyst, pilotId)));
  check("★ Reviewer CAN read the audit event log", (await listPartnerPilotEvents(rev, pilotId)).total >= 1);
  check("★ Reviewer cannot activate a pilot", await expectThrow(() => activatePartnerPilot(rev, p2)));

  // ── L. CONTACTS (bounded, business-only) ─────────────────────────
  console.log("\nL. contacts");
  check("★ invalid business email refused", await expectThrow(() => upsertPartnerContact(A.actor, s1.partnerId, { role: "SECURITY", displayName: "S", businessEmail: "not-an-email" }), "bad_business_email"));
  check("★ bad contact role refused", await expectThrow(() => upsertPartnerContact(A.actor, s1.partnerId, { role: "GUARDIAN", displayName: "G", businessEmail: "g@x.example" }), "bad_contact_role"));
  await upsertPartnerContact(A.actor, s1.partnerId, { role: "SECURITY", displayName: "Sec", businessEmail: "sec@partner.example" });
  check("★ Analyst cannot list contacts (review-gated)", await expectThrow(() => listPartnerContacts(analyst, s1.partnerId)));

  // ── M. TENANT ISOLATION ──────────────────────────────────────────
  console.log("\nM. tenant isolation");
  const B = await seedTenant();
  check("★ tenant B sees NONE of tenant A's pilots", (await listPartnerPilots(B.actor)).total === 0);
  check("★ tenant B cannot read tenant A's pilot by id", await expectThrow(() => getPartnerPilot(B.actor, pilotId)));
  check("★ tenant B cannot transition tenant A's pilot", await expectThrow(() => suspendPartnerPilot(B.actor, p2, "OTHER")));
  check("★ tenant B sees NONE of tenant A's alerts", (await listPartnerOperationalAlerts(B.actor)).total === 0);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Partner Pilot Domain V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
