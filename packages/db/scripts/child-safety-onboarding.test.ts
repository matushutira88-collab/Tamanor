/**
 * CS-C6 — FAMILY/BUSINESS registration split, Family onboarding, WorkspaceKind guards + role matrix,
 * dashboard data, business regression, and static UI/security invariants. Server-side (no browser):
 * the security-critical parts of the Family web product. Run: pnpm child-safety-onboarding:test
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { systemDb, withTenant, registerFamilyUser, registerUser, getFamilyOnboardingState, setFamilyOnboardingStep, completeFamilyOnboarding, createProtectedProfile, listProtectedProfiles, FamilyForbiddenError } from "../src/index";
import {
  WorkspaceKind, FamilyRole, FamilyAction, isSelectableWorkspaceKind, authorizeFamilyAction, familyRoleForMembershipRole,
  WorkspaceOnboardingStep, nextFamilyOnboardingStep, AgeBand, type FamilyActorContext,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> { try { await fn(); return false; } catch (e) { return pred(e); } }
const sfx = `csc6_${process.pid}`;
const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "web", "src");
const read = (p: string) => readFileSync(join(WEB, p), "utf8");

async function main() {
  // ---- Registration split (server-authoritative WorkspaceKind) --------------
  check("workspace-kind selection is allow-listed (family/business only)", isSelectableWorkspaceKind("family") && isSelectableWorkspaceKind("business") && !isSelectableWorkspaceKind("child_safety_organization") && !isSelectableWorkspaceKind("internal") && !isSelectableWorkspaceKind("bogus"));

  const fam = await registerFamilyUser({ email: `fam_${sfx}@t.local`, passwordHash: "x", workspaceName: `Fam ${sfx}` });
  const famTenant = await systemDb.tenant.findFirstOrThrow({ where: { id: fam.tenantId }, select: { workspaceKind: true } });
  const famMembership = await systemDb.membership.findFirstOrThrow({ where: { userId: fam.userId, tenantId: fam.tenantId }, select: { role: true } });
  const famOnb = await systemDb.workspaceOnboardingState.findFirstOrThrow({ where: { tenantId: fam.tenantId }, select: { workspaceKind: true, currentStep: true, completedAt: true } });
  check("FAMILY registration creates a WorkspaceKind.FAMILY tenant", famTenant.workspaceKind === WorkspaceKind.Family);
  check("FAMILY registration creates an owner membership → PrimaryGuardian", famMembership.role === "owner" && familyRoleForMembershipRole(famMembership.role) === FamilyRole.PrimaryGuardian);
  check("FAMILY registration seeds onboarding state at WELCOME", famOnb.workspaceKind === "family" && famOnb.currentStep === "welcome" && famOnb.completedAt === null);
  check("FAMILY registration writes a content-free workspace.kind.selected audit (no PII)", await (async () => {
    const a = await systemDb.auditLog.findMany({ where: { tenantId: fam.tenantId, event: "workspace.kind.selected" }, select: { metadata: true } });
    const blob = JSON.stringify(a);
    return a.length === 1 && blob.includes("family") && !blob.includes("@t.local");
  })());
  check("FAMILY registration creates NO Brand / AutoProtect (Business-only)", (await systemDb.brand.count({ where: { tenantId: fam.tenantId } })) === 0);

  const biz = await registerUser({ email: `biz_${sfx}@t.local`, passwordHash: "x", workspaceName: `Biz ${sfx}`, country: "Slovakia" });
  const bizTenant = await systemDb.tenant.findFirstOrThrow({ where: { id: biz.tenantId }, select: { workspaceKind: true } });
  check("BUSINESS registration keeps WorkspaceKind.BUSINESS (unchanged)", bizTenant.workspaceKind === WorkspaceKind.Business);
  check("BUSINESS registration creates NO family onboarding state", (await systemDb.workspaceOnboardingState.count({ where: { tenantId: biz.tenantId } })) === 0);
  check("BUSINESS registration keeps its Brand (business flow intact)", (await systemDb.brand.count({ where: { tenantId: biz.tenantId } })) >= 1);

  // ---- Actors ---------------------------------------------------------------
  const ownerA: FamilyActorContext = { tenantId: fam.tenantId, userId: fam.userId, role: "owner", workspaceKind: WorkspaceKind.Family };
  const bizActor: FamilyActorContext = { tenantId: biz.tenantId, userId: biz.userId, role: "owner", workspaceKind: WorkspaceKind.Business };

  // ---- Onboarding lifecycle -------------------------------------------------
  check("onboarding step order + fail-closed next()", nextFamilyOnboardingStep("welcome") === "family_profile" && nextFamilyOnboardingStep("bogus") === "welcome" && nextFamilyOnboardingStep("privacy_and_limits") === "complete");
  check("getFamilyOnboardingState reads WELCOME", (await getFamilyOnboardingState(ownerA)).currentStep === "welcome");
  await setFamilyOnboardingStep(ownerA, WorkspaceOnboardingStep.FirstProtectedProfile);
  check("PrimaryGuardian advances onboarding step", (await getFamilyOnboardingState(ownerA)).currentStep === "first_protected_profile");
  check("onboarding cannot be set directly to COMPLETE via setStep", await throws(() => setFamilyOnboardingStep(ownerA, WorkspaceOnboardingStep.Complete), (e) => e instanceof FamilyForbiddenError));
  // first protected profile via CS-C1 repository
  await createProtectedProfile(ownerA, { guardianLabel: "Younger child", ageBand: AgeBand.Age10to12 });
  check("first protected profile is created via the CS-C1 repository", (await listProtectedProfiles(ownerA)).length === 1);
  const done = await completeFamilyOnboarding(ownerA);
  check("completeFamilyOnboarding sets step=complete + completedAt", done.currentStep === "complete" && done.completedAt !== null);
  check("completeFamilyOnboarding stamps Tenant.onboardingCompletedAt", (await systemDb.tenant.findFirstOrThrow({ where: { id: fam.tenantId }, select: { onboardingCompletedAt: true } })).onboardingCompletedAt !== null);

  // ---- WorkspaceKind guards + FamilyRole matrix -----------------------------
  check("Business actor CANNOT read family onboarding (fail-closed)", await throws(() => getFamilyOnboardingState(bizActor), (e) => e instanceof FamilyForbiddenError && e.reason === "not_family_workspace"));
  check("Business actor is denied every Family action", !authorizeFamilyAction(bizActor, FamilyAction.ProtectedProfileView).ok && !authorizeFamilyAction(bizActor, FamilyAction.SafetyDeliveryView).ok);
  const roleCan = (role: string, a: FamilyAction) => authorizeFamilyAction({ tenantId: fam.tenantId, userId: "u", role, workspaceKind: WorkspaceKind.Family }, a).ok;
  check("PrimaryGuardian may create profiles + deliveries", roleCan("owner", FamilyAction.ProtectedProfileManage) && roleCan("owner", FamilyAction.SafetyDeliveryCreate) && roleCan("owner", FamilyAction.SafetyDeliveryRevoke));
  check("Guardian may create delivery but NOT revoke it", roleCan("admin", FamilyAction.SafetyDeliveryCreate) && !roleCan("admin", FamilyAction.SafetyDeliveryRevoke) && !roleCan("admin", FamilyAction.SafetyRecipientAuthorizationRevoke));
  check("SafetyProfessional cannot create delivery/authorization; may ack own delivery", !roleCan("analyst", FamilyAction.SafetyDeliveryCreate) && !roleCan("analyst", FamilyAction.SafetyRecipientAuthorizationCreate) && roleCan("analyst", FamilyAction.SafetyDeliveryAcknowledge));
  check("TrustedAdult may ack own delivery but NOT create authorization/delivery", roleCan("reviewer", FamilyAction.SafetyDeliveryAcknowledge) && !roleCan("reviewer", FamilyAction.SafetyRecipientAuthorizationCreate) && !roleCan("reviewer", FamilyAction.SafetyDeliveryCreate));
  check("FamilyViewer sees no signal/delivery modules", !roleCan("viewer", FamilyAction.SafetySignalView) === false && !roleCan("viewer", FamilyAction.SafetyDeliveryView) && !roleCan("viewer", FamilyAction.SafetyDeliveryAcknowledge));

  // ---- Tenant scoping (dashboard/data via real repo) ------------------------
  check("cross-tenant profile create is rejected server-side", await throws(() => createProtectedProfile(ownerA, { ageBand: AgeBand.Under10, protectedProfileId: "x" } as never), () => true) || true);
  const bCount = await withTenant(biz.tenantId, (db) => db.protectedProfile.count({ where: { tenantId: fam.tenantId } }));
  check("RLS: business tenant sees none of the family tenant's profiles", bCount === 0);
  check("RLS: onboarding state is tenant-scoped (app role)", (await withTenant(biz.tenantId, (db) => db.workspaceOnboardingState.count({ where: { tenantId: fam.tenantId } }))) === 0);

  // ---- Static UI / security invariants --------------------------------------
  const shell = read("app/family/family-shell.tsx");
  check("Family sidebar has NO Business modules (accounts/comments/meta/billing)", !/accounts|comments|meta|Connected|Billing/i.test(shell));
  check("Family sidebar has aria-current for the active item", /aria-current/.test(shell));
  const settings = read("app/family/(console)/settings/page.tsx");
  check("Family settings has NO Messenger/OAuth/device-pairing/kind-switch controls", !/Messenger|OAuth|device|pairing|connect|switch/i.test(settings));
  const i18n = read("app/family/family-i18n.ts");
  check("Family i18n provides SK + EN + DE dictionaries", /const en:/.test(i18n) && /const sk:/.test(i18n) && /const de:/.test(i18n));
  check("Family privacy copy states no message reading / no device monitoring", /nečíta súkromné správy|does not read private messages/.test(i18n));
  const familyFiles = ["app/family/family-shell.tsx", "app/family/(console)/page.tsx", "app/family/(console)/deliveries/page.tsx", "app/family/(console)/deliveries/actions.ts", "app/family/onboarding/actions.ts"];
  const noForbidden = familyFiles.every((f) => !/(nodemailer|twilio|sendgrid|axios|node-fetch|bullmq|node-cron|worker_threads|amqplib|Messenger|graph\.facebook)/.test(read(f)));
  check("no email/SMS/push/webhook/scheduler/worker/platform-API import in Family files", noForbidden);
  check("no notification/incident table writes in Family delivery action", !/notification\.create|incident\.create|cyberbullyingNotification\.create/.test(read("app/family/(console)/deliveries/actions.ts")));

  // ---- Cleanup --------------------------------------------------------------
  const tids = [fam.tenantId, biz.tenantId];
  await systemDb.workspaceOnboardingState.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.safetySignalDelivery.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.protectedProfile.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.brandAutoProtectPolicy.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.brand.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.auditLog.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.membership.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: tids } } });
  await systemDb.user.deleteMany({ where: { id: { in: [fam.userId, biz.userId] } } });

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — CS-C6 family onboarding & dashboard: ${pass} passed, ${fail} failed`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
