# Child Safety — Partner Pilot Checklist

A gate-by-gate checklist for an **authorized** pilot with a smaller communication platform. Every item must
be satisfied before any production signal flows. This is an internal readiness aid, not a certification.

## 1. Legal & authorization
- [ ] Written partner authorization + data-processing agreement in place.
- [ ] Lawful basis for each shared field (esp. `ageBand`) documented; DPIA completed.
- [ ] Confirmation that **raw communications stay on the partner platform** and Tamanor receives structured
      signals only.

## 2. Data-flow & threat model
- [ ] Data-flow diagram reviewed: classification is in-partner; only the minimal envelope crosses the boundary.
- [ ] Threat model reviewed (replay, downgrade, key confusion, IDOR, enumeration, rate-limit bypass, SSRF).
- [ ] Confirmation of **no** message content, credentials, tokens, device identifiers, or private keys shared.

## 3. Key exchange
- [ ] Partner generates + holds its own Ed25519 private key; only the **public** key (SPKI) is registered.
- [ ] Key rotation + revocation procedure agreed; overlap window understood.

## 4. Sandbox validation
- [ ] Partner registered in the LOCAL sandbox; synthetic signals validated + delivered end to end.
- [ ] Signature verification, replay rejection, idempotency, and timestamp-window behavior confirmed.
- [ ] Error-code handling (accept/duplicate/retryable vs terminal) implemented in the partner backend.

## 5. Synthetic test suite
- [ ] Full synthetic suite passes: valid accept, idempotent retry, replay, expired timestamp, bad signature,
      revoked key, oversized/invalid payload, capability denial, concurrency (one signal).

## 6. Classification quality & human review
- [ ] Partner classification-quality evidence (precision/recall by risk type) reviewed.
- [ ] Human-review process defined on both sides; signals describe **risk, not guilt**.
- [ ] Subject-linking process (opaque subject → protected profile) authorized and documented.

## 7. Operations
- [ ] Incident-response contacts + escalation path agreed on both sides.
- [ ] Retention/deletion policy for receipts + linked subjects confirmed (bounded replay window).
- [ ] Monitoring/alerting for invalid-signature / replay / rate-limit spikes.

## 8. Launch & rollback
- [ ] Launch in **shadow mode** (receipts + advisory policy only; no automatic action) first.
- [ ] Rollback plan: suspend installation / revoke key (both fail closed immediately).
- [ ] Production-readiness sign-off by Owner/Admin + safety lead.

## Non-negotiables (stop the pilot if any fails)
- Raw child communication content becomes required.
- Platform credentials, device surveillance, screen/notification reading, or Meta/platform bypass required.
- Private keys would be stored by Tamanor, or unsigned requests would be accepted.
- Replay/duplicate prevention, tenant isolation, or fail-closed behavior cannot be enforced.
- Any automatic authority/guardian contact or automatic intervention execution.
