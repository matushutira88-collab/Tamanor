# Child Safety — Integration Signal Protocol V1

A secure, versioned, server-to-server protocol that lets an **authorized** partner platform (social,
messaging, gaming, education, communication) send Tamanor a **minimal, content-free structured safety
signal**. Classification happens **inside the partner platform**; raw communication content **never leaves
it**. Tamanor authenticates, verifies, validates, deduplicates, maps, and processes the signal.

> **Privacy guarantees (by construction):** raw communications remain inside the partner platform — Tamanor
> receives **structured safety signals only** and never message content. Tamanor never requests platform
> credentials, passwords, tokens, or session cookies; never reads device notifications, accessibility data,
> screens, or private messages; and **never bypasses Meta or any other platform**. A signal describes a
> **detected risk pattern, not proven guilt** — no person is labelled an offender/criminal/abuser/predator.
> No authority or guardian is contacted automatically; **partner authorization is mandatory**. This is not
> a surveillance protocol.

## Architecture

```
Partner platform (classifies IN-HOUSE; raw content stays)  ──HTTPS + Ed25519 signature──▶  Tamanor gateway
  builds a MINIMAL signal → SDK signs → POST /signals                                        authenticate →
                                                                                              verify signature →
                                                                                              timestamp window →
                                                                                              replay/idempotency →
                                                                                              strict validate →
                                                                                              capability →
                                                                                              map → canonical signal
                                                                                              (subject-linked) →
                                                                                              advisory SIGNAL_TRIAGE
                                                                                              policy → append-only
                                                                                              content-free receipt
```

## Protocol version

`protocol = "tamanor-child-safety-signal"`, `protocolVersion = "1.0"`. Unknown/unsupported versions and any
version outside the application's declared `[protocolMinVersion, protocolMaxVersion]` are rejected
(`PROTOCOL_UNSUPPORTED`). Maximum request size **32 KB**; no attachments/binary.

## Request envelope

A single JSON object; **unknown top-level or nested fields are rejected**:
```
protocol, protocolVersion, eventId, idempotencyKey, partnerId, applicationId, installationId,
occurredAt, sentAt, nonce, signal{…}, classification{…}, subject{…}, context{…}?
```
All ids are opaque `[A-Za-z0-9._:-]`, ≤128; timestamps are ISO-8601.

## Signal schema (content-free)

- **signal:** `externalSignalId, signalType (partner risk taxonomy), confidenceBand (low|medium|high),
  severityHint?, urgencyHint?, riskFamily?`.
- **classification:** `classifierType (ml_model|rule_engine|human_review|hybrid), classifierVersion,
  modelVersion?, ruleVersion?, classificationMethod (automated|assisted|manual), evaluatedAt`.
- **subject:** `pseudonymousSubjectId (opaque, partner-scoped), pseudonymousActorId?, ageBand?` (only when
  already lawfully known + canonicalized).
- **context (optional):** `conversationContextId? (opaque), repeatedSignalCount, recentRelatedSignalCount,
  distinctActorCount, offPlatformMigrationFlag, meetingAttemptFlag, immediateDangerFlag, coercionFlag,
  threatFlag, partnerAlreadyBlockedContact, partnerAlreadyRestrictedAccount, partnerWarningDisplayed,
  partnerHumanReviewRequested`.

**Prohibited anywhere (deep-scanned + rejected):** message/text/body/content/transcript/media/url/location/
email/phone/name/username/dob/guardian data/password/token/apikey/cookie/deviceId/ip. If any prohibited key
appears at any depth, the request is `PAYLOAD_INVALID`.

## Risk taxonomy → canonical mapping

Partner taxonomy: `GROOMING, SEXUAL_SOLICITATION, SEXTORTION, OFF_PLATFORM_MIGRATION, MEETING_ATTEMPT,
CYBERBULLYING, THREAT, HARASSMENT, COERCION, IMPERSONATION, SELF_HARM_CONCERN, OTHER_REVIEW_REQUIRED`.
Allow-listed mapping to canonical `SafetySignal.signalType`: grooming/off-platform → `GROOMING`;
sexual_solicitation → `SEXUAL_SOLICITATION`; sextortion → `SEXTORTION`; meeting_attempt → `MEETING_ATTEMPT`;
cyberbullying/harassment → `CYBERBULLYING`; threat/coercion → `THREAT`; impersonation →
`IDENTITY_MANIPULATION`. `SELF_HARM_CONCERN` and `OTHER_REVIEW_REQUIRED` have **no** canonical type → the
receipt is accepted for manual review with **no** canonical signal created. No partner payload is spread
into canonical models; only allow-listed, canonical enums are used.

## Authentication + signing

Per-installation **Ed25519** signatures. Each installation has versioned **public** keys — Tamanor stores
**only public keys**; the partner's private key never leaves the partner and is never uploaded to Tamanor.
Headers: `x-cs-installation`, `x-cs-key-version`, `x-cs-signature` (base64). The signature is Ed25519 over
this **exact canonical signing string** (newline-joined, order-fixed):
```
TAMANOR-CS-SIGNAL-V1
<HTTP METHOD, uppercase>
<request path>
<protocolVersion>
<applicationId>
<installationId>
<eventId>
<idempotencyKey>
<sentAt>
<nonce>
<sha256(rawBody) hex>
```
It binds method, path, protocol, app, installation, event, idempotency key, timestamp, nonce, and the body
hash — nothing can be swapped without invalidating the signature. Verification is cryptographic
(constant-time); ambiguous values are never silently normalized; only Ed25519 is accepted (no algorithm
negotiation, no downgrade).

## Replay protection + idempotency

- `sentAt` must be within a ±5-minute clock-skew window → else `TIMESTAMP_OUT_OF_WINDOW`.
- **Idempotency:** `(installation, idempotencyKey)` is unique. Same key + same request fingerprint → the
  original result is returned (`SIGNAL_DUPLICATE`) with **no** duplicate canonical signal / policy
  evaluation / incident. Same key + different fingerprint → `IDEMPOTENCY_CONFLICT` (+ security audit).
- **Nonce:** `(installation, nonceHash)` is unique. A fresh idempotency key reusing a spent nonce →
  `NONCE_REPLAYED`. **An identical signed retry reuses the same nonce**; because the idempotency check runs
  first, the retry returns the original result rather than tripping replay. The unique index is the
  concurrency backstop (two concurrent first-time deliveries → exactly one canonical signal).
- Replay/idempotency records are retained for a bounded 30-day window.

## Credential + key lifecycle

Key statuses: `active | rotating | revoked | suspended`. Rotation is overlap-safe: register a new key,
both remain valid for a bounded window, activate the new key, revoke the old. Requests signed by a
revoked/expired key fail closed (`KEY_REVOKED`). Public-key management is Owner/Admin only.

## Gateway processing order (fail-closed at every step)

1 size → 2 auth headers → 3 resolve installation (→ tenant) → 4 status (installation/app/partner) →
5 protocol version → 6 timestamp → 7 rate limit → 8 body hash + key resolution → 9 signature verify →
10 idempotency + nonce → 11 strict payload validation → 12 capability → 13 map → 14 advisory SIGNAL_TRIAGE
policy → 15 persist canonical signal (subject-linked) + receipt atomically → 16 bounded acknowledgement.
Errors never leak tenant identity, key material, or fingerprints.

## Policy Engine integration

After mapping, the gateway evaluates the tenant's active `SIGNAL_TRIAGE` policy via the existing **advisory**
adapter and stores a bounded decision reference on the receipt. The partner cannot choose the policy
version. Evaluation is fail-closed; a policy failure never enables automatic intervention — the canonical
signal (if any) simply enters manual review. Guardian authority and reviewer approval remain authoritative
elsewhere; policy cannot bypass them.

## Rate limiting

DB-backed per-installation sliding window (V1, no Redis). Exceeding the bound → `429 RATE_LIMITED` with a
bounded `Retry-After`. Exact thresholds are not revealed to callers.

## Error contract (stable)

`INTEGRATION_AUTH_REQUIRED, INTEGRATION_UNKNOWN, INTEGRATION_SUSPENDED, KEY_REVOKED, SIGNATURE_INVALID,
TIMESTAMP_OUT_OF_WINDOW, NONCE_REPLAYED, IDEMPOTENCY_CONFLICT, PROTOCOL_UNSUPPORTED, PAYLOAD_INVALID,
PAYLOAD_TOO_LARGE, CAPABILITY_DENIED, RATE_LIMITED, SIGNAL_ACCEPTED, SIGNAL_DUPLICATE, INTERNAL_FAIL_CLOSED`.
Never exposes ORM/SQL errors, stack traces, key fingerprints, tenant identity, or existence details.

## Retries

Retry only bounded transient outcomes (network/timeout, selected 5xx, `429` respecting `Retry-After`,
`INTERNAL_FAIL_CLOSED`). Never retry `SIGNATURE_INVALID`, `KEY_REVOKED`, `PROTOCOL_UNSUPPORTED`,
`PAYLOAD_INVALID`, `IDEMPOTENCY_CONFLICT`, or capability denials. A retry re-sends the **byte-identical**
signed request (same eventId, idempotencyKey, nonce, body, signature), so one logical event yields at most
one canonical signal.

## Version compatibility

`SUPPORTED_PROTOCOL_VERSIONS = ["1.0"]`. New fields require a new protocol version (unknown fields are
rejected — there is no silent forward-compat spread). Each receipt stores the protocol version + partner
classifier version as bounded metadata.

## Security notes

No shared long-term secret is the primary credential (per-installation asymmetric keys). No `eval`/dynamic
code. Cross-tenant access is impossible (SYSTEM tables, explicit scoping, composite `(id, tenantId)` FKs,
`REVOKE ALL … FROM tamanor_app`). No raw body, signature value, or private key is ever stored. See the
partner SDK and pilot-checklist docs for integration details.

## Known limitations (V1)

- Canonical signal creation requires an **authorized subject link** (opaque partner subject → Tamanor
  ProtectedProfile), established out-of-band by an authorized user; unlinked or review-required signals are
  accepted as content-free receipts without a canonical signal.
- One active policy per purpose (multiple → fail-closed ambiguous) applies to the advisory triage step.
- Anti-enumeration responses are best-effort (distinct auth/status codes exist per the error contract);
  uniform-response hardening is future work.
- Rate limiting is DB-backed and coarse; a production pilot should add network-layer limiting.
