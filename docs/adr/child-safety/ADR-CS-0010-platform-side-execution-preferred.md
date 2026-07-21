# ADR-CS-0010 — Platform-side execution is the preferred integration architecture

**Status: Accepted (CS-C0).**

## Context
To honour "raw content never enters the cloud", detection must run where the content
already is — on the platform/client side.

## Decision
The **preferred integration architecture is platform-side execution**: the detector
runs on the platform/SDK and emits only allowlisted safety signals to Tamanor. Tamanor
never pulls messages, never connects a mailbox, and performs no Meta production
integration in this track's foundation.

## Alternatives considered
- Server-side ingestion + analysis (rejected: violates ADR-CS-0004).

## Consequences
Platform Integration Contract + SDK foundation (CS-C14); Privacy Gateway (CS-C6).

## Security implications
Minimizes data egress; the cloud sees only signals.

## Migration impact
None in CS-C0.
