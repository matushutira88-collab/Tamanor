# Child Safety — Policy Engine V1

A centralized, **deterministic, versioned, tenant-scoped, auditable, fail-closed** decision engine for the
Child Safety domain. It evaluates bounded canonical facts and returns bounded policy **decisions**
(recommendations + authorization bounds). It centralizes decisions that were previously scattered: whether
a signal should create/update an incident, recommended severity/urgency, whether escalation is required and
at what level, whether reviewer/supervisor confirmation is required, whether a protection plan/actions may
be proposed, whether an intervention may run automatically or is manual-only, and whether guardian contact
may even be *considered*.

> **The engine is deliberately small and safe.** It does **not** read raw communications, execute arbitrary
> code, or reach any external system. Policy is **data** (a strict JSON structure over an allow-listed
> vocabulary), never executable logic. Policy output is **not** a legal, medical, police, welfare, or
> professional conclusion, and it **cannot** bypass guardian authorization or any existing domain
> invariant. Serious actions still require authorized human review where configured. There is **no**
> automatic authority contact.

## Architecture

Read-time, side-effect-free evaluation over the accepted canonical domain — **no duplicate analytical
truth**, no rollup, no rules stored as code.

```
@guardora/core  child-safety-policy.ts   (PURE — no I/O, clock, crypto, or eval)
  • enums (purpose/status/operator/effect/fields)   • strict validator (dependency-free, zod-equivalent)
  • deterministic evaluate() + conflict merge        • canonical input STRING (hash done server-side)
                          │
@guardora/db  child-safety-policy.ts   (SYSTEM-scoped systemDb; explicit tenantId)
  • lifecycle (create/edit/submit/approve/reject/activate)  • two-person control  • atomic one-active
  • fail-closed resolveActive + evaluate + APPEND-ONLY decision audit (sha256 fingerprint)  • simulate
  • narrow integration adapters (signal/incident/escalation/plan/intervention/guardian)
                          │
apps/web  server/child-safety/policy.ts → API routes → /dashboard/child-safety/policies (UI, EN/SK/DE)
```

## Domain model

`ChildSafetyPolicy` (one per `policyKey`/purpose) → many `ChildSafetyPolicyVersion` (immutable after
activation) → `ChildSafetyPolicyActivationApproval` (append-only two-person ledger) and
`ChildSafetyPolicyDecisionRecord` (append-only, content-free decision audit). Core value types:
`ChildSafetyPolicyDefinition`, `PolicyRule`, `PolicyConditionNode`, `PolicyEffect`,
`ChildSafetyPolicyEvaluationInput`/`Result`, `ChildSafetyPolicyEngineDecision`,
`ChildSafetyPolicyValidationResult`.

## Policy lifecycle & version immutability

`DRAFT → PENDING_APPROVAL → ACTIVE → RETIRED`, plus `REJECTED`. A **draft** may be edited; **every other
status is immutable** (no edit/submit path). Submitting freezes the definition; approval is recorded in the
ledger; activation atomically retires the current active version and promotes the approved one. Rollback =
create a new version (optionally copied from an approved prior one) and take it through the same approval +
activation flow — historical versions are never mutated. **Only one ACTIVE version per policy**, enforced
by a DB **partial unique index** *and* the service transaction.

## Policy schema (data, not code)

`{ schemaVersion, purpose, defaultEffect, rules[] }`. Each rule: `{ id (stable, unique), priority, enabled,
condition, effects[], explanationCode }`. Conditions are a bounded tree of **groups** (`ALL`/`ANY`) and
**leaves** (`{ field, operator, value }`). Validated by a strict, dependency-free validator that rejects
unknown fields/operators/effects/payload keys, malformed enum values, duplicate rule ids, and anything over
the bounds (≤100 rules, ≤20 condition nodes/rule, nesting depth ≤5, ≤20 effects/rule, ≤64 KB definition).

**Supported fields** (strict allow-list, per purpose — no arbitrary object paths, no dynamic field names):
- *Signal triage:* `signalType, riskFamily, confidenceBand, sourceType, repeatedSignalCount,
  distinctSourceCount, signalAgeSeconds, immediateDangerFlag, ageBand`.
- *Incident / classification / escalation / plan / intervention / guardian:* `severity, urgency,
  incidentStatus, riskFamily, signalCount, previousEscalationCount, hasActiveEscalation,
  hasActiveProtectionPlan, reviewerAssigned, guardianAuthorityState, evidenceCount, ageBand,
  immediateDangerFlag`.

**Supported operators:** `EQUALS, NOT_EQUALS, IN, NOT_IN, GREATER_THAN, GREATER_THAN_OR_EQUAL, LESS_THAN,
LESS_THAN_OR_EQUAL, EXISTS, NOT_EXISTS`, plus `ALL`/`ANY` groups.

## Effect catalog

`CREATE_INCIDENT, UPDATE_INCIDENT, SET_RECOMMENDED_SEVERITY, SET_RECOMMENDED_URGENCY, REQUIRE_REVIEW,
REQUIRE_SUPERVISOR_REVIEW, CREATE_ESCALATION_RECOMMENDATION, SET_ESCALATION_LEVEL, PROPOSE_PROTECTION_PLAN,
PROPOSE_PROTECTION_ACTION, ALLOW_AUTOMATIC_INTERVENTION, REQUIRE_MANUAL_INTERVENTION_APPROVAL,
ALLOW_GUARDIAN_CONTACT_CONSIDERATION, PROHIBIT_GUARDIAN_CONTACT, MANUAL_ONLY, NO_ACTION`. Effects are
**recommendations or authorization bounds** — they never perform a side effect. Payload-bearing effects
have strict per-effect schemas (severity/urgency/escalation-level enums; protection-action type +
reasonCode + requiresApproval; automatic-intervention type + max severity/urgency + bounded prerequisites).

## Conflict precedence (deterministic)

1. Rules run in ascending `priority`, tie-broken by ascending `id` (**never** DB/array order).
2. Effects merge with: **deny over allow** (`PROHIBIT_GUARDIAN_CONTACT` beats `ALLOW_…`); **MANUAL_ONLY**
   and `REQUIRE_MANUAL_INTERVENTION_APPROVAL` **over** `ALLOW_AUTOMATIC_INTERVENTION`;
   `REQUIRE_SUPERVISOR_REVIEW` **over** `REQUIRE_REVIEW`; **highest** recommended severity / urgency /
   escalation-level wins; duplicate identical effects de-duplicate; duplicate proposed actions merge with
   `requiresApproval=true` (the safer value) winning. Overrides are applied **after** collection so effect
   order can never defeat a deny/manual rule. Every pair is covered by a test.

## Deterministic evaluation & fingerprinting

`evaluateChildSafetyPolicy(input, definition)` is pure: the same `(facts, definition, engineVersion,
evaluatedAt)` always yields byte-identical output. The engine emits `canonicalPolicyInput` — a
stable-key-ordered JSON of only the allow-listed fields (no raw content, no volatile fields) — and the
**server-only** DB layer computes the sha256 **fingerprint** of it (Node crypto never enters the client
bundle). Only the fingerprint (never the raw facts) is stored.

## Decision audit

Every *applied* production evaluation appends a `ChildSafetyPolicyDecisionRecord`: tenant, policy, version,
purpose, bounded context type/id, input fingerprint, bounded decision + explanation codes, engine version,
evaluation time, correlation id. Records are **append-only** (no update/delete). Lifecycle + evaluation
events also write the shared audit log (`policy.created/version_created/submitted/approved/rejected/
activated/retired/simulated/decision_evaluated/evaluation_failed`). **No** raw message/evidence/note/
guardian content or full input object is ever stored.

## Activation approval & two-person control

Approval is recorded by an **independent** member: the approver/rejecter must differ from the creator (and
submitter). Activation requires an `approved` ledger row by a non-creator, then atomically retires the
current active version and promotes the approved one in one transaction; the partial unique index backs the
concurrency guarantee. A Safety Reviewer may **view + simulate** but not manage/submit/approve/activate.

## Simulation

`simulateChildSafetyPolicyVersion` runs the engine over synthetic canonical fact cases (≤100/request) for a
draft **or** active version. It is strictly **side-effect free**: it creates no incident/escalation/plan,
executes no intervention, sends no notification, contacts no guardian, and writes **no** production decision
record (only a `policy.simulated` audit marker). Results expose matched/unmatched rules, merged effects, and
explanation codes.

## Integration points (narrow, advisory)

Five adapters — `evaluateSignalTriagePolicy`, `evaluateIncidentClassificationPolicy`,
`evaluateEscalationPolicy`, `evaluateProtectionPlanPolicy`, `evaluateInterventionAuthorizationPolicy`,
`evaluateGuardianContactEligibilityPolicy` — resolve the tenant's active policy for the purpose, evaluate,
persist a decision, and return a bounded decision. **Existing domain services remain authoritative**: the
engine advises; it never creates/escalates/executes/contacts. Guardian authority and recipient
authorization checks remain mandatory regardless of any policy output.

## Fail-closed behavior

If there is no active policy, an ambiguous active set, an invalid/hash-mismatched/unsupported active
definition, invalid input, or an evaluation error, the engine returns the **safe** decision — require
manual review, allow nothing automatic, prohibit guardian contact — with `ok:false` and a bounded error
code, and writes a bounded audit event. It **never** silently falls back to permissive behavior.

## Permissions

`child_safety:policy_view` (Owner/Admin/Safety-Reviewer), `policy_manage / policy_submit / policy_approve /
policy_activate` (Owner/Admin), `policy_simulate` + `policy_decision_view` (Owner/Admin/Safety-Reviewer).
Analyst/Viewer: **deny**. Server-authoritative; tenant resolved before any read; no cross-tenant visibility;
no public/guardian/SDK/gateway path.

## API

`GET/POST /api/v1/child-safety/policies`, `GET /policies/:id`, `POST /policies/:id/versions`,
`PATCH /policies/:id/versions/:vid`, `POST /policies/:id/versions/:vid/action` (`validate | simulate |
submit | approve | reject | activate`), `GET /policy-decisions`. Session + same-origin (mutations) + strict
parsing + bounded body + safe error codes; no raw ORM/DB errors; deterministic pagination.

## UI

`/dashboard/child-safety/policies` — list, detail (version history with immutable badges), a **data-only**
JSON draft editor (validate/simulate; no scripting), submit/approve/reject/activate with an accessible
confirmation dialog and a visible two-person notice, and a content-free decision history. Existing design
system; responsive; dark mode; keyboard accessible; EN/SK/DE; no unsafe HTML; no executable content.

## Migration

One forward-only, hand-authored migration `20260821090000_cs_policy_engine` creates the four SYSTEM tables
with composite `(id, tenantId)` FKs, unique `policyKey`/tenant, unique versionNumber/policy, the partial
unique **one-active-per-policy** index, tenant-aware indexes, and `REVOKE ALL … FROM tamanor_app`. No
accepted migration is edited; applied with `prisma migrate deploy` against localhost; no production seed.

## Testing

`child-safety-policy:test` (pure domain, 40 checks — validation, determinism, all operators/groups, every
conflict pair, fail-closed), `child-safety-policy-integration:test` (service, 37 checks — permissions,
tenant isolation, two-person, immutability, atomic + concurrent one-active activation, append-only,
historical version binding, fail-closed, adapters, side-effect-free simulation),
`child-safety-policy-ui:test` (pure, 35 checks — view-model, EN/SK/DE parity, gating, accessible dialog,
no eval/unsafe-HTML/window.confirm, safe API/server).

## Security considerations

Policy is data validated against a strict allow-list — no `eval`/`Function`/template execution, no dynamic
field paths, no prototype-pollution surface (unknown keys rejected). Oversized/deeply-nested definitions
fail validation. Server crypto is never bundled to the client. Cross-tenant access is impossible (explicit
tenant scoping + composite FKs + SYSTEM-table REVOKE). Self-approval and activation without independent
approval are rejected; concurrent activation cannot produce two active versions.

## Known limitations

- V1 integrates the engine as an **advisory** layer via adapters; existing hardcoded domain decisions are
  preserved and not yet replaced wholesale (deliberately avoiding a big-bang rewrite). Wiring a purpose's
  live path to the engine is future work behind a compatibility default policy.
- One active policy per purpose; more than one active policy for a purpose is treated as ambiguous and
  fails closed (there is no policy-set composition in V1).
- Simulation uses synthetic/manual fact snapshots; there is no fact-snapshot capture from live incidents.
- No policy import/export marketplace, no cross-tenant sharing, no inheritance — out of scope by design.
