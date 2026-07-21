/**
 * V1.71 (Release B / B4) — pure team-membership + seat logic (no DB). Seat accounting (owner + active
 * members + pending invites), the last-owner guard, and the DETERMINISTIC downgrade selection of
 * over-limit memberships. Token generation/hashing lives in the DB layer (node crypto); this stays pure.
 */

export type TeamRole = "owner" | "admin" | "analyst" | "reviewer" | "viewer";
export const TEAM_ROLES: readonly TeamRole[] = ["owner", "admin", "analyst", "reviewer", "viewer"];
/** Roles that may be assigned via an invite / role change (owner is transferred, never invited). */
export const ASSIGNABLE_ROLES: readonly TeamRole[] = ["admin", "analyst", "reviewer", "viewer"];

export function isTeamRole(r: string): r is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(r);
}
export function isAssignableRole(r: string): r is TeamRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(r);
}

/** Canonical email form for dedupe + matching (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---- Seats ----------------------------------------------------------------------------------------
// A seat = one active membership (the owner ALWAYS counts) OR one PENDING invite (a reserved seat).
// Expired/revoked invites don't count. maxSeats null = unlimited (Enterprise) — never a false numeric cap.

export function seatUsage(activeMembers: number, pendingInvites: number): number {
  return Math.max(0, activeMembers) + Math.max(0, pendingInvites);
}
export function seatsAvailable(usage: number, maxSeats: number | null): boolean {
  return maxSeats === null || usage < maxSeats;
}
export function seatsRemaining(usage: number, maxSeats: number | null): number | null {
  return maxSeats === null ? null : Math.max(0, maxSeats - usage);
}
export function isOverSeatLimit(usage: number, maxSeats: number | null): boolean {
  return maxSeats !== null && usage > maxSeats;
}

/** The last owner can never be removed or demoted. */
export function isLastOwner(role: TeamRole, ownerCount: number): boolean {
  return role === "owner" && ownerCount <= 1;
}

/**
 * DETERMINISTIC downgrade selection: which memberships are "over the plan's seat limit". Every OWNER is
 * kept; the OLDEST non-owner members fill the remaining seats; the newest non-owner members beyond the
 * cap are returned (flagged as over-limit). They are NEVER deleted or deactivated here — access is
 * preserved and new seats are blocked until the tenant is back within limit. Not a random selection.
 */
export type MemberRef = { id: string; role: TeamRole; createdAt: Date };
export function selectOverLimitMemberships(members: MemberRef[], maxSeats: number | null): string[] {
  if (maxSeats === null) return [];
  const owners = members.filter((m) => m.role === "owner");
  const nonOwners = members
    .filter((m) => m.role !== "owner")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const remaining = Math.max(0, maxSeats - owners.length);
  return nonOwners.slice(remaining).map((m) => m.id);
}

// ---- Invites --------------------------------------------------------------------------------------
export const INVITE_TTL_DAYS = 7;
export const INVITE_RESEND_COOLDOWN_MS = 60 * 1000;

export function isInviteExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
export function inviteExpiryFrom(now: Date = new Date(), ttlDays: number = INVITE_TTL_DAYS): Date {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}
