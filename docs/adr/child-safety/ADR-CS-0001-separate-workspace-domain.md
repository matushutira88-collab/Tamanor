# ADR-CS-0001 — Child Safety is a separate workspace domain

**Status: Accepted (CS-C0).**

## Context
Child Safety has a fundamentally different data model, privacy regime, user base
(guardians/children, not brand teams), and legal exposure than the Business
(reputation/cyberbullying) product. Bolting it onto the Business workspace would blur
capability boundaries and risk cross-domain data exposure.

## Decision
Child Safety is modelled as a **separate workspace domain**, keyed by an immutable
`WorkspaceKind` on the existing `Tenant` entity. It is **not** a separate backend or
a separate application — it remains a distinct domain inside the one Tamanor codebase.

## Alternatives considered
- A separate application/service (rejected: duplicate auth/session/billing, higher
  cost, no shared audit/compliance foundations).
- A feature flag on Business tenants (rejected: cannot guarantee data separation;
  a Business admin would gain implicit Family access).

## Consequences
- New `WorkspaceKind`, capability registry, and server guards.
- Family features are gated by kind, invisible in Business, and vice-versa.

## Security implications
Capability separation above RLS; a tenantId alone never grants cross-domain access.

## Migration impact
Additive `workspaceKind` column, default `business`; no behaviour change.
