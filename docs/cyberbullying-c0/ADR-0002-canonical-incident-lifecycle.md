# ADR-0002 — Canonical Incident Lifecycle

**Status:** Accepted (C0 contract) · **Sprint:** C0

## Context — three lifecycles exist/are proposed
1. **DB `Incident.status`** (in use): `open`, `resolved`.
2. **Core `IncidentLifecycleStatus`** (defined S0, **unused** by DB): `open`,
   `investigating`, `contained`, `resolved`, `post_mortem`.
3. **Proposed cyberbullying** (from the architecture doc): `detected`,
   `under_review`, `acknowledged`, `confirmed`, `dismissed`, `action_required`,
   `resolved`, `archived`.

The brief forbids a **third** independent lifecycle and requires **one canonical
lifecycle** for the whole `Incident` ledger. It also requires distinguishing
Detection, Incident, and ProtectiveAction lifecycles.

## Decision — one canonical Incident lifecycle
Adopt a single state machine for **every** incident (brand and cyberbullying):

```
open → under_review → acknowledged → confirmed → action_required → resolved → archived
  │          │             │              │
  └──────────┴─────────────┴──────────────┴──────────────► dismissed (terminal)
```

- `detected` is **NOT** an Incident state — it belongs to the **Detection**
  lifecycle. An incident begins at `open` (opened from a linked detection or a
  manual report).
- `dismissed` and `archived` are **terminal**. `resolved` is a settled but
  non-terminal state that may be `archived` or (via reopen) revisited.

### Canonical states (meaning)
| State | Meaning |
| --- | --- |
| `open` | Case exists (from a detection link or a manual report); not yet picked up. |
| `under_review` | An authorized reviewer is assessing it. |
| `acknowledged` | The org/authorized person accepted the case and ownership of next steps. |
| `confirmed` | After review, confirmed as an incident per internal policy. |
| `action_required` | Confirmed case that needs a specific protective/escalation action. |
| `resolved` | Immediate measures and mandatory steps completed. Not a denial that harm occurred. |
| `archived` | No longer active; under the retention regime. **Terminal.** |
| `dismissed` | Judged incorrect, insufficient, or out of scope. Requires a reason. **Terminal.** |

### Transition matrix
| From \ To | under_review | acknowledged | confirmed | action_required | resolved | dismissed | archived |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **open** | ✅ | — | — | — | — | ✅ | — |
| **under_review** | — | ✅ | — | — | — | ✅ | — |
| **acknowledged** | — | — | ✅ | — | — | ✅ | — |
| **confirmed** | — | — | — | ✅ | ✅ | — | — |
| **action_required** | — | — | — | — | ✅ | — | — |
| **resolved** | — | — | — | — | — | — | ✅ |
| **dismissed** (terminal) | — | — | — | — | — | — | — |
| **archived** (terminal) | — | — | — | — | — | — | — |

- **Forbidden:** any transition not in the matrix; identity transitions (no-op);
  any raw backward write out of a terminal state.
- **Reopen** is an **explicit, audited operation** (not a raw back-transition):
  `resolved → under_review` and `archived → under_review`, each requiring a
  **reason** and the `incident:manage` (or cyberbullying `:manage`) permission.
  Reopen emits its own audit event (`*.incident.reopened`).
- **Mandatory reason fields:** `dismissed` (dismissal reason), `resolved`
  (resolution summary), and every `reopen` (reason). `action_required` should
  carry the required-action reference.

### Permission requirements (per transition)
| Transition | Required permission |
| --- | --- |
| open → under_review, → dismissed | `cyberbullying:review` (or `incident:manage` for brand) |
| under_review → acknowledged / confirmed / dismissed | `cyberbullying:review` |
| confirmed → action_required / resolved | `cyberbullying:manage` |
| action_required → resolved | `cyberbullying:manage` |
| resolved → archived | `cyberbullying:manage` |
| reopen (resolved/archived → under_review) | `cyberbullying:manage` + reason |

### Mapping existing states
| Existing | Canonical |
| --- | --- |
| DB `open` | `open` |
| DB `resolved` | `resolved` |
| core `investigating` | `under_review` |
| core `contained` | `action_required` |
| core `post_mortem` | `archived` |
| cyberbullying `detected` | **Detection** lifecycle (not Incident) |
| cyberbullying `under_review/acknowledged/confirmed/dismissed/action_required/resolved/archived` | same-named canonical states |

The unused core `IncidentLifecycleStatus` is superseded by this canonical set;
C0 records that reconciliation so no third lifecycle is introduced.

## The three DISTINCT lifecycles (never merged)
| Lifecycle | States | Owner |
| --- | --- | --- |
| **Detection** (`SecurityDetection.status`, existing) | open · acknowledged · confirmed · dismissed · resolved | a signal |
| **Incident** (this ADR) | open · under_review · acknowledged · confirmed · action_required · resolved · dismissed · archived | a reviewed case |
| **ProtectiveAction** (conceptual, doc 4.11) | proposed · approved · executing · completed · failed · cancelled | a remediation step |

**Detection ≠ Incident.** A detection is a signal; an incident is a reviewed
case that may aggregate detections, evidence, participants, and timeline events.

## Consequences
- Brand incidents keep `open`/`resolved` as a **subset path** of the canonical
  machine (backward compatible: existing values are valid canonical states).
- Audit events are defined per transition (see 08-audit-event-vocabulary).
- Reopen never silently rewrites state; it is a first-class, reasoned, audited op.
- No third lifecycle is created; `SecurityDetection` keeps its own lifecycle.
