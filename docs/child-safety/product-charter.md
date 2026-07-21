# Tamanor Child Safety Product Charter

> **Status: Accepted (CS-C0).** This charter is authoritative. Later sprints must not
> contradict it without a formal Architectural Decision Record (ADR) revision.

## Mission

The **Tamanor Child Safety Engine** identifies risky behavioural patterns in
communication and produces **privacy-safe safety signals** that authorized humans
review. It exists to help protect children from online harm while treating every
person's privacy as a first-class constraint.

Detection happens **on the platform side** (the preferred integration architecture,
ADR-CS-0010). Only a strict-allowlist safety signal — never raw content — ever
reaches Tamanor.

## What the product is NOT

The Tamanor Child Safety Engine is **not**:

- parental spyware;
- a message-reading application;
- a keylogger;
- a covert surveillance tool;
- a location tracker;
- an advertising / behavioural-profiling system;
- an automatic legal decision system;
- a system that labels people as "predators".

We do not build, market, or describe the product using the words *spy*, *monitor all
messages*, *read child messages*, *predator detector*, *surveillance*, or *parental
inbox* (terminology lock, §22 of the sprint brief).

## Detection scope (future)

The engine's roadmap targets these risk categories (see `child-safety-signal.ts`
`RiskType`): **grooming, sexual solicitation, sextortion, off-platform migration,
meeting attempts, cyberbullying and threats, encouragement of self-harm, identity
manipulation.** None of these ship in CS-C0 — only the vocabulary is locked.

## Prohibited processing

The **Tamanor Child Safety Cloud must never receive**:

- ordinary message text;
- complete conversations;
- photographs;
- videos;
- voice recordings;
- participant names;
- open platform identifiers;
- login credentials;
- precise location;
- contact lists;
- advertising identity.

These are enforced as a strict allowlist by the future Privacy Gateway; the contract
and the pure validator already reject them in CS-C0 (`validateSafetySignalEnvelope`).

## Permitted safety-event data

A safety event may carry **only**: risk type, severity, urgency, a confidence band or
calibrated confidence, signal codes, a **pseudonymized** conversation reference, a
**pseudonymized** actor reference, event time, source platform, taxonomy version,
model/rules version, contract version, event provenance, and anti-replay metadata.
(See `SafetySignalEnvelope`.)

## Language policy

The system **must** speak in behavioural, non-accusatory terms:

> "The conversation shows high-risk grooming indicators."

The system **must never** speak in verdicts:

> ~~"This person is a sexual predator."~~

## Human responsibility

- A safety signal is **not** a legal decision.
- Critical decisions require a **defined human-review or escalation workflow**.
- Tamanor must never automatically determine the guilt of a specific person.
- Guardian notification is **not** automatic for every incident; recipient safety is
  evaluated first (see `safe-recipient` model and ADR-CS-0006).
