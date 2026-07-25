# CS-C15 — End-to-End Protective Intervention

How an accepted, minimized `SafetySignal` becomes a real, authorized protective action.

> **Tamanor reduces risk and improves intervention speed. It cannot guarantee 100% protection.** Raw
> private conversation is **never** delivered to guardians by default, and **no recipient is notified
> without all required authorization gates.**

## End-to-end flow

```
CS-C6 gateway persists a minimized SafetySignal
  → interveneOnAcceptedSafetySignal(signalId, tenantId)      (tenant-scoped; content-free)
    → load protected profile
    → for each candidate guardian: evaluateRecipientAuthorization  (the canonical full chain)
        [ active guardian relationship + effective guardian authority + active consent
          + approved safe-recipient assessment + recipient authorization ]
    → deterministic intervention policy (decideIntervention)
    → side effects, exactly-once:
        · authorized guardian delivery (existing delivery service, idempotency-keyed)
        · review / incident create-or-update / urgent internal escalation
    → bounded SYSTEM audit
  → privacy-safe gateway receipt { accepted, receiptId, signalId, duplicate, outcome, ... }
```

The orchestrator acts as the tenant's **owner member** (`Role.owner → FamilyRole.PrimaryGuardian`) so
every existing authorization, RLS, and audit rule applies unchanged. It creates **no** parallel model.

## Authorization gates (all fail-closed)

Notification to a guardian requires **all** of: an active, non-revoked guardian relationship for the
correct profile; effective guardian authority; active required consent (not expired/withdrawn/
suspended/disputed); an approved safe-recipient assessment; and a resolved recipient authorization —
exactly what `evaluateRecipientAuthorization` enforces. Any missing fact ⇒ **denied** (no delivery).
An email or account relationship alone is never authority. Missing/unsafe/blocked/revoked/expired
recipients are excluded.

## Consent behavior

Consent is read live via the canonical consent lifecycle at authorization time. Withdrawn, expired, or
suspended consent immediately blocks delivery (fail-closed) — the signal is still recorded and may be
queued for internal review, but nothing is disclosed.

## Safe-recipient requirement

Only a recipient whose safe-recipient assessment is **approved/eligible** can receive information. A
guardian is **not** automatically a safe recipient.

## Deterministic policy matrix

| Confidence / risk | Outcome |
|---|---|
| Low confidence | `LOCAL_SAFETY_GUIDANCE` / `QUEUE_FOR_REVIEW`; **never** notify |
| Moderate + fully authorized | `NOTIFY_AUTHORIZED_GUARDIAN` |
| Moderate, not authorized | `QUEUE_FOR_REVIEW` (no notify) |
| High severity + fully authorized | `CREATE_OR_UPDATE_INCIDENT` + notify |
| High severity, any gate fails | internal review / incident, **no** unauthorized disclosure |
| Urgent (sextortion, meeting attempt, critical) | `URGENT_ESCALATION` + incident + internal escalation; notify only an authorized safe recipient |
| Repeated (≥3) same-family within window | update/create incident |

Risk families (for correlation only, never a verdict): sexual, grooming, violence, coercion, scam,
bullying, identity. **Incident correlation window: 30 days**, same tenant + profile + related family.
An existing incident's severity/urgency is **never lowered**.

## Durable intervention state (CS-C15B)

Every accepted signal gets exactly **one** durable record (`child_safety_interventions`, unique per
signal) tracking each step's status (`pending|done|skipped`) + opaque reference, the coarse incident
severity/urgency, an attempt counter, the last failure class, a next-retry time, and completion. It is
a SYSTEM table (owner-role only; `REVOKE`d from the app role) and holds **no** raw content, recipient
contact, or secret — only ids, coarse enum labels, and bounded failure metadata.

> **The intervention record is an execution *ledger*, not an incident.** It tracks *that the flow ran*
> and *which canonical side effects succeeded* (via opaque references). It is **not** the incident, the
> escalation, or the review — those are their own canonical records (below). A reference/status in the
> ledger is never a substitute for the real domain record.

## Canonical incident & escalation domain (CS-C15C)

The incident and escalation are **real, persisted domain records** — not references inside the ledger.
Three SYSTEM tables (owner-role only; all privileges `REVOKE`d from `tamanor_app`), all content-free:

| Table | Purpose | Exactly-once guarantee |
|---|---|---|
| `child_safety_incidents` | one canonical incident per correlated group | correlation + advisory lock |
| `child_safety_incident_signals` | the real `SafetySignal → incident` link | `safetySignalId` **unique** |
| `child_safety_escalations` | the canonical internal escalation | `(incidentId, escalationType)` **unique** |

**Correlation authority lives in the incident service** (`correlateAndLinkSignal`), not the orchestrator.
It correlates a signal into an eligible **active** (non-terminal) incident for the same
`(tenant, protected profile, risk family)` whose `lastSignalAt` is within the **30-day** window, else
creates a new incident, then links the signal exactly once and elevates `severity`/`urgency`/
`signalCount` **monotonically** (never lowered). A per-group transaction-scoped advisory lock serializes
concurrent correlations; the unique link index is the belt-and-suspenders — simultaneous attempts
converge to **one** incident + **one** link.

**Risk-family correlation matrix** — only same-family signals correlate (a family is never a verdict):

| Risk types | Family |
|---|---|
| SexualSolicitation, Sextortion | `sexual` |
| Grooming, MeetingAttempt | `grooming` |
| Threat | `violence` |
| Coercion | `coercion` |
| ScamExploitation | `scam` |
| Cyberbullying | `bullying` |
| IdentityManipulation | `identity` |

Different families ⇒ **separate** incidents. A terminal (resolved/closed) incident is **never** reused —
a later same-family signal opens a new incident.

**Escalation** (`createOrReuseEscalation`) is fail-closed (the incident must exist in-tenant, also
enforced by the composite FK), creates the escalation **exactly once per `(incident, type)`**, flips the
incident's `escalationState → escalated`, and fires **exactly one internal notification** through the
**existing** canonical `createNotification` path (`type: child_safety_escalation`, dedupe-idempotent,
minimized metadata: coarse family/severity/urgency + reason + opaque incident/escalation refs only). A
second urgent signal in the same group **reuses** the existing escalation and notification — no duplicate.
**Internal only** — no police, school, emergency-service, or third-party reporting; no new notification
platform (the existing path is reused).

**Tenant isolation is enforced at the DB level.** Every incident/link/escalation carries `tenantId`, and
composite `(id, tenantId)` foreign keys to `protected_profiles`, `child_safety_incidents`, and
`safety_signals` make **cross-tenant linking impossible** — the DB rejects a link/escalation whose tenant
doesn't match its parent. Every read is additionally scoped by explicit `tenantId`.

## Side-effect ordering & persisted review / incident / escalation (CS-C15B)

Steps run in a fixed order, each skipping already-`done` state: **[1]** durable state (create/resume)
→ **[2]** review → **[3]** incident correlate/create/link → **[4]** urgent escalation → **[5]**
authorized guardian delivery → **[6]** complete. Short per-step writes, no fragile long transaction.

- **Review** — the `SafetySignal` **is** the review item (canonical `reviewStatus` workflow); the
  durable state records `reviewRef = signalId`. Exactly one review per signal; minimized metadata only.
- **Incident** — the orchestrator calls the **real** incident service (`correlateAndLinkSignal`), which
  creates/updates a canonical `child_safety_incidents` row and a real `child_safety_incident_signals`
  link (see *Canonical incident & escalation domain* above). The ledger stores only the resulting
  `incidentRef` (an opaque id of the real record) — it is **not** the incident. *The cyberbullying
  `Incident`/escalation services are intentionally not reused — they are bound to cyberbullying's
  `ProtectedSubject`/`SecurityDetection`, a CS-C0 domain boundary; child-safety has its own canonical
  incident/escalation domain instead of bridging.*
- **Urgent escalation** — the orchestrator calls the **real** escalation service
  (`createOrReuseEscalation`), which creates a canonical `child_safety_escalations` row exactly once per
  `(incident, type)` and fires one internal notification via the existing `createNotification` path. The
  ledger stores only the resulting `escalationRef`. Internal only — **no** police, school,
  emergency-service, or third-party reporting. Note a second urgent signal in an already-escalated group
  still runs the escalation step so its ledger **reuses** the existing escalation reference (policy fires
  the escalation once; the DB `(incident, type)` uniqueness guarantees exactly one record).

## Exactly-once side effects

- The CS-C6 per-signal reservation + the durable record's `completedAt` make the flow run once per
  accepted signal (a replayed nonce ⇒ 409; a duplicate idempotency key ⇒ resumes an incomplete flow or
  returns the stored outcome — **never** re-running completed side effects).
- One review item per signal; one signal-to-incident link; one escalation per correlated incident; one
  guardian delivery per `(signal, recipient)` (checked via the delivery service + the durable state).
- Backed by **database uniqueness** — `child_safety_incident_signals.safetySignalId` unique (one incident
  per signal), `child_safety_escalations (incidentId, escalationType)` unique (one escalation per type),
  the notification dedupe key (one notification per escalation) — plus a per-group advisory lock and
  service-level idempotency. Never process memory.

## Partial-failure recovery (CS-C15B)

The executor is resumable. On each run it loads the durable state, **skips completed steps**, and
continues from the first incomplete one — so `review→incident✗`, `incident→escalation✗`,
`escalation→delivery✗`, `delivery→completion✗`, or a crash between steps all converge to one final
result on retry, **without** re-reviewing, re-linking, re-escalating, or re-delivering. Each failure
records a bounded class and increments a bounded attempt counter.

**Recovery is canonical-record-aware (CS-C15C).** The ledger's `done` status is trusted only when the
**real** record actually exists: the incident step re-verifies via `findIncidentForSignal` that the
signal is really linked to `incidentRef`, and the escalation step re-verifies via
`getChildSafetyEscalation` that `escalationRef` really exists. If the ledger says `done` but the
canonical record is missing or mismatched, the step **re-runs the idempotent service** (which reuses the
existing record or repairs the reference — the unique link/escalation constraints prevent a duplicate)
and audits a `ledger_repaired` event. Conversely, a ledger *write* failure after a successful canonical
side effect never recreates the record on retry — the service finds the existing one and converges.
Completion is **never** inferred from the ledger alone.

- **Retryable** failures set a `nextRetryAt` and leave the flow `processing` (resumable).
- **Terminal** failures (or exceeding the attempt cap) stop retrying — already-done side effects are
  preserved; the flow is marked complete with a terminal failure class. No infinite loops.

A delivery failure is recorded + audited; it does **not** invalidate a created incident and does
**not** spam the recipient (bounded retry through the existing delivery mechanism).

## Minimized delivery

A delivery may carry only: risk category, coarse severity/urgency, occurrence time, a recipient-safe
protected-profile reference, safe action guidance, and an authorized Tamanor case reference. It carries
**no** raw text, transcript, full classifier explanation, hidden identity, unrelated history, evidence
content, raw score, or internal detail.

## Privacy boundaries

A `SafetySignal` is content-free by construction, so raw content never enters the orchestrator,
delivery, review item, incident, or audit. **No evidence is uploaded or attached automatically**
(evidence remains a separate, explicitly-authorized operation). Cross-tenant access is impossible
(every read/write is RLS-scoped to the signal's tenant). Public receipts and errors never expose
consent, guardian, recipient, incident, DB/Prisma, stack, token, or policy internals.

## Gateway receipt & recovery

The receipt exposes only `{ accepted, receiptId, signalId, duplicate, outcome, processingState,
receivedAt, schemaVersion }` — never review/incident/escalation ids, guardian/consent/recipient
details, or internal failure detail. A completed intervention returns `processingState: "completed"`
(HTTP 201/200); a retryable partial failure returns `processingState: "processing"` (HTTP 202) and is
**not** claimed as a final success. A duplicate idempotent request **resumes** an incomplete
intervention (skipping done steps) or returns the stored completed outcome.

## Retryable vs terminal failures

Transient failures (DB/service errors) are **retryable** — the flow stays `processing` with a
`nextRetryAt`. Permanent failures, or exceeding the bounded attempt cap, are **terminal** — retrying
stops, already-completed side effects are preserved, and the record is closed with a terminal class.

## Known limitations

- The bundled detector is deterministic/coarse (illustrative), not real-world-complete.
- Child-safety incident/escalation are **real canonical domain records** (`child_safety_incidents`,
  `child_safety_incident_signals`, `child_safety_escalations`) — separate from the cyberbullying
  `Incident`/escalation services by a deliberate CS-C0 domain boundary. The domain is intentionally
  narrow (correlation + linking + internal escalation + one internal notification); it is **not** a
  generic case-management or workflow platform. A future cross-domain case model could unify them if
  product direction requires it.
- Escalation is **internal only** — Tamanor never reports to police, schools, emergency services, or any
  external authority. Incident status transitions beyond `open`/`escalated` (review assignment,
  resolution, closure) are modeled but not yet driven by a review UI this sprint.
- Recovery is driven by explicit gateway retry / a callable re-invocation of the executor; no
  background worker is introduced this sprint.
- Tamanor reduces risk and speeds intervention but **cannot guarantee 100% protection**.
