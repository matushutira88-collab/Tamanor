# CS-C0 — Existing Architecture Audit

> Findings from auditing the Tamanor codebase before locking the Child Safety
> architecture. Source of truth for the CS-C0 decisions.

## Tenant & Membership

- **`Tenant`** (`packages/db/prisma/schema.prisma`) is a **general** entity: `id`,
  `name`, `slug`, `plan`, billing, deletion lifecycle. `name` is a free workspace
  name; `country` is optional; there are **no mandatory company-only fields**. ⇒ It
  can safely represent a Family space. CS-C0 adds an immutable `workspaceKind`.
- **`User`** is **global** (not tenant-scoped); identity lives on `User`, tenant
  membership on `Membership` (`@@unique([userId, tenantId])`). ⇒ One user can already
  hold multiple memberships across tenants.
- **Active tenant**: the session (`packages/db/src/session.ts`) stores
  `activeTenantId`; `switchActiveTenant` changes it after re-validating Membership.
  The session carries `tenantId` (+ now `workspaceKind`); tenant scope is enforced by
  Postgres RLS (`withTenant` sets `app.tenant_id`; every tenant table is
  `ENABLE + FORCE ROW LEVEL SECURITY` with a `tenant_isolation` policy).

## Roles & Permissions

- **`Role`** (`packages/core/src/tenant.ts`): `owner/admin/analyst/reviewer/viewer` —
  business roles, tenant-scoped, stored on `Membership.role`. No family/organization
  roles existed; CS-C0 adds `FamilyRole` + `OrganizationRole` **foundation enums**
  (not yet DB-backed).
- **`Permission`** catalog + `ROLE_PERMISSIONS` (`permissions.ts`) is business-shaped.
  Capabilities were **not** previously bound to a workspace kind — CS-C0 introduces
  `WorkspaceCapability` + `WORKSPACE_CAPABILITIES` for kind-level gating **on top of**
  RBAC + RLS.

## Billing & Entitlements

- Every tenant has a `plan` + `PlanEntitlements` (`entitlements.ts`, `hasEntitlement`).
  Trial/entitlement logic assumes a Business workspace. CS-C0 does **not** change
  Business billing; it locks that Family entitlement resolution will branch on
  `workspaceKind` in a later sprint (Family must not inherit Starter/Growth/Agency
  limits). See ADR + §23.

## UI & Routing

- The dashboard (`apps/web/src/app/dashboard/layout.tsx`) assumes a business account
  and computes `deniedNavHrefs` via RBAC. Nav lives in `@/lib/nav` (`DASHBOARD_NAV`),
  rendered by `components/dashboard/sidebar.tsx`. Onboarding/registration currently
  target Business. CS-C0 hardens the layout so **business nav is denied in any
  non-business workspace** (server-side; no-op for existing tenants).
- A tenant **switcher** exists (`switchActiveTenant`), re-validating Membership.

## Data models

- Every domain table is tenant-scoped + RLS-forced. RLS previously checked **only
  `tenantId`**, not workspace type — so a Family table could in theory be reached by a
  Business role at the same tenant **if the two shared a tenant**. CS-C0 removes that
  risk architecturally: **BUSINESS and FAMILY never share a tenant** (ADR-CS-0002),
  and capabilities gate by `workspaceKind` above RLS.

## Conclusion

The existing architecture is Business-shaped but structurally general enough to host
a separate Child Safety domain via a per-tenant `workspaceKind` + capability registry
+ server guards, with **zero behaviour change for existing (business) tenants**.
