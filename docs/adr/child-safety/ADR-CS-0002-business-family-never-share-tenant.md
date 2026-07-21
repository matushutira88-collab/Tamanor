# ADR-CS-0002 — Business and Family data never share one tenant

**Status: Accepted (CS-C0).**

## Context
The same person may run a company and protect their own children. If Business and
Family data lived in one tenant, RLS (which checks only `tenantId`) could not stop a
Business role from reaching Family data.

## Decision
A tenant has exactly one `WorkspaceKind`. **BUSINESS and FAMILY data never coexist in
one tenant.** A user who needs both holds two separate Memberships in two tenants.

## Alternatives considered
- Row-level `workspaceKind` on each domain table (rejected: fragile; one missed
  filter leaks data). One-kind-per-tenant makes leakage structurally impossible.

## Consequences
Domain data separation is guaranteed by tenant boundary + kind; capabilities gate by
kind on top of RLS.

## Security implications
No implicit cross-domain access even for the same User account.

## Migration impact
None for existing tenants (all BUSINESS). Family tenants are created fresh.
