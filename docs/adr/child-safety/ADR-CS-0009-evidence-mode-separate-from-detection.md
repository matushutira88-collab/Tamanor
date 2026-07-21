# ADR-CS-0009 — Evidence mode is separate from normal detection

**Status: Accepted (CS-C0).**

## Context
Normal detection is privacy-safe (signals only). Evidence collection is far more
sensitive and legally loaded.

## Decision
Evidence mode is a **separate mode**, gated by an explicit future evidence-sharing
consent workflow (`ConsentType.EvidenceSharing`), distinct from routine safety
detection. The C11–C12 compliance/redaction/export pipeline is **not** auto-applied to
Family data.

## Alternatives considered
- One mode for detection + evidence (rejected: forces content ingestion into the
  normal path).

## Consequences
Evidence flows require separate consent + retention (CS-C9).

## Security implications
Keeps the routine path content-free; evidence is opt-in and audited.

## Migration impact
None in CS-C0.
