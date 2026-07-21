# ADR-CS-0004 — Raw message content never enters the Tamanor cloud

**Status: Accepted (CS-C0).**

## Context
Reading children's messages would make the product spyware and create catastrophic
privacy/legal risk.

## Decision
The Child Safety Cloud accepts only a **strict-allowlist safety signal**. Raw text,
media, full conversations, open identifiers, credentials, and precise location are
forbidden and rejected. Detection runs platform-side; only signals leave the device.

## Alternatives considered
- Server-side content analysis (rejected: requires ingesting content — prohibited).

## Consequences
`SafetySignalEnvelope` + `validateSafetySignalEnvelope`; a Privacy Gateway (CS-C6).

## Security implications
Forbidden + unknown fields rejected, never stored (invariants 1–9).

## Migration impact
None (no endpoint/storage in CS-C0).
