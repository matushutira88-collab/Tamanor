# ADR-CS-0005 — Safety signals use strict allowlist contracts

**Status: Accepted (CS-C0).**

## Context
An open payload invites accidental or malicious inclusion of raw content in "extra"
fields.

## Decision
The signal contract is a **strict allowlist**. Unknown fields are rejected (not
stored). Every signal carries `contractVersion`, `taxonomyVersion`, `detectorVersion`,
`nonce` (anti-replay), and `signature`.

## Alternatives considered
- Denylist only (rejected: any new field bypasses it). Allowlist fails closed.

## Consequences
Versioned contract; the gateway rejects non-conforming payloads.

## Security implications
Prevents payload smuggling; enables replay detection + provenance.

## Migration impact
None (types + validator only in CS-C0).
