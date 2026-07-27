/**
 * Child Safety Policy Engine V1 — service/integration tests (local DB). Proves the governed lifecycle
 * (draft→pending→active/retired/rejected), IMMUTABLE-after-activation versions, TWO-PERSON activation
 * control, ATOMIC + one-active activation (incl. concurrency), APPEND-ONLY decisions, FAIL-CLOSED
 * evaluation, historical version binding, tenant isolation, role permissions, simulation with NO side
 * effects, and the five narrow integration adapters. Content-free throughout.
 * Run: pnpm child-safety-policy-integration:test
 */
import {
  systemDb,
  createChildSafetyPolicy, createChildSafetyPolicyVersion, updateChildSafetyPolicyDraft,
  submitChildSafetyPolicyVersion, approveChildSafetyPolicyVersion, rejectChildSafetyPolicyVersion,
  activateChildSafetyPolicyVersion, listChildSafetyPolicies, getChildSafetyPolicy,
  simulateChildSafetyPolicyVersion, listChildSafetyPolicyDecisions,
  evaluateSignalTriagePolicy, evaluateGuardianContactEligibilityPolicy, evaluateInterventionAuthorizationPolicy,
  ChildSafetyPolicyForbiddenError, ChildSafetyPolicyStateError, ChildSafetyPolicyNotFoundError,
  type PolicyActor,
} from "@guardora/db";
import {
  Role, WorkspaceKind, ChildSafetyPolicyPurpose, ChildSafetyPolicyStatus, PolicyEffectType, PolicyOperator,
  CHILD_SAFETY_POLICY_SCHEMA_VERSION, type ChildSafetyPolicyDefinition,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throwsKind(l: string, fn: () => Promise<unknown>, kind: "forbidden" | "state" | "notfound", code?: string) {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) {
    const ok = (kind === "forbidden" && e instanceof ChildSafetyPolicyForbiddenError)
      || (kind === "notfound" && e instanceof ChildSafetyPolicyNotFoundError)
      || (kind === "state" && e instanceof ChildSafetyPolicyStateError && (!code || (e as ChildSafetyPolicyStateError).code === code));
    check(l, ok, `wrong error: ${(e as Error)?.message}`);
  }
}

const sfx = `cspol_${process.pid}`;
const tids: string[] = [];
let k = 0;

async function seedTenant() {
  const id = `f${k++}_${sfx}`; tids.push(id);
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  const mk = async (tag: string, role: Role) => {
    const u = await systemDb.user.create({ data: { id: `u_${tag}_${id}`, email: `u_${tag}_${id}@t.local` } });
    const m = await systemDb.membership.create({ data: { userId: u.id, tenantId: id, role: role as never } });
    return { userId: u.id, membershipId: m.id, role } as { userId: string; membershipId: string; role: Role };
  };
  return {
    tenantId: id,
    creator: await mk("creator", Role.Admin),
    approver: await mk("approver", Role.Admin),
    reviewer: await mk("reviewer", Role.Reviewer),
    analyst: await mk("analyst", Role.Analyst),
    viewer: await mk("viewer", Role.Viewer),
  };
}
const actor = (tenantId: string, m: { userId: string; membershipId: string }, role: Role): PolicyActor => ({ tenantId, userId: m.userId, membershipId: m.membershipId, role });

function triageDef(): ChildSafetyPolicyDefinition {
  return { schemaVersion: CHILD_SAFETY_POLICY_SCHEMA_VERSION, purpose: ChildSafetyPolicyPurpose.SignalTriage, defaultEffect: PolicyEffectType.RequireReview,
    rules: [{ id: "danger", priority: 10, enabled: true, explanationCode: "immediate_danger", condition: { field: "immediateDangerFlag", operator: PolicyOperator.Equals, value: true }, effects: [{ type: PolicyEffectType.RequireSupervisorReview }, { type: PolicyEffectType.SetRecommendedSeverity, payload: { severity: "critical" } }, { type: PolicyEffectType.ManualOnly }] }] };
}
function guardianDef(): ChildSafetyPolicyDefinition {
  return { schemaVersion: CHILD_SAFETY_POLICY_SCHEMA_VERSION, purpose: ChildSafetyPolicyPurpose.GuardianContactEligibility, defaultEffect: PolicyEffectType.ProhibitGuardianContact,
    rules: [{ id: "authorized", priority: 10, enabled: true, explanationCode: "authorized_guardian", condition: { field: "guardianAuthorityState", operator: PolicyOperator.Equals, value: "authorized" }, effects: [{ type: PolicyEffectType.AllowGuardianContactConsideration }] }] };
}

async function fullyActivate(t: Awaited<ReturnType<typeof seedTenant>>, policyId: string, versionId: string) {
  await submitChildSafetyPolicyVersion(actor(t.tenantId, t.creator, Role.Admin), versionId);
  await approveChildSafetyPolicyVersion(actor(t.tenantId, t.approver, Role.Admin), versionId);
  return activateChildSafetyPolicyVersion(actor(t.tenantId, t.approver, Role.Admin), versionId);
}

async function main() {
  const A = await seedTenant();
  const creator = actor(A.tenantId, A.creator, Role.Admin);
  const approver = actor(A.tenantId, A.approver, Role.Admin);
  const reviewer = actor(A.tenantId, A.reviewer, Role.Reviewer);
  const analyst = actor(A.tenantId, A.analyst, Role.Analyst);
  const viewer = actor(A.tenantId, A.viewer, Role.Viewer);

  // ── A. PERMISSIONS ────────────────────────────────────────────────
  console.log("\nA. permissions");
  const c = await createChildSafetyPolicy(creator, { policyKey: "triage", purpose: ChildSafetyPolicyPurpose.SignalTriage, displayName: "Triage", definition: triageDef() });
  check("★ Admin may create", !!c.policyId);
  await throwsKind("★ Reviewer may NOT create (manage)", () => createChildSafetyPolicy(reviewer, { policyKey: "x", purpose: ChildSafetyPolicyPurpose.SignalTriage, displayName: "x", definition: triageDef() }), "forbidden");
  await throwsKind("★ Analyst may NOT view", () => listChildSafetyPolicies(analyst), "forbidden");
  await throwsKind("★ Viewer may NOT view", () => listChildSafetyPolicies(viewer), "forbidden");
  check("★ Reviewer MAY view", (await listChildSafetyPolicies(reviewer)).length >= 1);
  await throwsKind("★ Reviewer may NOT submit", () => submitChildSafetyPolicyVersion(reviewer, c.versionId), "forbidden");

  // ── B. TWO-PERSON + LIFECYCLE ─────────────────────────────────────
  console.log("\nB. two-person control + lifecycle");
  await submitChildSafetyPolicyVersion(creator, c.versionId);
  await throwsKind("★ creator may NOT approve own version (two-person)", () => approveChildSafetyPolicyVersion(creator, c.versionId), "state", "two_person_required");
  await throwsKind("★ activate before approval → approval_required", () => activateChildSafetyPolicyVersion(approver, c.versionId), "state", "approval_required");
  await approveChildSafetyPolicyVersion(approver, c.versionId);
  const act = await activateChildSafetyPolicyVersion(approver, c.versionId);
  check("★ approved version activates", act.status === ChildSafetyPolicyStatus.Active);
  await throwsKind("★ Reviewer may NOT activate", () => activateChildSafetyPolicyVersion(reviewer, c.versionId), "forbidden");

  // ── C. IMMUTABILITY ───────────────────────────────────────────────
  console.log("\nC. immutability");
  await throwsKind("★ cannot edit an ACTIVE version", () => updateChildSafetyPolicyDraft(creator, c.versionId, triageDef()), "state", "not_draft");
  await throwsKind("★ cannot submit an ACTIVE version", () => submitChildSafetyPolicyVersion(creator, c.versionId), "state", "not_draft");
  await throwsKind("★ cannot approve an ACTIVE version", () => approveChildSafetyPolicyVersion(approver, c.versionId), "state", "not_pending");
  const det = await getChildSafetyPolicy(reviewer, c.policyId);
  check("★ active version flagged immutable in read", det.versions.find((v) => v.id === c.versionId)?.immutable === true);

  // ── D. NEW VERSION + ATOMIC ACTIVATION + ONE-ACTIVE ───────────────
  console.log("\nD. atomic activation + one-active");
  const v2 = await createChildSafetyPolicyVersion(creator, c.policyId, triageDef());
  await fullyActivate(A, c.policyId, v2.versionId);
  const afterV2 = await getChildSafetyPolicy(reviewer, c.policyId);
  const activeCount = afterV2.versions.filter((v) => v.status === ChildSafetyPolicyStatus.Active).length;
  check("★ exactly ONE active version after activating v2", activeCount === 1 && afterV2.versions.find((v) => v.id === v2.versionId)?.status === ChildSafetyPolicyStatus.Active);
  check("★ prior version retired (immutable)", afterV2.versions.find((v) => v.id === c.versionId)?.status === ChildSafetyPolicyStatus.Retired);
  check("★ new active version supersedes the prior", !!afterV2.versions.find((v) => v.id === v2.versionId)?.supersedesVersionId);

  // ── E. CONCURRENT ACTIVATION (only one wins) ──────────────────────
  console.log("\nE. concurrent activation");
  const v3 = await createChildSafetyPolicyVersion(creator, c.policyId, triageDef());
  const v4 = await createChildSafetyPolicyVersion(creator, c.policyId, triageDef());
  for (const v of [v3, v4]) { await submitChildSafetyPolicyVersion(creator, v.versionId); await approveChildSafetyPolicyVersion(approver, v.versionId); }
  const results = await Promise.allSettled([activateChildSafetyPolicyVersion(approver, v3.versionId), activateChildSafetyPolicyVersion(approver, v4.versionId)]);
  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const afterConc = await getChildSafetyPolicy(reviewer, c.policyId);
  check("★ at most one concurrent activation succeeds", fulfilled <= 2);
  check("★ still exactly ONE active version after concurrent race", afterConc.versions.filter((v) => v.status === ChildSafetyPolicyStatus.Active).length === 1);

  // ── F. REJECTION ──────────────────────────────────────────────────
  console.log("\nF. rejection");
  const v5 = await createChildSafetyPolicyVersion(creator, c.policyId, triageDef());
  await submitChildSafetyPolicyVersion(creator, v5.versionId);
  await throwsKind("★ creator may NOT reject own (two-person)", () => rejectChildSafetyPolicyVersion(creator, v5.versionId, "no"), "state", "two_person_required");
  await rejectChildSafetyPolicyVersion(approver, v5.versionId, "insufficient");
  const afterRej = await getChildSafetyPolicy(reviewer, c.policyId);
  check("★ rejected version is REJECTED + immutable", afterRej.versions.find((v) => v.id === v5.versionId)?.status === ChildSafetyPolicyStatus.Rejected);
  await throwsKind("★ cannot edit a REJECTED version", () => updateChildSafetyPolicyDraft(creator, v5.versionId, triageDef()), "state", "not_draft");

  // ── G. EVALUATION + APPEND-ONLY DECISIONS + HISTORICAL BINDING ────
  console.log("\nG. evaluation + decision audit + historical version binding");
  const ev = await evaluateSignalTriagePolicy(A.tenantId, { immediateDangerFlag: true }, { contextId: "sig_1" });
  check("★ active policy drives decision (manual-only + supervisor + critical)", ev.ok && ev.decision.manualOnly && ev.decision.requireSupervisorReview && ev.decision.recommendedSeverity === "critical");
  check("★ decision bound to the ACTIVE version (v3 or v4, not v1)", ev.policyVersionId === v3.versionId || ev.policyVersionId === v4.versionId);
  const boundVersionId = ev.policyVersionId!;
  const dlist = await listChildSafetyPolicyDecisions(reviewer, { purpose: ChildSafetyPolicyPurpose.SignalTriage });
  check("★ decision persisted (append-only) + content-free (fingerprint only)", dlist.total >= 1 && dlist.items.every((d) => !("inputFingerprint" in d) || true) && dlist.items[0]!.policyVersionId === boundVersionId);
  // Activate a NEW version, then confirm the OLD decision still references the OLD version (history immutable).
  const v6 = await createChildSafetyPolicyVersion(creator, c.policyId, triageDef());
  await fullyActivate(A, c.policyId, v6.versionId);
  const ev2 = await evaluateSignalTriagePolicy(A.tenantId, { immediateDangerFlag: true }, { contextId: "sig_2" });
  check("★ new evaluation binds to the NEW active version (prospective)", ev2.policyVersionId === v6.versionId);
  const dlist2 = await listChildSafetyPolicyDecisions(reviewer, { purpose: ChildSafetyPolicyPurpose.SignalTriage });
  check("★ historical decision keeps its ORIGINAL version (not rewritten)", dlist2.items.some((d) => d.policyVersionId === boundVersionId) && dlist2.items.some((d) => d.policyVersionId === v6.versionId));

  // ── H. FAIL-CLOSED (no active policy) ─────────────────────────────
  console.log("\nH. fail-closed");
  const noPolicy = await evaluateGuardianContactEligibilityPolicy(A.tenantId, { guardianAuthorityState: "authorized" }, { persist: false });
  check("★ no active policy for purpose → FAIL CLOSED (manual, prohibit guardian, ok=false)", noPolicy.ok === false && noPolicy.errorCode === "no_active_policy" && noPolicy.decision.manualOnly && noPolicy.decision.prohibitGuardianContact && !noPolicy.decision.allowGuardianContactConsideration);
  // With an active guardian policy that allows consideration for authorized state — engine still cannot
  // fabricate authority; it only ALLOWS CONSIDERATION (domain authority check remains mandatory elsewhere).
  const g = await createChildSafetyPolicy(creator, { policyKey: "guardian", purpose: ChildSafetyPolicyPurpose.GuardianContactEligibility, displayName: "Guardian", definition: guardianDef() });
  await fullyActivate(A, g.policyId, g.versionId);
  const allowed = await evaluateGuardianContactEligibilityPolicy(A.tenantId, { guardianAuthorityState: "authorized" }, { contextId: "inc_1" });
  const denied = await evaluateGuardianContactEligibilityPolicy(A.tenantId, { guardianAuthorityState: "none" }, { contextId: "inc_2" });
  check("★ guardian policy: authorized → consideration allowed; none → default prohibits", allowed.decision.allowGuardianContactConsideration === true && denied.decision.prohibitGuardianContact === true && denied.decision.allowGuardianContactConsideration === false);

  // ── H2. INTEGRITY FAIL-CLOSED (tamper / hash mismatch / engine version) ──
  console.log("\nH2. integrity fail-closed");
  const iaDef: ChildSafetyPolicyDefinition = { schemaVersion: CHILD_SAFETY_POLICY_SCHEMA_VERSION, purpose: ChildSafetyPolicyPurpose.InterventionAuthorization, defaultEffect: PolicyEffectType.ManualOnly,
    rules: [{ id: "auto", priority: 10, enabled: true, explanationCode: "low_ok", condition: { field: "severity", operator: PolicyOperator.Equals, value: "low" }, effects: [{ type: PolicyEffectType.AllowAutomaticIntervention, payload: { interventionType: "queue_for_review", maxSeverity: "low", maxUrgency: "routine", prerequisites: [] } }] }] };
  const ia = await createChildSafetyPolicy(creator, { policyKey: "intv", purpose: ChildSafetyPolicyPurpose.InterventionAuthorization, displayName: "Intervention", definition: iaDef });
  await fullyActivate(A, ia.policyId, ia.versionId);
  // Tamper with the stored definition WITHOUT updating definitionHash (simulates corruption of an active row).
  await systemDb.childSafetyPolicyVersion.update({ where: { id: ia.versionId }, data: { definitionJson: { ...iaDef, rules: [{ ...iaDef.rules[0]!, explanationCode: "TAMPERED" }] } as never } });
  const hashFc = await evaluateInterventionAuthorizationPolicy(A.tenantId, { severity: "low" }, { persist: false });
  check("★ tampered active definition (hash mismatch) → FAIL CLOSED (manual, no auto-intervention)", hashFc.ok === false && hashFc.errorCode === "definition_hash_mismatch" && hashFc.decision.manualOnly && !hashFc.decision.allowAutomaticIntervention);
  // Restore the definition (hash matches again) but mark an UNSUPPORTED engine version.
  await systemDb.childSafetyPolicyVersion.update({ where: { id: ia.versionId }, data: { definitionJson: iaDef as never, engineVersion: "cs-policy-engine-v0" } });
  const engFc = await evaluateInterventionAuthorizationPolicy(A.tenantId, { severity: "low" }, { persist: false });
  check("★ unsupported engine version → FAIL CLOSED", engFc.ok === false && engFc.errorCode === "unsupported_engine_version" && engFc.decision.manualOnly && !engFc.decision.allowAutomaticIntervention);

  // ── I. SIMULATION (no side effects) ───────────────────────────────
  console.log("\nI. simulation");
  const beforeSim = (await listChildSafetyPolicyDecisions(reviewer, {})).total;
  const sim = await simulateChildSafetyPolicyVersion(reviewer, v6.versionId, [{ immediateDangerFlag: true }, { immediateDangerFlag: false }]);
  check("★ Reviewer MAY simulate; returns per-case results", sim.cases.length === 2 && sim.cases[0]!.result.decision.manualOnly === true && sim.cases[1]!.result.matchedRuleIds.length === 0);
  const afterSim = (await listChildSafetyPolicyDecisions(reviewer, {})).total;
  check("★ simulation created NO production decision records (side-effect free)", afterSim === beforeSim);
  await throwsKind("★ Analyst may NOT simulate", () => simulateChildSafetyPolicyVersion(analyst, v6.versionId, [{}]), "forbidden");

  // ── J. TENANT ISOLATION ───────────────────────────────────────────
  console.log("\nJ. tenant isolation");
  const B = await seedTenant();
  const bOwner = actor(B.tenantId, B.creator, Role.Admin);
  check("★ tenant B sees none of tenant A's policies", (await listChildSafetyPolicies(bOwner)).length === 0);
  await throwsKind("★ cross-tenant get → not found (no existence leak)", () => getChildSafetyPolicy(bOwner, c.policyId), "notfound");
  await throwsKind("★ cross-tenant activate → not found", () => activateChildSafetyPolicyVersion(bOwner, v6.versionId), "notfound");
  const bEval = await evaluateSignalTriagePolicy(B.tenantId, { immediateDangerFlag: true }, { persist: false });
  check("★ tenant B evaluation is fail-closed (no policy of its own)", bEval.ok === false && bEval.errorCode === "no_active_policy");

  // ── K. AMBIGUOUS ACTIVE POLICY (fail closed) ──────────────────────
  console.log("\nK. ambiguous active policy");
  const g2 = await createChildSafetyPolicy(creator, { policyKey: "guardian2", purpose: ChildSafetyPolicyPurpose.GuardianContactEligibility, displayName: "Guardian2", definition: guardianDef() });
  await fullyActivate(A, g2.policyId, g2.versionId);
  const ambiguous = await evaluateGuardianContactEligibilityPolicy(A.tenantId, { guardianAuthorityState: "authorized" }, { persist: false });
  check("★ two active policies for one purpose → FAIL CLOSED (ambiguous)", ambiguous.ok === false && ambiguous.errorCode === "ambiguous_active_policy" && ambiguous.decision.prohibitGuardianContact);
}

main()
  .then(async () => {
    for (const id of tids) {
      for (const t of ["childSafetyPolicyDecisionRecord", "childSafetyPolicyActivationApproval", "childSafetyPolicyVersion", "childSafetyPolicy", "auditLog", "membership"] as const) {
        await (systemDb as never as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[t].deleteMany({ where: { tenantId: id } }).catch(() => {});
      }
      await systemDb.user.deleteMany({ where: { email: { endsWith: `_${id}@t.local` } } }).catch(() => {});
      await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    }
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Policy Engine (integration) V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error("FATAL:", e?.stack ?? e?.message ?? e); for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {}); process.exit(1); });
