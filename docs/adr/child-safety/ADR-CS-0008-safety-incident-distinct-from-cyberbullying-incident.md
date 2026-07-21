# ADR-CS-0008 — SafetyIncident is distinct from CyberbullyingIncident

**Status: Accepted (CS-C0).**

## Context
A privacy-safe Safety Incident (aggregated signals) is not the same as a human
case-managed Cyberbullying Incident (evidence, SLA, compliance).

## Decision
`SafetyIncident` ≠ `CyberbullyingIncident`. A Safety Incident may later be promoted to
a Cyberbullying Incident only via an **explicit, auditable, idempotent, content-free**
human workflow that reuses the existing `Incident` case ledger — never a second
general Case model.

## Alternatives considered
- Auto-create a Cyberbullying Incident per Safety Incident (rejected: no human
  decision; content/scope mismatch).

## Consequences
See `child-safety-cyberbullying-boundary.md`.

## Security implications
No automatic content transfer or lifecycle change across domains.

## Migration impact
None in CS-C0.
