# Child Safety — Partner Pilot Runbook V1

Operational procedures for the [Partner Pilot & Integration Operations](./partner-pilot-operations.md)
lifecycle. All steps are **content-free** and **local-only** in this environment. Never enter raw
communications; never upload a private key; never paste production credentials, internal endpoints, secrets,
or exact defensive thresholds.

## 1. Onboard a partner application → pilot

1. In the Integration console, register the **partner**, **application** (choose `sandbox` or `production`),
   and **installation(s)**; register each installation's **public** key (public key only — Tamanor never
   receives a private key).
2. Open **Partner Pilots** and create a **draft pilot** for the application.
3. Fill the intended scope (requested capabilities, risk categories, regions, age bands, expected
   volume/rate bands). These are *requested* values; reviewers set the *approved* scope.

## 2. Review & assessments

1. **Submit** the draft, then **Begin review**.
2. Set the **privacy**, **security**, and **legal authorization** assessment statuses to `APPROVED` once each
   is satisfied. Legal/privacy/security must all be `APPROVED` for readiness.
3. Work the **readiness checklist**. Mark each check `PASSED` (or `WAIVED`, where allowed, with a bounded
   reason). The five **non-waivable** checks must be explicitly `PASSED`.
4. If rework is needed, **Request changes** (→ `CHANGES_REQUIRED`); the partner/operator revises and
   re-submits.

## 3. Sandbox activation & compatibility testing

1. **Approve sandbox** (→ `APPROVED_FOR_SANDBOX`), then **Activate sandbox** (→ `SANDBOX_ACTIVE`).
2. Run the required compatibility tests: signature compatibility, nonce replay, idempotency duplicate,
   idempotency conflict, payload validation. Each records a content-free result.
3. Set the **approved scope** (approved capabilities, categories, age bands, allowed installation IDs,
   monthly-volume band, peak-rate band, and the pilot start/review/end window).

## 4. Readiness verification & activation

1. **Start readiness review** (→ `READINESS_REVIEW`), then **Evaluate readiness**. Resolve every blocking
   reason (they are shown as stable codes).
2. When readiness is `READY`, **Mark ready** (→ `READY_FOR_PILOT`).
3. An **Owner/Admin** performs **Activate** (→ `PILOT_ACTIVE`). Activation re-checks all prerequisites
   server-side and is never automatic. This is a two-person control on top of the reviewer's sign-off.

## 5. During the pilot

- Production signals for the application are accepted only within the approved scope and window.
- **Pause/Resume** for reversible, planned halts.
- Monitor **operational alerts**. An open **CRITICAL** alert blocks re-evaluated readiness. Resolve alerts
  with a bounded reason (authorized + audited).

## 6. Emergency fail-closed suspension

If a security or privacy concern arises:

1. **Suspend** the pilot (Owner/Admin/Safety Reviewer). Production signal acceptance **stops immediately** —
   every subsequent production signal fails closed with the non-enumerating `INTEGRATION_SUSPENDED` result.
2. Investigate using the content-free alerts, receipts, and the append-only activity history.
3. To resume, move the pilot through **Start readiness review** and re-verify before re-activation.

## 7. Pilot expiry

- When the **end date** passes, production signals fail closed automatically (treated like a non-active
  pilot). Extend the window via the approved scope, or terminate.

## 8. Termination & offboarding checklist

Terminate (Owner/Admin) is **irreversible**. Before/at termination:

- [ ] Suspend first if any active concern remains.
- [ ] Record the **termination reason code**.
- [ ] Revoke or leave revoked all installation signing keys as appropriate (key lifecycle lives in the
      Integration console).
- [ ] Confirm no production traffic is expected; production signals now fail closed.
- [ ] Resolve or close any open operational alerts (audited).
- [ ] Deactivate operational contacts that are no longer needed.
- [ ] Retain the append-only pilot history for the audit record (content-free).

## Incident escalation contacts

Operational **business** contacts are recorded per partner with bounded roles: `TECHNICAL`, `SECURITY`,
`PRIVACY`, `INCIDENT_RESPONSE`, `LEGAL_AUTHORIZATION`. A `TECHNICAL` **and** an `INCIDENT_RESPONSE` contact are
required for readiness. These are business contacts only — **never** child or guardian contacts, and never
credentials or tokens.

## Guardrails (do / don't)

- **Do** keep everything content-free: bounded codes, bands, counters, timestamps.
- **Do** rely on the server state machine — never try to set a status directly.
- **Don't** enter raw messages, transcripts, media, credentials, or private keys anywhere.
- **Don't** treat pilot approval as legal compliance, or a risk signal as proven guilt.
- **Don't** expect any guardian/authority auto-contact or automated intervention — there is none in this
  layer.
