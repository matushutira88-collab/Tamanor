# 11 — Supported Source Contract

Per content source: allowed scope · required authority · technical feasibility ·
legal risk · API limits · auto-action possible? · prohibited use. **Architecture
must never assume access to private messages or the ability to delete content on
accounts the tenant does not own.**

## 1. Public comments on OWNED social accounts
- **Scope:** public comments on accounts the tenant legitimately owns/manages via
  official API (reuse existing brand connector path; content may be `ContentItem`).
- **Authority:** platform OAuth + manage/read permission for that account; API ToS.
- **Feasibility:** High–Medium.
- **Legal risk:** author profiling, identifier storage, wrongful attribution,
  disproportionate retention of public content.
- **API limits:** incomplete history, rate limits, API changes, deleted content
  may be irrecoverable, limited author data.
- **Auto-action:** possible **only** where tenant owns/manages the account, API
  supports moderation, permission granted, policy allows — else recommend only.
- **Prohibited:** treating public comments as covert surveillance; over-retention.

## 2. Comments in communities/groups
- **Scope:** depends on community ownership + platform API.
- **Authority:** admin/moderator rights in the community.
- **Feasibility:** variable.
- **Legal risk:** processing members' content; unclear privacy expectation in
  closed groups; requires transparent notice of monitoring.
- **API limits:** private/closed groups often lack full API access.
- **Auto-action:** only via an officially supported moderator integration; else
  notify/recommend-report only.
- **Prohibited:** covert monitoring of a closed group without notice.

## 3. Internal chat / school platform
- **Scope:** own platform or contractual API integration.
- **Authority:** org must have lawful basis to process the content; users
  informed; purpose + scope defined; (minors → C14 gate).
- **Feasibility:** Medium–High (own platform).
- **Legal risk:** **very high** for employees/minors — covert monitoring,
  disproportionate surveillance, access to private communication, secondary use.
- **API limits:** encrypted messages, limited event APIs, cannot read E2E content,
  differing retention rules.
- **Auto-action:** only if the own platform supports it **and** policy approves;
  consequential decisions require human review.
- **Prohibited:** secret monitoring; reading E2E content; scope creep.

## 4. User-uploaded screenshots / evidence
- **Scope:** victim/guardian/reporter-submitted material.
- **Authority:** the uploader must be permitted to submit it; the system does
  **not** assert the screenshot is authentic.
- **Feasibility:** High.
- **Legal risk:** may contain third-party data, be edited, contain intimate/illegal
  content, or carry more context than needed.
- **Limits:** cannot auto-verify full authenticity; no platform timestamp/metadata;
  OCR/AI may err.
- **Auto-action:** **No.** A screenshot gives Tamanor **no** authority to act on the
  origin platform. Allowed: store (evidence layer), analyze, redact, recommend a
  next step. Store as **IncidentEvidence**, never as `ContentItem`.
- **Prohibited:** claiming authenticity; acting on the source platform.

## 5. Explicit API integrations
- **Scope:** documented, tenant-scoped partner APIs.
- **Authority:** minimal scopes, rotated tokens, revocation, integration audit,
  tenant separation.
- **Feasibility:** partner-dependent; prefer explicit contracts.
- **Legal risk:** controller-to-controller transfer, international transfer,
  unclear responsibility, disproportionate continuous monitoring.
- **API limits:** availability, latency, rate limits, identifier quality, deleted
  content unavailable.
- **Auto-action:** only where explicitly supported + authorized; else notify /
  propose manual intervention.
- **Prohibited:** assuming private-message access or foreign-account moderation.

## Global source invariants
- Auto-action requires **ownership/authority + official API support + policy +
  (for consequential steps) human approval**. Default is **notify / recommend**.
- Evidence layer is the home for anything user-submitted or sensitive — not
  `ContentItem`, not `SecurityDetection.evidence`.
- Each source must be re-assessed against the **current** platform ToS at
  integration time; C0 records the contract, not an integration.
