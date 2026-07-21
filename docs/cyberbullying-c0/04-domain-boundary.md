# 04 — Cyberbullying Domain Boundary

Defines what the Cyberbullying Protection module **owns** and what it **must not
touch or overload**. This is the anti-coupling contract.

## Belongs to the module (its own tenant-scoped concerns)
- **Protected subject** — the person being protected (pupil / employee / client /
  represented person). Not automatically a Tamanor user account.
- **Protected-subject relationships** — guardian, trusted contact, school
  reviewer, company reviewer, case manager, with verified authority + scope.
- **Participant roles** — target, **alleged** source actor, witness, reporter,
  guardian, reviewer, trusted contact.
- **Evidence + context + custody** — immutable originals, redacted derivatives,
  chain-of-custody (isolated evidence layer; C2).
- **Incident review** — the review workflow over the shared `Incident` root
  (cyberbullying detail + lifecycle).
- **Victim protection** — protective actions (recommended/approved/executed).
- **Escalation** — guardian / school / company / platform-report packages.
- **Privacy, retention, redaction, export** for victim data.
- **Cyberbullying taxonomy** — its own harm categories + explainable multi-factor
  risk (separate from brand `RiskCategory`).

## Does NOT belong (must not become a source of truth for cyberbullying)
- **Brand** — brand identity is reputation-domain; a victim is not a brand.
- **ConnectedAccount** — brand-owned platform accounts; a victim's harmful
  content usually lives on accounts the tenant does not own.
- **ReputationItem** — brand comment/review workflow; reuse only as a *pattern*.
- **Brand `RiskCategory`** (spam/scam/brand_attack/…) — reputation vocabulary;
  cyberbullying needs its own taxonomy.
- **Auto-Protect / brand moderation rules / brand ProtectionScore** — brand
  automation; not victim protection.
- **Meta OAuth model / connector runtime** — brand connector concerns.
- **Billing / Stripe** — orthogonal.
- **Account Takeover detectors** — a different `SecurityDetection` domain.
- **Guardora production** — separate project; never referenced.
- **Secret monitoring / device tracking / private-message access without lawful
  authority** — prohibited outright.

## Content-source rule
- `ContentItem` may be used **only** for content Tamanor legitimately ingested via
  an existing, authorized platform integration (brand-owned accounts).
- **User-uploaded screenshots, private messages, school records, and
  victim-submitted evidence MUST NOT be stored as `ContentItem`.** They belong to
  the isolated evidence layer with its own capture/custody/retention semantics.

## One-line invariant
> Reuse Tamanor's **security/identity/RLS/audit substrate**; keep the
> **victim/evidence/authority domain** in its own isolated, tenant-scoped tables
> with its own taxonomy — never inside brand-reputation models.
