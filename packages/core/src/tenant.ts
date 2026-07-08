import type { TenantId, UserId, IsoTimestamp } from "./ids";

/** A Tenant is a billing/account boundary. It owns brands, users, and data. */
export interface Tenant {
  id: TenantId;
  name: string;
  /** URL-safe slug used in routing. */
  slug: string;
  /** Billing plan key (billing itself lives outside core). */
  plan: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface User {
  id: UserId;
  email: string;
  name?: string;
  /** Preferred UI language (BCP-47). */
  locale: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** Roles within a tenant. Drives authorization across the product. */
export enum Role {
  /** Full control incl. billing and member management. */
  Owner = "owner",
  /** Manage brands, connectors, rules, and members. */
  Admin = "admin",
  /** Triage the inbox, draft replies, and act on reputation items. */
  Analyst = "analyst",
  /** Review and approve/reject proposed actions. */
  Reviewer = "reviewer",
  /** Read-only access to inbox, reports, and audit log. */
  Viewer = "viewer",
}

export const ALL_ROLES: readonly Role[] = Object.values(Role);

/** Membership links a User to a Tenant with a Role. */
export interface Membership {
  userId: UserId;
  tenantId: TenantId;
  role: Role;
  createdAt: IsoTimestamp;
}

/**
 * The resolved identity for a request. This is the single seam the app depends
 * on — a dev/mock auth provider and a real auth provider both produce a
 * {@link Session}, so swapping providers requires no downstream changes.
 */
export interface Session {
  user: User;
  tenant: Tenant;
  role: Role;
}
