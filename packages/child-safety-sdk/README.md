# @guardora/child-safety-sdk

The Tamanor Child Safety SDK. It performs **local, privacy-preserving classification** of content and
sends only **minimized, signed safety signals** to the Tamanor Privacy Gateway — never the underlying
conversation.

> **Tamanor reduces risk. It cannot guarantee 100% protection.** No detector catches everything; this
> is a safety net, not surveillance and not a guarantee.

## Purpose

Let a platform or on-device integration turn risky interactions into accountable safety signals for a
child's authorized guardians — **without centralizing private conversations**.

## Non-goals

- Not parental surveillance; it does **not** read or upload private conversations.
- Not a predator detector or a legal verdict engine.
- Not an evidence pipeline. Evidence escalation is a **separate, explicit, authorized** operation and is
  never triggered by `evaluateContent`, `submitSafetySignal`, or retries.

## Privacy model

- Raw content is passed **only** to the injected classifier, in memory.
- After classification the SDK builds a **minimized** signal (risk type, coarse severity/urgency/
  confidence band, bounded signal codes, versions, pseudonymous references) — never the text.
- Raw content is never serialized, queued, logged, thrown in errors, put in diagnostics, or sent.
- The gateway independently enforces a strict **allowlist** — any raw-content or unknown field is
  rejected — so conversation data cannot reach Tamanor even by mistake.

## Local classification

You inject a `ChildSafetyClassifier` (deterministic local rules, a platform-native classifier, an
on-device model, or a third party). A bundled `DeterministicChildSafetyClassifier` exists **for tests
and local examples only** — it is a coarse keyword ruleset, not sufficient for real-world protection.

## Minimized signals

Each signal identifies: canonical risk type + signal codes, coarse severity / urgency / confidence
band, bounded reason codes, and the detector + taxonomy versions. Supported categories: grooming,
sexual solicitation, sextortion, off-platform migration, meeting attempts, cyberbullying, threats,
coercion, identity manipulation / impersonation, and scam-related exploitation.

## Installation authentication

A limited-scope **installation credential** (issued out-of-band by the operator) authenticates the SDK
at the gateway. Minimum scope `child-safety:signal:submit`. The credential has **no database or admin
access**, an expiry, and can be revoked/rotated. The token is stored **hashed** server-side (never
plaintext) and is never exposed by the SDK's diagnostics, serialization, or errors.

## Signing

Every envelope is signed with **HMAC-SHA-256** over a deterministic serialization (excluding the
signature field). The installation token is the HMAC key; the gateway verifies the signature with the
same token it receives in the `Authorization` header (constant-time). The algorithm + version are
encoded in the signature (`hmac-sha256:v1:…`); unsupported algorithms are rejected.

## Endpoint usage

`POST /api/v1/child-safety/signals`, `Content-Type: application/json`,
`Authorization: Bearer <installationToken>`, optional `Idempotency-Key`. The body is the canonical
signed `SafetySignalEnvelope`. The gateway returns a privacy-safe receipt:
`{ accepted, receiptId, signalId, duplicate, outcome, receivedAt, schemaVersion }`.

## Offline queue, retries, diagnostics

- Bounded in-memory queue of **signed envelopes only** (never raw content), with a deterministic
  overflow policy (drops oldest) and a `QueueStorageAdapter` seam for future secure native persistence.
- Explicit `flushPendingSignals()`; exponential backoff with bounded jitter; a maximum retry count;
  dead-letter callback; no infinite loops. `destroy()` cancels pending work and clears sensitive state.
- `getSdkDiagnostics()` exposes only: SDK version, signal schema version, detector/ruleset version,
  installation/transport state, queue length, last success time, last failure class, classifier
  availability — never a token, secret, key, raw content, evidence, server body, or stack trace.

## Evidence separation

The SDK has no evidence-upload method. Preserving evidence is a separate, explicitly-authorized
operation that reuses the existing authorized evidence APIs — never part of the signal flow.

## Threat model (summary)

Fails closed for authorization and privacy: an unauthenticated, unsigned, replayed, stale, or
raw-content-bearing payload is rejected; a guardian is never notified without valid guardian authority,
recipient authorization, a safe recipient, and valid consent; tenant boundaries are always enforced.

## Versioning & compatibility

Envelope contract `safety-signal-v1` (stable); taxonomy `child-safety-taxonomy-v2` (grows additively —
existing serialized values never change). Detector version is carried per signal.

## Example

```ts
import { createTamanorChildSafetyClient } from "@guardora/child-safety-sdk";

const client = createTamanorChildSafetyClient({
  endpoint: "https://example.invalid/api/v1/child-safety/signals",
  applicationId: "app_public_id",
  installationId: "installation_id",
  installationToken: token,       // issued out-of-band; never committed
  subjectId: pseudonymousChildId, // pseudonymous, not a real identity
  classifier,                     // your local/on-device/integrator classifier
});

const result = await client.evaluateContent({
  content: incomingMessage,       // stays local — passed ONLY to `classifier`, never sent to Tamanor
  locale: "sk",
});
if (result.signalCreated) {
  await client.flushPendingSignals();
}
```

`incomingMessage` is handed to your local/integrator-provided `classifier` and is **not sent to
Tamanor by default** — only the resulting minimized, signed signal is.
