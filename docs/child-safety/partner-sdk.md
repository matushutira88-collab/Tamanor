# Child Safety — Tamanor Partner SDK V1

The **Tamanor** Child Safety Partner SDK — a **server-side only** TypeScript SDK that builds, validates,
signs, and submits a minimal, content-free Child Safety signal.

> **Package naming.** `@guardora/*` is this monorepo's established **internal** package namespace (it
> predates this feature and is used by every workspace package). The partner SDK ships inside the existing
> internal package **`@guardora/child-safety-sdk`**, exposed at the public subpath
> **`@guardora/child-safety-sdk/partner`** (also re-exported from the package root). The **product** is
> Tamanor and the protocol is Tamanor-branded (`tamanor-child-safety-signal`, `TAMANOR-CS-SIGNAL-V1`).
> *Internal-namespace compatibility limitation:* the npm scope remains `@guardora` to avoid a
> monorepo-wide rename of unrelated packages; a public Tamanor-scoped distribution name (e.g.
> `@tamanor/child-safety-partner-sdk`) would be assigned at publish time and is out of scope for this local
> feature. Import in-repo as `@guardora/child-safety-sdk/partner`.

> **This is not a surveillance SDK.** It has NO field or helper for raw message content, transcripts,
> attachments, screens, notifications, device data, credentials, tokens, or private-key upload. It never
> reads device notifications or screens, never receives user credentials, and never bypasses any platform.
> A signal describes potential risk, not proven guilt.

## Installation & server-only requirement

Import from `@guardora/child-safety-sdk`. The partner module uses Node crypto and **throws if loaded in a
browser** — do not bundle it client-side. Node ≥ 18.

## Payload builder (strict, content-free)

`createPartnerSignalClient({ endpoint, applicationId, installationId, keyVersion, partnerId, signer,
transport, protocolVersion?, retry? })` returns `{ submitSignal, buildEnvelope, signEnvelope }`. The
`PartnerSignalInput` type exposes only bounded fields (`externalSignalId, signalType, confidenceBand,
severityHint?, urgencyHint?, classification, subject, context?`). Any extra/raw field passed via a loose
cast is **stripped** — it can never reach the wire. `buildEnvelope` runs the strict validator and throws on
any invalid/out-of-taxonomy/prohibited field.

## Signing (private key stays with you)

`createEd25519Signer(privateKeyPemOrKeyObject)` builds an in-process signer, or pass any
`(data: Buffer) => Buffer | Promise<Buffer>`. The SDK computes `sha256(body)`, builds the canonical signing
string (see the protocol spec), signs it with Ed25519, and sends `x-cs-signature`, `x-cs-key-version`,
`x-cs-installation` headers. The private key is **never persisted, never logged, and never included in
errors**. Only the **public** key (SPKI base64) is registered with Tamanor.

## Retries

`submitSignal` retries only bounded transient outcomes (network/timeout, 5xx, `429`, `INTERNAL_FAIL_CLOSED`)
and never retries auth/protocol/payload/idempotency/capability failures (`isRetriable` is exported). A retry
re-sends the **byte-identical** signed request, so one logical event yields at most one canonical signal.

## Acknowledgement handling

`submitSignal` resolves to `{ ok, code, httpStatus, eventId?, receiptId?, canonicalSignalId? }`.
`SIGNAL_ACCEPTED` and `SIGNAL_DUPLICATE` are successes; everything else is a typed, bounded error code.

## Key rotation

Register a new public key (a new `keyVersion`), point the client at the new version, then have Tamanor
revoke the old key after the overlap window. Requests signed by a revoked key fail closed.

## Sandbox usage

Provide a custom `PartnerTransport` (or `createFetchTransport`) targeting a **local** gateway. For local
testing only, `generateEphemeralPartnerKeyPair()` returns an in-memory key pair (public SPKI + private PEM)
— the private key is never persisted to disk, the database, or the repository. In a real integration the
partner generates and holds its own private key.

The Tamanor-side local sandbox console (`/dashboard/child-safety/integrations`) can run the full signed loop
end to end: it generates an **ephemeral** Ed25519 key in-memory, registers only the public key, signs a
synthetic signal, submits it, and **revokes the ephemeral key immediately** afterwards. Sandbox send is
restricted to **`environment = "sandbox"`** applications, so it can never add a signing key to a
production installation. The private key exists only in memory for one request.

## Example (server-only)

```ts
import { createPartnerSignalClient, createEd25519Signer, createFetchTransport } from "@guardora/child-safety-sdk";

const client = createPartnerSignalClient({
  endpoint: "https://tamanor.example/api/v1/child-safety/integrations/signals",
  partnerId, applicationId, installationId, keyVersion: 3,
  signer: createEd25519Signer(process.env.PARTNER_PRIVATE_KEY_PEM!), // your private key, in-process only
  transport: createFetchTransport(),
});

const ack = await client.submitSignal({
  externalSignalId, signalType: "GROOMING", confidenceBand: "high", severityHint: "high",
  classification: { classifierType: "ml_model", classifierVersion: "4.1", classificationMethod: "automated", evaluatedAt: new Date().toISOString() },
  subject: { pseudonymousSubjectId, ageBand: "age_10_12" }, // opaque, partner-scoped — no PII
  context: { immediateDangerFlag: true, repeatedSignalCount: 3 },
});
if (!ack.ok) handle(ack.code); // typed, bounded error code
```

## Privacy restrictions (enforced)

No message/content/transcript/attachment field exists; raw content is stripped if forced; no credential or
token forwarding; no device/screen/notification access; the private key never leaves the caller. Signals
describe risk, not guilt; no authority/guardian is contacted automatically.
