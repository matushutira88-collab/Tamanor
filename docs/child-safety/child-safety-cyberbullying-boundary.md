# Child Safety ↔ Cyberbullying Boundary

> **Status: Accepted (CS-C0).** Locks the responsibility split between the new Child
> Safety domain and the existing Cyberbullying (C0–C12) domain.

## Child Safety domain owns

- Protected Profiles
- Guardian Relationships
- Platform Connections (safety, no mailbox access)
- Safety Signals (privacy-safe, strict allowlist)
- Safety Incident aggregation
- Consent
- Safe-recipient evaluation
- Guardian alert candidates
- Privacy Gateway

## Existing Cyberbullying domain owns

- Human case management (`Incident` = the case)
- Evidence (local storage, hashing, custody)
- Assignments, reviewer notes
- SLA + escalation
- Compliance snapshots (C11)
- Redaction + four-eyes approval + export authorization (C12)

## The bridge (future, explicit)

```
SafetyIncident
  → Human review / policy decision
  → Create OR link a Cyberbullying Incident
```

This bridge, when it ships (targeted CS-C8+), must be:

- **explicit** — never automatic;
- **auditable** — recorded in both domains' audit namespaces;
- **idempotent** — a replay links the same incident, never a duplicate;
- **tenant-safe** — same tenant + workspace scope on both sides;
- **content-free** — no raw content crosses the boundary;
- **model-preserving** — it reuses the existing `Incident` case ledger; it must
  **not** create a second general Case model.

## Non-negotiables

- A **Safety Incident ≠ Cyberbullying Incident** by default (ADR-CS-0008).
- Family and Business data never share a tenant (ADR-CS-0002), so this bridge is a
  deliberate cross-workspace referral workflow, not an implicit join.
- The C11–C12 compliance/export pipeline is **not** auto-applied to Family data
  (retention foundation, §25).
