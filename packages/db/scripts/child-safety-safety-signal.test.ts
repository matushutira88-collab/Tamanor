/**
 * CS-C3 — Safety Signal Foundation (local DB, RLS via tamanor_app).
 * Verifies workspace/role gating, tenant scoping + cross-tenant rejection (server + DB FK + RLS),
 * content-free schema/DTO/audit, fail-closed enums, NEW default, no side effects (no alert/notification/
 * incident/consent/authority/relationship change), review lifecycle (final requires reviewer, allow-listed
 * resolution codes), history preservation, archive≠delete, bounded pagination, opaque source-reference
 * validation, no app DELETE/TRUNCATE, strict RLS policy. Run: pnpm child-safety-signal:test
 */
import { Prisma } from "@prisma/client";
import { systemDb, withTenant } from "../src/index";
import {
  createSafetySignal, getSafetySignal, listSafetySignals, acknowledgeSafetySignal, startSafetySignalReview,
  dismissSafetySignal, confirmSafetySignalRisk, archiveSafetySignal,
} from "../src/child-safety-safety-signal";
import { FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError } from "../src/child-safety-family";
import {
  WorkspaceKind, RiskType, SafetySeverity, SafetyConfidenceBand, SafetySignalSourceType,
  SafetySignalResolutionCode, SAFETY_SIGNAL_LIST_MAX_LIMIT, CHILD_SAFETY_FORBIDDEN_FIELDS,
  type FamilyActorContext,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return pred(e); }
}
const sfx = `csc3_${process.pid}`;
const fam = (tenantId: string, userId: string, role: string): FamilyActorContext => ({ tenantId, userId, role, workspaceKind: WorkspaceKind.Family });

async function main() {
  const famA = await systemDb.tenant.create({ data: { id: `fa_${sfx}`, name: "FamA", slug: `fa_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const famB = await systemDb.tenant.create({ data: { id: `fb_${sfx}`, name: "FamB", slug: `fb_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const biz  = await systemDb.tenant.create({ data: { id: `bz_${sfx}`, name: "Biz",  slug: `bz_${sfx}`, workspaceKind: WorkspaceKind.Business } });
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${sfx}`, email: `uo_${sfx}@t.local` } })).id;
  const uView  = (await systemDb.user.create({ data: { id: `uv_${sfx}`, email: `uv_${sfx}@t.local` } })).id;
  const uTrust = (await systemDb.user.create({ data: { id: `ut_${sfx}`, email: `ut_${sfx}@t.local` } })).id;
  const uProf  = (await systemDb.user.create({ data: { id: `up_${sfx}`, email: `up_${sfx}@t.local` } })).id;
  const uB     = (await systemDb.user.create({ data: { id: `ub_${sfx}`, email: `ub_${sfx}@t.local` } })).id;
  await systemDb.membership.create({ data: { userId: uOwner, tenantId: famA.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uView, tenantId: famA.id, role: "viewer" as never } });
  await systemDb.membership.create({ data: { userId: uTrust, tenantId: famA.id, role: "reviewer" as never } });
  await systemDb.membership.create({ data: { userId: uProf, tenantId: famA.id, role: "analyst" as never } });
  await systemDb.membership.create({ data: { userId: uOwner, tenantId: famB.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uB, tenantId: biz.id, role: "owner" as never } });
  const pA = await systemDb.protectedProfile.create({ data: { tenantId: famA.id, ageBand: "age_10_12" } });
  const pB = await systemDb.protectedProfile.create({ data: { tenantId: famB.id, ageBand: "age_10_12" } });

  const ownerA = fam(famA.id, uOwner, "owner");    // PrimaryGuardian
  const viewerA = fam(famA.id, uView, "viewer");   // FamilyViewer
  const trustedA = fam(famA.id, uTrust, "reviewer"); // TrustedAdult
  const profA = fam(famA.id, uProf, "analyst");    // SafetyProfessional (view + review)
  const ownerB = fam(famB.id, uOwner, "owner");
  const bizActor: FamilyActorContext = { tenantId: biz.id, userId: uB, role: "owner", workspaceKind: WorkspaceKind.Business };

  const baseInput = { protectedProfileId: pA.id, signalType: RiskType.Cyberbullying, severity: SafetySeverity.Medium, sourceType: SafetySignalSourceType.ManualTest };

  // 1/2) Business gating
  check("Business CANNOT create a safety signal", await throws(() => createSafetySignal(bizActor, baseInput), (e) => e instanceof FamilyForbiddenError && e.reason === "not_family_workspace"));
  check("Business CANNOT read/list safety signals", await throws(() => listSafetySignals(bizActor), (e) => e instanceof FamilyForbiddenError));

  // 14) authorized guardian can create
  const sig = await createSafetySignal(ownerA, { ...baseInput, confidenceBand: SafetyConfidenceBand.Low, sourceReference: "ref_abc-123", occurrenceBucket: "2026-07-22" });
  check("authorized guardian CAN create a safety signal", !!sig.id && sig.signalType === "CYBERBULLYING");

  // 9) default review status NEW
  check("default review status is NEW", sig.reviewStatus === "new" && sig.reviewedAt === null && sig.reviewedByMembershipId === null);

  // 8) fail-closed unknown enums
  check("unknown signalType fail-closed", await throws(() => createSafetySignal(ownerA, { ...baseInput, signalType: "BOGUS" }), (e) => e instanceof FamilyValidationError));
  check("unknown severity / sourceType / confidence fail-closed", await throws(() => createSafetySignal(ownerA, { ...baseInput, severity: "nope" }), (e) => e instanceof FamilyValidationError) && await throws(() => createSafetySignal(ownerA, { ...baseInput, sourceType: "x" }), (e) => e instanceof FamilyValidationError) && await throws(() => createSafetySignal(ownerA, { ...baseInput, confidenceBand: "x" }), (e) => e instanceof FamilyValidationError));

  // 7) arbitrary JSON / free-text notes rejected
  check("arbitrary note / metadata / rawText fields are rejected", await throws(() => createSafetySignal(ownerA, { ...baseInput, note: "hi" } as never), (e) => e instanceof FamilyValidationError) && await throws(() => createSafetySignal(ownerA, { ...baseInput, metadata: { a: 1 } } as never), (e) => e instanceof FamilyValidationError) && await throws(() => createSafetySignal(ownerA, { ...baseInput, rawText: "x" } as never), (e) => e instanceof FamilyValidationError));

  // 22) opaque source reference validation
  check("source reference with URL/username chars is rejected", await throws(() => createSafetySignal(ownerA, { ...baseInput, sourceReference: "http://evil.com/msg?u=bob" }), (e) => e instanceof FamilyValidationError) && await throws(() => createSafetySignal(ownerA, { ...baseInput, occurrenceBucket: "sha256:deadbeef/raw content" }), (e) => e instanceof FamilyValidationError));

  // 4) cross-tenant profile rejected
  check("cross-tenant ProtectedProfile is rejected", await throws(() => createSafetySignal(ownerA, { ...baseInput, protectedProfileId: pB.id }), (e) => e instanceof FamilyNotFoundError));

  // 13) viewer / trusted-adult cannot review; 14) safety professional can review
  check("viewer CANNOT review (dismiss)", await throws(() => dismissSafetySignal(viewerA, sig.id), (e) => e instanceof FamilyForbiddenError && e.reason === "role_forbidden"));
  check("trusted-adult CANNOT review", await throws(() => acknowledgeSafetySignal(trustedA, sig.id), (e) => e instanceof FamilyForbiddenError && e.reason === "role_forbidden"));
  check("trusted-adult CAN view (list)", Array.isArray((await listSafetySignals(trustedA, { protectedProfileId: pA.id })).items));
  const profAck = await acknowledgeSafetySignal(profA, sig.id);
  check("safety-professional CAN review (acknowledge)", profAck.reviewStatus === "acknowledged" && profAck.reviewedByMembershipId !== null);

  // 15) final review states require reviewedAt + reviewedBy (repo + DB CHECK)
  const dismissed = await dismissSafetySignal(ownerA, sig.id, { resolutionCode: SafetySignalResolutionCode.FalsePositive });
  check("final state (dismissed) records reviewedAt + reviewedBy + resolutionCode", dismissed.reviewStatus === "dismissed" && dismissed.reviewedAt !== null && dismissed.reviewedByMembershipId !== null && dismissed.resolutionCode === "false_positive");
  check("DB rejects a final-state signal without a reviewer (CHECK)", await throws(() => systemDb.safetySignal.create({ data: { tenantId: famA.id, protectedProfileId: pA.id, signalType: "THREAT", severity: "high", sourceType: "manual_test", reviewStatus: "confirmed_risk" } }), () => true));

  // 18) resolution code allow-listed
  const sig2 = await createSafetySignal(ownerA, baseInput);
  check("resolutionCode must be allow-listed", await throws(() => dismissSafetySignal(ownerA, sig2.id, { resolutionCode: "totally-made-up" }), (e) => e instanceof FamilyValidationError));
  const confirmed = await confirmSafetySignalRisk(ownerA, sig2.id, { resolutionCode: SafetySignalResolutionCode.ValidSafetyConcern });
  check("confirm records final state + reviewer (no auto side effect)", confirmed.reviewStatus === "confirmed_risk" && confirmed.reviewedByMembershipId !== null);

  // 10/11/12/21) NO side effects: no notification/alert/incident/relationship/consent/authority/assessment
  const sideEffects = await withTenant(famA.id, (db) => Promise.all([
    db.notification.count({ where: { tenantId: famA.id } }),
    db.cyberbullyingNotification.count({ where: { tenantId: famA.id } }),
    db.incident.count({ where: { tenantId: famA.id } }),
    db.guardianRelationship.count({ where: { tenantId: famA.id } }),
    db.consentRecord.count({ where: { tenantId: famA.id } }),
    db.guardianAuthorityRecord.count({ where: { tenantId: famA.id } }),
    db.safeRecipientAssessment.count({ where: { tenantId: famA.id } }),
  ]));
  check("NEW/reviewed signals create NO notification/alert/incident", sideEffects[0] === 0 && sideEffects[1] === 0 && sideEffects[2] === 0);
  check("signals do NOT create/change relationship/consent/authority/assessment", sideEffects[3] === 0 && sideEffects[4] === 0 && sideEffects[5] === 0 && sideEffects[6] === 0);

  // 16/17) history preserved; archive ≠ delete
  const beforeArchive = await withTenant(famA.id, (db) => db.safetySignal.count({ where: { tenantId: famA.id } }));
  const archived = await archiveSafetySignal(ownerA, sig.id);
  const afterArchive = await withTenant(famA.id, (db) => db.safetySignal.count({ where: { tenantId: famA.id } }));
  check("dismissed/confirmed signals remain (history preserved)", (await getSafetySignal(ownerA, sig.id)).id === sig.id && (await getSafetySignal(ownerA, sig2.id)).reviewStatus === "confirmed_risk");
  check("archive is NOT delete (row kept, archivedAt set)", archived.reviewStatus === "archived" && archived.archivedAt !== null && beforeArchive === afterArchive);

  // 19) bounded pagination
  const page = await listSafetySignals(ownerA, { limit: 9999 });
  check("list pagination is bounded to the max limit", page.limit === SAFETY_SIGNAL_LIST_MAX_LIMIT);

  // 3/5/25) tenant isolation + RLS + cross-tenant direct SQL
  const bSig = await createSafetySignal(ownerB, { protectedProfileId: pB.id, signalType: RiskType.Threat, severity: SafetySeverity.High, sourceType: SafetySignalSourceType.ManualTest });
  check("Tenant A does not see Tenant B (getSafetySignal cross-tenant → NotFound)", await throws(() => getSafetySignal(ownerA, bSig.id), (e) => e instanceof FamilyNotFoundError));
  check("RLS: famB app-context sees none of famA's signals; famA sees ≥1", (await withTenant(famB.id, (db) => db.safetySignal.count({ where: { tenantId: famA.id } }))) === 0 && (await withTenant(famA.id, (db) => db.safetySignal.count({}))) >= 1);
  check("RLS: cross-tenant INSERT rejected (WITH CHECK)", await throws(() => withTenant(famA.id, (db) => db.safetySignal.create({ data: { tenantId: famB.id, protectedProfileId: pB.id, signalType: "THREAT", severity: "high", sourceType: "manual_test" } })), () => true));
  check("RLS: cross-tenant SELECT returns nothing", (await withTenant(famB.id, (db) => db.safetySignal.findFirst({ where: { id: sig.id } }))) === null);

  // 6) no forbidden fields in schema or DTO
  const forbidden = new Set(CHILD_SAFETY_FORBIDDEN_FIELDS);
  const cols = Object.values(Prisma.SafetySignalScalarFieldEnum) as string[];
  check("SafetySignal schema has NO forbidden field", !cols.some((c) => forbidden.has(c)), cols.filter((c) => forbidden.has(c)).join(","));
  check("SafetySignal DTO has NO forbidden field", !Object.keys(archived).some((k) => forbidden.has(k)));

  // 20) audit payloads content-free
  const audits = await withTenant(famA.id, (db) => db.auditLog.findMany({ where: { tenantId: famA.id, event: { startsWith: "child_safety.safety_signal" } }, select: { event: true, metadata: true } }));
  const blob = JSON.stringify(audits);
  check("safety-signal audit events written (created/reviewed/archived)", audits.some((a) => a.event.endsWith(".created")) && audits.some((a) => a.event.endsWith(".dismissed")) && audits.some((a) => a.event.endsWith(".archived")));
  check("audit payloads carry NO forbidden field / PII", !CHILD_SAFETY_FORBIDDEN_FIELDS.some((f) => blob.includes(`"${f}"`)) && !blob.includes("@t.local") && !blob.includes("age_10_12"));

  // 23) app role has no DELETE/TRUNCATE
  const grants = await systemDb.$queryRawUnsafe<{ privilege_type: string }[]>(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='safety_signals' AND grantee='tamanor_app'`);
  const g = grants.map((r) => r.privilege_type);
  check("tamanor_app has SELECT/INSERT/UPDATE but NOT DELETE/TRUNCATE", g.includes("SELECT") && g.includes("INSERT") && g.includes("UPDATE") && !g.includes("DELETE") && !g.includes("TRUNCATE"));

  // 24) RLS policy has no IS NULL bootstrap branch
  const pol = await systemDb.$queryRawUnsafe<{ qual: string; withcheck: string }[]>(`SELECT pg_get_expr(polqual, polrelid) AS qual, pg_get_expr(polwithcheck, polrelid) AS withcheck FROM pg_policy WHERE polrelid='public.safety_signals'::regclass`);
  check("RLS policy has NO 'IS NULL' bootstrap branch", pol.length === 1 && !/is null/i.test(pol[0].qual) && !/is null/i.test(pol[0].withcheck));

  // Cleanup (owner role; app role cannot DELETE)
  const tids = [famA.id, famB.id, biz.id];
  await systemDb.safetySignal.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.protectedProfile.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.auditLog.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.membership.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.user.deleteMany({ where: { id: { in: [uOwner, uView, uTrust, uProf, uB] } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: tids } } });

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — CS-C3 safety signal foundation: ${pass} passed, ${fail} failed`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
