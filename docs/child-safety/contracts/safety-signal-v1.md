# Safety Signal Contract — v1 (foundation)

> **Status: Accepted (CS-C0).** Types + a pure validator only. There is **no endpoint,
> no storage, no detector, no dataset** in CS-C0. Source of truth:
> `packages/core/src/child-safety-signal.ts`. `contractVersion = "safety-signal-v1"`.

## Envelope (`SafetySignalEnvelope`)

The **only** permitted fields:

| Field | Meaning |
|-------|---------|
| `contractVersion` | Contract identifier (`safety-signal-v1`). |
| `eventId` | Unique event id (idempotency + dedup). |
| `sourcePlatform` | Platform label (no account identity). |
| `sourceEnvironment` | e.g. `prod` / `sandbox`. |
| `protectedProfileReference` | **Pseudonymized** profile reference. |
| `conversationReferenceHash` | **Pseudonymized** conversation reference. |
| `actorReferenceHash` | **Pseudonymized** actor reference (never an open ID). |
| `riskType` | `RiskType` enum. |
| `severity` | `SafetySeverity`. |
| `urgency` | `SafetyUrgency`. |
| `confidence` | Calibrated `0..1` band. |
| `signalCodes[]` | `SafetySignalCode[]`. |
| `detectedAt` | ISO timestamp. |
| `taxonomyVersion` | Taxonomy version. |
| `detectorVersion` | Detector/rules version. |
| `nonce` | Anti-replay nonce. |
| `signature` | Integrity signature (verified at the gateway; no external signer). |

## Forbidden fields (hard rejection)

`message, text, body, content, transcript, image, video, audio, attachment,
filename, email, phone, username, displayName, platformUserId, accessToken,
refreshToken, latitude, longitude`.

Any of these ⇒ **rejected** (`forbidden_field`). Any field not in the allowlist ⇒
**rejected** (`unknown_field`) — never silently stored. Missing required allowlist
field ⇒ `missing_required`. Invalid `riskType` / `confidence` / `signalCodes` ⇒
`invalid_value`.

## Validation

`validateSafetySignalEnvelope(raw)` is pure and fail-closed: it returns error **codes
and field names only** — it never echoes values. The future **Privacy Gateway
(CS-C6)** will enforce this exact shape (plus signature + anti-replay) at the network
boundary before anything is accepted.

## Terminology (locked)

- **Signal** — one observed safety-relevant event (`AGE_PROBE`, `SECRECY_REQUEST`,
  `INTIMATE_IMAGE_REQUEST`, `OFF_PLATFORM_MOVE`, `MEETING_PROPOSAL`, `THREAT`,
  `SELF_HARM_ENCOURAGEMENT`, `PARENTAL_MONITORING_PROBE`).
- **Pattern** — a combination/sequence of signals (e.g. `AGE_PROBE → PARENTAL_MONITORING_PROBE
  → SECRECY_REQUEST → INTIMATE_IMAGE_REQUEST`).
- **Risk Type** — the resulting category (`GROOMING`, `SEXUAL_SOLICITATION`,
  `SEXTORTION`, `MEETING_ATTEMPT`, `CYBERBULLYING`, `THREAT`, `IDENTITY_MANIPULATION`).
- **Safety Incident** — an aggregated case built from one or more Safety Signals.
- **Cyberbullying Incident** — the *existing* human case-management incident. A
  Safety Incident is **not** automatically a Cyberbullying Incident (ADR-CS-0008).
