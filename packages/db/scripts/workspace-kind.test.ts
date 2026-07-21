/**
 * CS-C0 — Workspace separation & Child Safety architecture lock (local DB).
 * Verifies WorkspaceKind default/immutability-by-contract, the capability registry
 * (kind separation), multi-workspace membership isolation, nav separation, and the
 * Safety Signal privacy allowlist. Run: pnpm workspace-kind:test
 */
import { systemDb, withTenant } from "../src/index";
import {
  WorkspaceKind, WorkspaceCapability, isWorkspaceKind, capabilityAllowedInWorkspace, capabilitiesForWorkspaceKind,
  PUBLIC_WORKSPACE_KINDS, INVITE_ONLY_WORKSPACE_KINDS, navForWorkspaceKind, DEFAULT_WORKSPACE_KIND,
  validateSafetySignalEnvelope, SAFETY_SIGNAL_ALLOWED_FIELDS, RiskType, SafetySeverity, SafetyUrgency, SafetySignalCode,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const sfx = `wsk_${process.pid}`;
const uid = "u_multi_" + sfx;

async function main() {
  // === WorkspaceKind (DB default + kinds) ==================================
  const biz = await systemDb.tenant.create({ data: { id: `tbiz_${sfx}`, name: "Biz", slug: `tbiz_${sfx}` } }); // no workspaceKind → default
  check("existing/new tenant defaults to BUSINESS", biz.workspaceKind === WorkspaceKind.Business && DEFAULT_WORKSPACE_KIND === WorkspaceKind.Business);
  const fam = await systemDb.tenant.create({ data: { id: `tfam_${sfx}`, name: "Family", slug: `tfam_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  check("a FAMILY workspace is distinct from BUSINESS", fam.workspaceKind === WorkspaceKind.Family && fam.workspaceKind !== biz.workspaceKind);
  check("workspaceKind column is NOT NULL (always present)", typeof biz.workspaceKind === "string" && biz.workspaceKind.length > 0);
  check("isWorkspaceKind rejects an invalid kind", isWorkspaceKind("business") && isWorkspaceKind("family") && !isWorkspaceKind("bogus") && !isWorkspaceKind(""));
  check("registration: BUSINESS + FAMILY public; ORGANIZATION invite-only; INTERNAL system", PUBLIC_WORKSPACE_KINDS.includes(WorkspaceKind.Business) && PUBLIC_WORKSPACE_KINDS.includes(WorkspaceKind.Family) && !PUBLIC_WORKSPACE_KINDS.includes(WorkspaceKind.ChildSafetyOrganization) && INVITE_ONLY_WORKSPACE_KINDS.includes(WorkspaceKind.ChildSafetyOrganization) && !PUBLIC_WORKSPACE_KINDS.includes(WorkspaceKind.Internal));

  // === Capability registry (kind separation) ==============================
  check("BUSINESS has business capabilities", capabilityAllowedInWorkspace(WorkspaceCapability.BusinessDashboard, WorkspaceKind.Business) && capabilityAllowedInWorkspace(WorkspaceCapability.CyberbullyingCaseManagement, WorkspaceKind.Business) && capabilityAllowedInWorkspace(WorkspaceCapability.BusinessBilling, WorkspaceKind.Business));
  check("FAMILY does NOT have business capabilities", !capabilityAllowedInWorkspace(WorkspaceCapability.BusinessDashboard, WorkspaceKind.Family) && !capabilityAllowedInWorkspace(WorkspaceCapability.SocialAccounts, WorkspaceKind.Family) && !capabilityAllowedInWorkspace(WorkspaceCapability.CyberbullyingCaseManagement, WorkspaceKind.Family));
  check("BUSINESS does NOT have family capabilities", !capabilityAllowedInWorkspace(WorkspaceCapability.FamilyDashboard, WorkspaceKind.Business) && !capabilityAllowedInWorkspace(WorkspaceCapability.SafetySignals, WorkspaceKind.Business) && !capabilityAllowedInWorkspace(WorkspaceCapability.GuardianAlerts, WorkspaceKind.Business));
  check("FAMILY has family capabilities", capabilityAllowedInWorkspace(WorkspaceCapability.FamilyDashboard, WorkspaceKind.Family) && capabilityAllowedInWorkspace(WorkspaceCapability.ProtectedProfiles, WorkspaceKind.Family) && capabilityAllowedInWorkspace(WorkspaceCapability.ConsentManagement, WorkspaceKind.Family));
  check("ORGANIZATION has no implicit Family data access", !capabilityAllowedInWorkspace(WorkspaceCapability.ProtectedProfiles, WorkspaceKind.ChildSafetyOrganization) && !capabilityAllowedInWorkspace(WorkspaceCapability.SafetySignals, WorkspaceKind.ChildSafetyOrganization) && capabilityAllowedInWorkspace(WorkspaceCapability.ExpertValidation, WorkspaceKind.ChildSafetyOrganization));
  check("INTERNAL capabilities are not available to public kinds", !capabilityAllowedInWorkspace(WorkspaceCapability.PlatformAdministration, WorkspaceKind.Business) && !capabilityAllowedInWorkspace(WorkspaceCapability.PlatformAdministration, WorkspaceKind.Family) && capabilityAllowedInWorkspace(WorkspaceCapability.PlatformAdministration, WorkspaceKind.Internal));
  check("every capability maps to exactly the intended kind(s)", capabilitiesForWorkspaceKind(WorkspaceKind.Business).every((c) => capabilityAllowedInWorkspace(c, WorkspaceKind.Business)) && capabilitiesForWorkspaceKind(WorkspaceKind.Family).every((c) => !capabilityAllowedInWorkspace(c, WorkspaceKind.Business)));

  // === Navigation separation ==============================================
  const bizNav = navForWorkspaceKind(WorkspaceKind.Business).map((n) => n.href);
  const famNav = navForWorkspaceKind(WorkspaceKind.Family).map((n) => n.href);
  check("Business nav ≠ Family nav (no business routes in family)", bizNav.includes("/dashboard/accounts") && !famNav.includes("/dashboard/accounts") && !famNav.includes("/dashboard/comments") && famNav.some((h) => h.startsWith("/dashboard/family")));

  // === Multi-workspace membership isolation ===============================
  await systemDb.user.upsert({ where: { id: uid }, update: {}, create: { id: uid, email: `${uid}@t.local` } });
  await systemDb.membership.upsert({ where: { userId_tenantId: { userId: uid, tenantId: biz.id } }, update: {}, create: { userId: uid, tenantId: biz.id, role: "owner" as never } });
  await systemDb.membership.upsert({ where: { userId_tenantId: { userId: uid, tenantId: fam.id } }, update: {}, create: { userId: uid, tenantId: fam.id, role: "viewer" as never } });
  const memberships = await systemDb.membership.findMany({ where: { userId: uid }, include: { tenant: { select: { workspaceKind: true } } } });
  check("one User may belong to a BUSINESS and a FAMILY workspace", memberships.length === 2 && memberships.some((m) => m.tenant.workspaceKind === "business") && memberships.some((m) => m.tenant.workspaceKind === "family"));
  // The business membership grants no family access: business kind lacks every family capability.
  const bizKind = memberships.find((m) => m.tenantId === biz.id)!.tenant.workspaceKind as WorkspaceKind;
  check("BUSINESS membership grants NO family capability", !capabilityAllowedInWorkspace(WorkspaceCapability.FamilyDashboard, bizKind) && !capabilityAllowedInWorkspace(WorkspaceCapability.GuardianRelationships, bizKind));
  // Cross-tenant: a query scoped to the business tenant never sees the family tenant.
  check("cross-tenant isolation: business context can't read the family tenant row", (await withTenant(biz.id, (db) => db.tenant.findFirst({ where: { id: fam.id }, select: { id: true } }))) === null);

  // === Safety Signal privacy allowlist ====================================
  const valid = { contractVersion: "safety-signal-v1", eventId: "e1", sourcePlatform: "p", sourceEnvironment: "prod", protectedProfileReference: "pp", conversationReferenceHash: "ch", actorReferenceHash: "ah", riskType: RiskType.Grooming, severity: SafetySeverity.High, urgency: SafetyUrgency.Elevated, confidence: 0.8, signalCodes: [SafetySignalCode.AgeProbe], detectedAt: "2026-07-21T00:00:00Z", taxonomyVersion: "t1", detectorVersion: "d1", nonce: "n1", signature: "s1" };
  check("valid envelope accepted (allowlist)", validateSafetySignalEnvelope(valid).ok);
  check("forbidden raw-content field rejected", !validateSafetySignalEnvelope({ ...valid, message: "hi" }).ok && validateSafetySignalEnvelope({ ...valid, message: "hi" }).errors.some((e) => e.code === "forbidden_field" && e.field === "message"));
  check("forbidden open platform id + media rejected", !validateSafetySignalEnvelope({ ...valid, platformUserId: "x", image: "y" }).ok);
  check("unknown field rejected (not silently stored)", !validateSafetySignalEnvelope({ ...valid, mysteryField: 1 }).ok && validateSafetySignalEnvelope({ ...valid, mysteryField: 1 }).errors.some((e) => e.code === "unknown_field"));
  check("missing required field rejected", !validateSafetySignalEnvelope({ eventId: "e" }).ok);
  check("invalid risk type / confidence rejected", !validateSafetySignalEnvelope({ ...valid, riskType: "MADE_UP" }).ok && !validateSafetySignalEnvelope({ ...valid, confidence: 2 }).ok);
  check("allowlist carries no content/media/identifier fields", !SAFETY_SIGNAL_ALLOWED_FIELDS.some((f) => ["message", "text", "content", "image", "video", "email", "platformUserId", "latitude"].includes(f)));

  await systemDb.membership.deleteMany({ where: { userId: uid } });
  await systemDb.user.deleteMany({ where: { id: uid } });
  await systemDb.tenant.deleteMany({ where: { id: { in: [biz.id, fam.id] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS-C0 workspace separation + safety signal contract: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
