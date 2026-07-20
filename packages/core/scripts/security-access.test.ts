/**
 * S2 — access control for the Security Center / Potential Account Takeover surface. PURE: the two gates the
 * page enforces are (1) the `security:view` / `security:manage` RBAC permissions and (2) the `securitySuite`
 * plan entitlement. This pins both so the ATO section can never render to an unauthorized role or an
 * un-entitled plan.
 * Run: pnpm security-access:test
 */
import { Role, Permission, can, planEntitlements } from "../src/index";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
};

function run() {
  // --- Permission (RBAC) --------------------------------------------------------------------------
  check("Owner: view + manage", can(Role.Owner, Permission.SecurityView) && can(Role.Owner, Permission.SecurityManage));
  check("Admin: view + manage", can(Role.Admin, Permission.SecurityView) && can(Role.Admin, Permission.SecurityManage));
  check("Analyst: view but NOT manage", can(Role.Analyst, Permission.SecurityView) && !can(Role.Analyst, Permission.SecurityManage));
  check("Reviewer: view but NOT manage", can(Role.Reviewer, Permission.SecurityView) && !can(Role.Reviewer, Permission.SecurityManage));
  check("Viewer: NEITHER view nor manage (Security Center hidden)", !can(Role.Viewer, Permission.SecurityView) && !can(Role.Viewer, Permission.SecurityManage));

  // --- Entitlement (plan) -------------------------------------------------------------------------
  check("free_trial: securitySuite OFF", planEntitlements("free_trial").securitySuite === false);
  check("starter: securitySuite OFF", planEntitlements("starter").securitySuite === false);
  check("growth: securitySuite ON", planEntitlements("growth").securitySuite === true);
  check("agency (Business): securitySuite ON", planEntitlements("agency").securitySuite === true);
  check("enterprise: securitySuite ON", planEntitlements("enterprise").securitySuite === true);
  check("unknown/null plan: securitySuite OFF (fail-closed)", planEntitlements(null).securitySuite === false && planEntitlements("nonsense").securitySuite === false);

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — S2 security access (permission + entitlement)`);
  process.exit(failures === 0 ? 0 : 1);
}
run();
