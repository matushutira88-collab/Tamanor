/**
 * V1.71 (Release B / B4) — PURE tests for team/seat logic (no DB): email normalization, seat accounting
 * (owner + active + pending, unlimited), last-owner guard, and the DETERMINISTIC downgrade selection of
 * over-limit memberships. Run: pnpm team:test
 */
import {
  normalizeEmail, seatUsage, seatsAvailable, seatsRemaining, isOverSeatLimit, isLastOwner,
  selectOverLimitMemberships, isInviteExpired, isAssignableRole, ASSIGNABLE_ROLES, type MemberRef,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => { console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`); cond ? pass++ : fail++; };
const t = (n: number) => new Date(2026, 0, 1 + n);

function run() {
  check("normalizeEmail trims + lowercases", normalizeEmail("  Foo@Bar.COM ") === "foo@bar.com");

  // seat accounting
  check("seat usage = active + pending", seatUsage(3, 2) === 5);
  check("seatsAvailable false at cap, true below", !seatsAvailable(3, 3) && seatsAvailable(2, 3));
  check("unlimited (null) always available; remaining null", seatsAvailable(9999, null) && seatsRemaining(9999, null) === null);
  check("remaining never negative", seatsRemaining(5, 3) === 0 && seatsRemaining(1, 3) === 2);
  check("isOverSeatLimit only when members exceed cap (unlimited never)", isOverSeatLimit(4, 3) && !isOverSeatLimit(3, 3) && !isOverSeatLimit(999, null));

  // last owner
  check("last owner cannot be removed/demoted", isLastOwner("owner", 1) && !isLastOwner("owner", 2) && !isLastOwner("admin", 1));

  // assignable roles (owner not invitable)
  check("owner is NOT an assignable invite role", !isAssignableRole("owner") && isAssignableRole("admin") && [...ASSIGNABLE_ROLES].sort().join(",") === "admin,analyst,reviewer,viewer");

  // deterministic downgrade selection
  const members: MemberRef[] = [
    { id: "own", role: "owner", createdAt: t(0) },
    { id: "m1", role: "admin", createdAt: t(1) },
    { id: "m2", role: "analyst", createdAt: t(2) },
    { id: "m3", role: "viewer", createdAt: t(3) },
  ];
  check("downgrade to 2 seats: keep owner + oldest non-owner (m1), flag m2,m3 (newest)",
    JSON.stringify(selectOverLimitMemberships(members, 2).sort()) === JSON.stringify(["m2", "m3"]));
  check("downgrade to 1 seat: keep only owner, flag all non-owners",
    JSON.stringify(selectOverLimitMemberships(members, 1).sort()) === JSON.stringify(["m1", "m2", "m3"]));
  check("unlimited: nothing over limit", selectOverLimitMemberships(members, null).length === 0);
  check("within limit: nothing flagged", selectOverLimitMemberships(members, 4).length === 0);
  check("selection is deterministic (not random)", JSON.stringify(selectOverLimitMemberships(members, 2)) === JSON.stringify(selectOverLimitMemberships([...members].reverse(), 2)));

  // invite expiry
  check("isInviteExpired", isInviteExpired(t(-1), t(0)) && !isInviteExpired(t(5), t(0)));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — team/seat logic (V1.71 B4): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
