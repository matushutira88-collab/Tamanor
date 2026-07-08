# Guardora.ai — Security & Compliance Principles

These principles are **product invariants**. They apply from V1 and must never
regress. Where code and a principle disagree, the principle wins.

## 1. Data access

- **No scraping. Ever.** Guardora only reads data through platforms' official
  APIs.
- **No client passwords.** We never ask for, receive, or store a user's or
  brand's login credentials for any platform.
- **Official OAuth only.** All platform access uses sanctioned OAuth grants with
  the minimum necessary scopes.

## 2. Automated actions

- **Everything is audited.** Every automated action produces a
  `ModerationDecision` and an append-only `AuditLog` entry (who/what/when/why,
  incl. engine version and confidence). No `executed` decision may exist without
  an audit entry.
- **Auto-action is constrained.** Automated moderation (e.g. auto-hide) is
  allowed only when **all** hold:
  1. AI confidence ≥ the high-confidence threshold;
  2. the platform API supports the action (`PLATFORM_META`);
  3. the category is **not** sensitive.
- **Human approval for sensitive items.** Legal threats, self-harm, and
  high/critical severity always route to a human — rules cannot override this.
- **No destructive default.** Placeholder connectors make no network calls and
  take no action. Delete is never a silent automated default.

## 3. Tenant isolation

- Every domain row carries `tenantId`; all queries are tenant-scoped.
- Authorization is role-based (`owner`/`admin`/`moderator`/`viewer`) and
  enforced server-side.
- One tenant can never read or act on another tenant's data.

## 4. Secrets & tokens

- OAuth tokens are stored on `ConnectedAccount` and **encrypted at rest** in
  production; they are never exposed to the client.
- App/client secrets live only in server-side env (`.env`, never committed).
  `.env.example` documents every variable with empty values.
- Placeholder mode runs without any secrets so development never needs real
  credentials.

## 5. Privacy & data handling

- Guardora stores only what is needed to moderate reputation: public content,
  authorship metadata provided by the API, and moderation state.
- Content is treated as potentially personal data; deletion/retention controls
  and data-residency options are on the roadmap (V3–V4).
- Audit logs are immutable and retained for accountability.

## 6. Reliability as a safety property

- Token refresh, rate-limit handling, and retries must fail **safe**: on
  uncertainty, do nothing and surface for human review rather than act.
- Unsupported platform actions degrade gracefully
  (`{ ok: false, unsupported: true }`) instead of throwing or faking success.

## 7. Global by design

- Multi-language and multi-region from the start: locale-aware classification,
  translated UI, and localized reply templates (progressively delivered).

## 8. Development guardrails

- No demo data that impersonates real clients or real brands.
- No real platform API calls until a connector is explicitly implemented and
  authorized.
- Small, reviewable changes; typecheck/build after each significant step.

## 9. Connector runtime & token storage (V1.2)

- **Connector modes gate everything.** Every connected account has a
  `ConnectorMode` (`placeholder` / `oauth_ready` / `read_only` /
  `action_disabled`). A `ConnectorRuntime` wraps each adapter and enforces the
  mode. In V1.2 **no mode enables moderation actions** — reply/hide/delete return
  `{ ok:false, disabled:true }` (never a fake success), even for an
  approved-and-executed proposal. This is defense in depth *beneath* the
  approval workflow.
- **Read-only means read-only.** The real Meta connector issues Graph API GET
  reads only — no POST/DELETE. Live reads run only when `META_LIVE_SYNC=true`
  and a token is present; otherwise sync is a no-op or a clearly-labelled MOCK
  fallback. Nothing pretends to be connected without a completed OAuth.
- **Token storage.** OAuth tokens live only in the persistence layer
  (`connected_accounts`), never in the domain model, never in the UI, never in
  logs or audit metadata. **In development they are stored as plaintext for
  simplicity. In PRODUCTION these columns MUST be encrypted at rest** (KMS /
  envelope encryption). This is a hard launch requirement, not optional.
- **OAuth safety.** State is CSRF-protected via an httpOnly cookie; a mismatch
  aborts the flow. Token-exchange and Graph errors are surfaced with generic
  messages that never echo the app secret, the code, or the token.
- **Webhooks.** Inbound Meta webhooks are signature-verified
  (`X-Hub-Signature-256`, HMAC-SHA256 with the app secret). Events are stored raw
  in `webhook_events` with a `signatureValid` flag and take **no** automatic
  moderation action. Verification (`GET`) echoes the challenge only on an exact
  verify-token match.
- **Env validation.** Meta credentials are validated centrally
  (`getMetaConfig`). Missing credentials surface a clear "configuration missing"
  state in the UI — never a fake connection.

---

**Summary invariant:** Guardora never accesses data it wasn't officially granted,
never takes a destructive action silently, and can always prove what it did.
