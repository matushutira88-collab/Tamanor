# ADR-CS-0003 — One User may belong to multiple workspace kinds

**Status: Accepted (CS-C0).**

## Context
A parent may be an Owner of a Business workspace and a Guardian in a Family Safety
Space. Identity is global (`User`); tenant access is per-`Membership`.

## Decision
A `User` may hold Membership in many workspaces of different kinds. Each Membership is
independent; a Membership in one kind grants **no** access to another. The active
workspace is chosen explicitly via the switcher, which re-validates Membership.

## Alternatives considered
- One account per kind (rejected: poor UX, credential sprawl).

## Consequences
Query keys and server actions must include the active workspace/tenant; the switcher
must not leak previous-workspace data.

## Security implications
Business Membership never yields Family capabilities (verified by tests).

## Migration impact
None (Membership model already supports multiple memberships).
