# ADR-CS-0007 — ProtectedProfile is not automatically a User

**Status: Accepted (CS-C0).**

## Context
A protected child is not a normal platform account holder. Treating the child as a
full User/Membership would grant inappropriate access and store inappropriate data.

## Decision
`ProtectedProfile` is a distinct concept, **not** a `User` or `Membership`. It never
stores a child password, Messenger password, message content, open platform token,
advertising profile, or precise location by default. A child may gain a dedicated safe
access model later, but never as a guardian/admin. Guardianship is a separate
`GuardianRelationship` (not a single `guardianUserId` on the profile).

## Alternatives considered
- Child-as-User (rejected: over-collection, wrong access model).

## Consequences
`ProtectedProfile` + `GuardianRelationship` foundation (fields locked; tables in CS-C1).

## Security implications
Minimizes data on the most vulnerable subject; supports multiple guardians + authority
levels + suspension.

## Migration impact
None (no tables in CS-C0).
