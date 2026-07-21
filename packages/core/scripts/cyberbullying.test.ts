/**
 * C1 — Cyberbullying Protected Subject & Access Foundation: domain unit tests.
 * RBAC, permission wiring, entitlement, legal-gate hard blocker, enums, audit
 * vocabulary. Pure, no DB. Run: pnpm cyberbullying:test
 */
import { Permission, can } from "../src/permissions";
import { Role } from "../src/tenant";
import { planEntitlements, hasEntitlement } from "../src/entitlements";
import {
  ProtectedSubjectType,
  ProtectedSubjectRelationshipType,
  SubjectScope,
  CyberbullyingBlockedFlow,
  CYBERBULLYING_BLOCKED_FLOWS,
  FeatureBlockedError,
  isCyberbullyingFlowBlocked,
  assertCyberbullyingFlowAllowed,
  blockedFlowForRelationship,
  CYBERBULLYING_AUDIT_EVENTS,
} from "../src/cyberbullying";

let pass = 0,
  fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

const CB = [
  Permission.CyberbullyingViewOwn, Permission.CyberbullyingReport, Permission.CyberbullyingReview,
  Permission.CyberbullyingManage, Permission.CyberbullyingEscalate, Permission.CyberbullyingViewSensitiveEvidence,
  Permission.CyberbullyingExportEvidence, Permission.CyberbullyingManageRetention,
  Permission.CyberbullyingManageGuardianAccess, Permission.CyberbullyingAudit,
];

// --- Permission enum coverage ---
check("all 10 cyberbullying permissions exist", CB.every((p) => typeof p === "string") && CB.length === 10);
check("permission string values are cyberbullying:*", CB.every((p) => String(p).startsWith("cyberbullying:")));

// --- RBAC mapping ---
check("Owner has ALL cyberbullying permissions", CB.every((p) => can(Role.Owner, p)));
// Admin: operational set yes; sensitive-evidence + export NO (owner-exclusive)
const adminYes = [Permission.CyberbullyingViewOwn, Permission.CyberbullyingReport, Permission.CyberbullyingReview, Permission.CyberbullyingManage, Permission.CyberbullyingEscalate, Permission.CyberbullyingManageRetention, Permission.CyberbullyingManageGuardianAccess, Permission.CyberbullyingAudit];
check("Admin has the operational cyberbullying set", adminYes.every((p) => can(Role.Admin, p)));
check("Admin does NOT get view_sensitive_evidence (owner-exclusive)", !can(Role.Admin, Permission.CyberbullyingViewSensitiveEvidence));
check("Admin does NOT get export_evidence (owner-exclusive)", !can(Role.Admin, Permission.CyberbullyingExportEvidence));
// Reviewer: view_own/report/review only
check("Reviewer has view_own/report/review", can(Role.Reviewer, Permission.CyberbullyingViewOwn) && can(Role.Reviewer, Permission.CyberbullyingReport) && can(Role.Reviewer, Permission.CyberbullyingReview));
check("Reviewer does NOT get manage", !can(Role.Reviewer, Permission.CyberbullyingManage));
// Analyst + Viewer: none
check("Analyst has NO cyberbullying content permission", CB.every((p) => !can(Role.Analyst, p)));
check("Viewer has NO cyberbullying content permission", CB.every((p) => !can(Role.Viewer, p)));
check("sensitive-evidence + export are OWNER-ONLY", CB.filter((p) => can(Role.Owner, p) && !can(Role.Admin, p) && !can(Role.Reviewer, p)).length >= 2 && !can(Role.Admin, Permission.CyberbullyingExportEvidence));

// --- Entitlement ---
check("cyberbullyingProtection OFF on free_trial", planEntitlements("free_trial").cyberbullyingProtection === false);
check("cyberbullyingProtection OFF on starter", planEntitlements("starter").cyberbullyingProtection === false);
check("cyberbullyingProtection ON on growth", planEntitlements("growth").cyberbullyingProtection === true);
check("cyberbullyingProtection ON on agency", planEntitlements("agency").cyberbullyingProtection === true);
check("cyberbullyingProtection ON on enterprise", planEntitlements("enterprise").cyberbullyingProtection === true);
check("unknown plan → cyberbullyingProtection false (MINIMAL fail-safe)", planEntitlements("free").cyberbullyingProtection === false && planEntitlements("dev").cyberbullyingProtection === false);
check("hasEntitlement works for cyberbullyingProtection", hasEntitlement(planEntitlements("growth"), "cyberbullyingProtection") === true && hasEntitlement(planEntitlements("starter"), "cyberbullyingProtection") === false);

// --- Legal / safeguarding gate (HARD BLOCKER) ---
check("blocked flows = minor/guardian/school/company", [...CYBERBULLYING_BLOCKED_FLOWS].sort().join(",") === "company,guardian,minor,school");
for (const flow of ["minor", "guardian", "school", "company"] as CyberbullyingBlockedFlow[]) {
  check(`isCyberbullyingFlowBlocked("${flow}") = true`, isCyberbullyingFlowBlocked(flow));
  let threw = false, isFeatureBlocked = false, sameFlow = false, code = "";
  try {
    assertCyberbullyingFlowAllowed(flow);
  } catch (e) {
    threw = true;
    isFeatureBlocked = e instanceof FeatureBlockedError;
    if (e instanceof FeatureBlockedError) { sameFlow = e.flow === flow; code = e.code; }
  }
  check(`assertCyberbullyingFlowAllowed("${flow}") throws FeatureBlockedError`, threw && isFeatureBlocked && sameFlow && code === "FEATURE_BLOCKED");
}
// Relationship → blocked-flow mapping
check("guardian relationship → blocked 'guardian'", blockedFlowForRelationship(ProtectedSubjectRelationshipType.Guardian) === "guardian");
check("school relationship → blocked 'school'", blockedFlowForRelationship(ProtectedSubjectRelationshipType.School) === "school");
check("company relationship → blocked 'company'", blockedFlowForRelationship(ProtectedSubjectRelationshipType.Company) === "company");
check("trusted_contact relationship → allowed (null)", blockedFlowForRelationship(ProtectedSubjectRelationshipType.TrustedContact) === null);

// --- Enums ---
check("ProtectedSubjectType values", ProtectedSubjectType.Individual === "individual" && ProtectedSubjectType.Other === "other");
check("ProtectedSubjectRelationshipType values", ProtectedSubjectRelationshipType.TrustedContact === "trusted_contact" && ProtectedSubjectRelationshipType.Guardian === "guardian" && ProtectedSubjectRelationshipType.School === "school" && ProtectedSubjectRelationshipType.Company === "company");
check("SubjectScope values", SubjectScope.Owner === "owner" && SubjectScope.Reviewer === "reviewer" && SubjectScope.SecurityAdmin === "security_admin" && SubjectScope.Auditor === "auditor" && SubjectScope.Other === "other");

// --- Audit vocabulary ---
check("audit vocabulary is dot-namespaced under cyberbullying.*", Object.values(CYBERBULLYING_AUDIT_EVENTS).every((e) => e.startsWith("cyberbullying.")));
check("protected_subject.created event present", CYBERBULLYING_AUDIT_EVENTS.protectedSubjectCreated === "cyberbullying.protected_subject.created");

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — cyberbullying C1 foundation: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
