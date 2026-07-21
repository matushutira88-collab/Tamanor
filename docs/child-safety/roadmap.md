# Tamanor Child Safety — Roadmap (CS-C0 → CS-C15)

> **Status: Accepted (CS-C0).** Ordering is locked. Each sprint states goal,
> dependencies, in-scope, explicit out-of-scope, security gate, acceptance gate.

| Sprint | Title |
|--------|-------|
| CS-C0 | Product Charter, Workspace Separation & Architecture Lock |
| CS-C1 | Domain, Taxonomy & Privacy-Safe Signal Foundation |
| CS-C2 | Synthetic Dataset Foundation |
| CS-C3 | Deterministic Signal Detector |
| CS-C4 | Conversation Sequence Engine |
| CS-C5 | Risk Aggregator |
| CS-C6 | Privacy Gateway |
| CS-C7 | Family Dashboard & Protected Profiles |
| CS-C8 | Safety Incident & Guardian Alert Workflow |
| CS-C9 | Evidence Consent Flow |
| CS-C10 | Expert Validation Portal |
| CS-C11 | Evaluation Harness & Model Metrics |
| CS-C12 | DPIA, Child Safety Impact Assessment & Abuse Prevention |
| CS-C13 | Organization Partner Pack |
| CS-C14 | Platform Integration Contract & SDK Foundation |
| CS-C15 | Pilot Readiness |

---

### CS-C0 — Product Charter, Workspace Separation & Architecture Lock (this sprint)
- **Goal:** Lock strategy, privacy, data + technical architecture for the track.
- **Dependencies:** Cyberbullying C0–C12.
- **In-scope:** WorkspaceKind, capability registry, server guards, nav separation,
  Safety Signal contract foundation, docs + ADRs, migration (existing → business), tests.
- **Out-of-scope:** ProtectedProfile/SafetySignal/SafetyIncident/GuardianAlert tables,
  taxonomy JSON, endpoint, generator, classifier, Family dashboard, Messenger.
- **Security gate:** Business/Family separation enforced server-side; all existing tenants business.
- **Acceptance gate:** C1–C12 regression green; workspace tests green; no new domain tables.

### CS-C1 — Domain, Taxonomy & Privacy-Safe Signal Foundation
- **Goal:** ProtectedProfile / GuardianRelationship / SafetySignal / SafetyIncident schema + taxonomy versioning.
- **Dependencies:** CS-C0. **Out-of-scope:** detector, dataset, endpoint, alerts.
- **Security gate:** append-only signals, RLS ENABLE+FORCE, allowlist enforced. **Acceptance:** schema + contract tests.

### CS-C2 — Synthetic Dataset Foundation
- **Goal:** privacy-safe synthetic scenario data (no real messages). **Out-of-scope:** real data, scraping, PII.
- **Security gate:** no real content; local only. **Acceptance:** dataset schema + generators are synthetic-only.

### CS-C3 — Deterministic Signal Detector
- **Goal:** rules-based (NOT AI) signal detection over synthetic data. **Out-of-scope:** LLM/ML, real data.
- **Security gate:** deterministic + versioned; no external calls. **Acceptance:** detector unit tests.

### CS-C4 — Conversation Sequence Engine
- **Goal:** pattern/sequence recognition from signals. **Out-of-scope:** content storage. **Security gate:** metadata only.

### CS-C5 — Risk Aggregator
- **Goal:** aggregate signals/patterns → Safety Incident + calibrated confidence. **Out-of-scope:** auto guilt.

### CS-C6 — Privacy Gateway
- **Goal:** the network boundary enforcing the allowlist, signature, anti-replay, rate limits. **Out-of-scope:** raw content.
- **Security gate:** unknown/forbidden fields rejected; replay detected. **Acceptance:** gateway rejection tests.

### CS-C7 — Family Dashboard & Protected Profiles
- **Goal:** Family workspace UI, protected profiles, guardian relationships. **Out-of-scope:** message access, business nav.
- **Security gate:** family capability gating; no mailbox access. **Acceptance:** UI + isolation tests.

### CS-C8 — Safety Incident & Guardian Alert Workflow
- **Goal:** safe-recipient evaluation → GuardianAlert / ExpertReview / SuppressedAlert. **Out-of-scope:** auto-decision.
- **Security gate:** guardian ≠ auto safe recipient; suppressed cases audited.

### CS-C9 — Evidence Consent Flow
- **Goal:** explicit evidence-sharing consent, separate from detection. **Out-of-scope:** auto capture.

### CS-C10 — Expert Validation Portal
- **Goal:** organization workspace review flows (referral-gated). **Out-of-scope:** implicit family access.

### CS-C11 — Evaluation Harness & Model Metrics
- **Goal:** precision/recall/calibration harness on synthetic data. **Out-of-scope:** production data.

### CS-C12 — DPIA, Child Safety Impact Assessment & Abuse Prevention
- **Goal:** formal DPIA + abuse-prevention controls. **Out-of-scope:** legal sign-off (external).

### CS-C13 — Organization Partner Pack
- **Goal:** invite-only organization onboarding + partner contracts. **Out-of-scope:** public org registration.

### CS-C14 — Platform Integration Contract & SDK Foundation
- **Goal:** platform-side SDK contract (signals out, no content). **Out-of-scope:** Meta production integration.

### CS-C15 — Pilot Readiness
- **Goal:** end-to-end pilot checklist (local). **Out-of-scope:** real deployment, real families.
