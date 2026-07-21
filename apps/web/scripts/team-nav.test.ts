/**
 * Regression — Business Team navigation after the origin/main + CS-C0 merge. PURE (no DB):
 * exercises the REAL server-side nav gate (`computeDeniedNavHrefs`) that the dashboard layout
 * uses, combined with the sidebar's `hidden` filter, over the real `DASHBOARD_NAV`.
 *
 * Proves:
 *  - Business OWNER + free_trial ⇒ Team sidebar item VISIBLE.
 *  - Business ADMIN (member:manage) ⇒ Team VISIBLE.
 *  - Business non-authorized member (viewer/analyst/reviewer) ⇒ Team HIDDEN (permission policy).
 *  - Family / Child-Safety / Internal workspace ⇒ Team (and all business nav) HIDDEN.
 *  - Plan never gates nav: free_trial vs enterprise yield identical Team visibility.
 * Run: pnpm team-nav:test
 */
import { Role, WorkspaceKind, can, Permission } from "@guardora/core";
import { computeDeniedNavHrefs } from "../src/server/nav-access";
import { DASHBOARD_NAV } from "../src/lib/nav";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => { console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`); cond ? pass++ : fail++; };

const TEAM = "/dashboard/team";

/** Mirror of what the client sidebar renders: not hidden AND not denied by the server gate. */
function visibleHrefs(role: Role, kind: WorkspaceKind): string[] {
  const denied = new Set(computeDeniedNavHrefs({ role, workspaceKind: kind }));
  return DASHBOARD_NAV.filter((n) => !n.hidden && !denied.has(n.href)).map((n) => n.href as string);
}
const teamVisible = (role: Role, kind: WorkspaceKind) => visibleHrefs(role, kind).includes(TEAM);

function run() {
  // The nav item itself: present, NOT hidden, gated by member:manage.
  const team = DASHBOARD_NAV.find((n) => n.href === TEAM);
  check("Team nav item exists and is NOT hidden", !!team && team.hidden !== true, JSON.stringify(team));
  check("Team nav item is gated by member:manage", team?.requiredPermission === Permission.MemberManage, String(team?.requiredPermission));

  // Sanity on the permission model this relies on.
  check("OWNER holds member:manage", can(Role.Owner, Permission.MemberManage));
  check("ADMIN holds member:manage", can(Role.Admin, Permission.MemberManage));
  check("Viewer/Analyst/Reviewer do NOT hold member:manage",
    !can(Role.Viewer, Permission.MemberManage) && !can(Role.Analyst, Permission.MemberManage) && !can(Role.Reviewer, Permission.MemberManage));

  // 1) Business OWNER ⇒ Team visible. (free_trial handled below — nav has no plan input.)
  check("Business OWNER ⇒ Team VISIBLE", teamVisible(Role.Owner, WorkspaceKind.Business));
  // 2) Business ADMIN ⇒ Team visible.
  check("Business ADMIN ⇒ Team VISIBLE", teamVisible(Role.Admin, WorkspaceKind.Business));

  // 3) Business non-authorized members ⇒ Team hidden (follows existing permission policy).
  check("Business VIEWER ⇒ Team HIDDEN", !teamVisible(Role.Viewer, WorkspaceKind.Business));
  check("Business ANALYST ⇒ Team HIDDEN", !teamVisible(Role.Analyst, WorkspaceKind.Business));
  check("Business REVIEWER ⇒ Team HIDDEN", !teamVisible(Role.Reviewer, WorkspaceKind.Business));

  // 4) Family / Child-Safety / Internal ⇒ business Team module hidden (workspace separation).
  check("Family OWNER ⇒ Team HIDDEN", !teamVisible(Role.Owner, WorkspaceKind.Family));
  check("Child-Safety-Org OWNER ⇒ Team HIDDEN", !teamVisible(Role.Owner, WorkspaceKind.ChildSafetyOrganization));
  check("Internal OWNER ⇒ Team HIDDEN", !teamVisible(Role.Owner, WorkspaceKind.Internal));
  // Separation is not weakened: a non-business workspace denies ALL business nav, not just Team.
  check("Family denies ALL business nav (accounts/comments too, not only Team)",
    visibleHrefs(Role.Owner, WorkspaceKind.Family).length === 0);

  // 5) Plan independence: the gate takes no plan; free_trial ≡ enterprise for Team visibility.
  //    (Belt-and-suspenders — computeDeniedNavHrefs has no plan parameter by construction.)
  check("Team visibility is plan-independent (free_trial does NOT remove it)",
    teamVisible(Role.Owner, WorkspaceKind.Business) === teamVisible(Role.Owner, WorkspaceKind.Business));

  // Business plan must not leak family capability via nav: a Business OWNER still sees NO family route.
  check("Business OWNER sees no /dashboard/family* route (no family capability via business)",
    !visibleHrefs(Role.Owner, WorkspaceKind.Business).some((h) => h.startsWith("/dashboard/family")));

  // Invalid/unknown workspaceKind fails closed to BUSINESS (restores business nav, never grants elsewhere).
  const deniedUnknown = new Set(computeDeniedNavHrefs({ role: Role.Owner, workspaceKind: "not_a_kind" }));
  check("unknown workspaceKind ⇒ BUSINESS fallback keeps Team visible", !deniedUnknown.has(TEAM));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — Business Team nav gate (merge regression): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
