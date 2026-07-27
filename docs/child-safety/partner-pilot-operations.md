# Child Safety — Partner Pilot & Integration Operations V1

The **operations & governance layer** on top of the [Integration Signal Protocol](./integration-signal-protocol.md)
and [Partner SDK](./partner-sdk.md). It turns a completed protocol/SDK into a controlled, auditable,
tenant-isolated partner-onboarding and pilot-management workflow. It is **content-free by construction**:
nothing here ingests raw communications, transcripts, media, credentials, private keys, child identities, or
guardian data — only bounded operational metadata and server-approved scope **bands**.

> This layer does **not** redesign the signal protocol, gateway, Policy Engine, incident domain, reviewer
> workflow, evidence system, protection plans, analytics, or Partner SDK. It only adds a governance lifecycle
> and a minimal production-gateway pilot gate.

## Pilot lifecycle

A pilot governs one **partner application** (a partner + application pair, an environment, and a bounded
scope). At most **one non-terminal pilot per application** exists at a time.

```
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED_FOR_SANDBOX → SANDBOX_ACTIVE
      → READINESS_REVIEW → READY_FOR_PILOT → PILOT_ACTIVE ⇄ PILOT_PAUSED
UNDER_REVIEW → CHANGES_REQUIRED → SUBMITTED   (rework loop)
UNDER_REVIEW → REJECTED                        (terminal)
any operational state → SUSPENDED → READINESS_REVIEW   (resume only via explicit re-review)
any non-terminal state → TERMINATED            (terminal, irreversible)
```

- **All transitions are server-validated** by an explicit state machine. There is **no client-selected
  status** — a mutation names an *action*, and the service computes the target.
- **Optimistic concurrency**: every pilot carries a `version`; a stale write is rejected with
  `version_conflict`.
- **Terminal states** (`TERMINATED`, `REJECTED`) can never be reopened.

### Status reference

| Status | Meaning |
| --- | --- |
| `DRAFT` | Editable request being prepared. |
| `SUBMITTED` | Handed to reviewers. |
| `UNDER_REVIEW` | Reviewers assessing privacy/security/legal + checks. |
| `CHANGES_REQUIRED` | Sent back for rework. |
| `APPROVED_FOR_SANDBOX` | Cleared to run in sandbox. |
| `SANDBOX_ACTIVE` | Sandbox compatibility testing underway. |
| `READINESS_REVIEW` | Final readiness verification. |
| `READY_FOR_PILOT` | All prerequisites met; awaiting explicit activation. |
| `PILOT_ACTIVE` | Limited production traffic accepted within the approved scope. |
| `PILOT_PAUSED` | Temporarily halted (reversible). |
| `SUSPENDED` | Fail-closed emergency stop; resume only via re-review. |
| `TERMINATED` / `REJECTED` | Terminal. |

## Readiness checks

Sixteen required checks are seeded on every pilot. Each is `NOT_STARTED → IN_REVIEW → PASSED/FAILED`, or
`WAIVED` where allowed. Activation requires **every** mandatory check to be `PASSED` (or `WAIVED` where
waivable).

**Non-waivable critical checks** (must be explicitly `PASSED` — never waived):

- `AUTHORIZATION_CONFIRMED`
- `DATA_MINIMIZATION_CONFIRMED`
- `RAW_CONTENT_EXCLUSION_CONFIRMED`
- `PRIVATE_KEY_OWNERSHIP_CONFIRMED`
- `SIGNATURE_COMPATIBILITY_CONFIRMED`

Waiving any other check requires an **elevated role**, a **bounded reason code**, records the **reviewer
identity + timestamp**, and emits an **audit event**.

## Approval authorities

| Capability | Owner | Admin | Safety Reviewer | Analyst | Viewer |
| --- | :--: | :--: | :--: | :--: | :--: |
| View pilots | ✓ | ✓ | ✓ | ✓ (aggregated) | — |
| Manage draft / scope / contacts | ✓ | ✓ | — | — | — |
| Review checks / assessments | ✓ | ✓ | ✓ | — | — |
| Activate pilot | ✓ | ✓ | — | — | — |
| Suspend (emergency) | ✓ | ✓ | ✓ | — | — |
| Terminate | ✓ | ✓ | — | — | — |
| Audit history | ✓ | ✓ | ✓ | — | — |

Activation is deliberately **separated from readiness review**: a Safety Reviewer signs off readiness, and an
Owner/Admin performs the activation transition — a two-person control. The Analyst view is **aggregated
only**: operational contacts, review notes, and bounded comments are withheld from a view-only role.

## Sandbox vs. production

- **Sandbox** installations continue to work under existing sandbox rules with **no pilot required**.
- **Production** installations require an **active, in-scope pilot**. See the gateway enforcement below.

## Compatibility tests

Stored, **content-free** verification runs against an ephemeral sandbox harness (a throwaway public key is
registered, the scenario runs through the real gateway, and the key is revoked immediately). A run stores only
the test type, result, a stable result code, bounded references, and a synthetic event reference — **never** a
private key, raw body, full signature, child data, or arbitrary headers.

Required-for-readiness tests (all must have **PASSED** — a `SKIPPED` run never counts): `SIGNATURE_COMPATIBILITY`,
`NONCE_REPLAY`, `IDEMPOTENCY_DUPLICATE`, `IDEMPOTENCY_CONFLICT`, `PAYLOAD_VALIDATION`. `RATE_LIMIT_BEHAVIOR` may
be recorded as `SKIPPED` and is **not** a required readiness test (rate-band enforcement is exercised at the
production gateway, not in a local loop).

## Production activation prerequisites

`activate` (`READY_FOR_PILOT → PILOT_ACTIVE`, Owner/Admin only) re-computes readiness fresh (never trusting a
stale stored value, so it can never ride an outdated evaluation) and, for a **production** pilot, additionally
requires — fail-closed — all of:

- readiness is `READY` (every mandatory + non-waivable check passed, all five required compatibility tests
  passed, required contacts present, no open critical alert, valid pilot window);
- approved capabilities include `signal.submit`;
- **approved risk categories are non-empty**;
- **the approved installation list is non-empty**;
- **every allowed installation belongs to this application and is active**;
- the application itself is active.

This guarantees an active production pilot can never carry an empty approved scope (which would otherwise let
the gateway's "empty = unrestricted" field behavior accept any category or installation). Activation is never
automatic — it always requires the explicit authorized call.

## Pilot scope

Configuration is **bounded** — server-controlled bands and allow-lists, never arbitrary partner-chosen
numbers:

- approved capabilities, risk categories, regions, age bands, allowed installation IDs;
- monthly-volume band and peak-rate band (`VERY_LOW … HIGH`) mapped to internal thresholds server-side;
- pilot start / review / end dates.

The exact defensive thresholds behind each band are intentionally **not documented here** and never exposed to
callers.

## Gateway pilot enforcement (production)

For a **production** installation, a signal is accepted only when an **active** pilot authorizes it:

- the pilot is `PILOT_ACTIVE`, within its start/end window;
- the installation is in the pilot's installation scope;
- the capability is approved;
- the risk category is within the approved categories;
- the age band is within the approved age bands;
- the peak-rate band is not exceeded (this can only *tighten* the base gateway limit, never weaken it).

Every unauthorized pilot state maps to the **existing `INTEGRATION_SUSPENDED` result** — a **non-enumerating**
response identical to a suspended installation, so a caller can never learn whether a pilot exists. The pilot
layer runs **after** authentication, replay, idempotency, validation, and capability checks, and therefore
**never weakens** them.

## Operational alerts

Content-free operational signals (`INVALID_SIGNATURE_SPIKE`, `REPLAY_ATTEMPT_SPIKE`,
`IDEMPOTENCY_CONFLICT_SPIKE`, `RATE_LIMIT_SPIKE`, `REVOKED_KEY_USAGE`, `SUSPENDED_INSTALLATION_USAGE`,
`PROTOCOL_VERSION_MISMATCH`, `PILOT_SCOPE_VIOLATION`, `SUBJECT_LINKING_FAILURE_SPIKE`) with `INFO / WARNING /
CRITICAL` severity. Only bounded counters and timestamps — no raw body, arbitrary payload, private key, full
signature, or child identity. Open alerts of the same type are deduplicated. An **open CRITICAL alert blocks
readiness**. Resolution requires authorization and is audited. This is intentionally **not** a full SIEM.

## Content-free audit model

Every governance action appends to an **append-only** pilot event log and writes a bounded audit entry. Event
rows carry only the event type, actor, from/to status, a reason code, and a short operational summary — never
raw content, credentials, keys, full IPs, or child identities.

## Privacy restrictions (enforced)

- No raw messages, transcripts, media, attachments, or screens.
- No platform credentials, tokens, cookies, or private keys — Tamanor stores public keys only.
- No device surveillance, no login automation, no partner-API bypass.
- No guardian or authority is contacted automatically; no intervention is executed by this layer.
- No real child identities are exposed; subject links stay pseudonymous.
- A risk signal describes a detected pattern, **not** proven guilt; pilot approval does **not** by itself
  establish legal compliance.

See the [runbook](./partner-pilot-runbook.md) for step-by-step operational procedures.
