# OpenAI risk classifier — runbook (V1.60)

OpenAI is a **second classification layer** over the deterministic Risk Rules. It never executes a
platform action, and on **any** error the rules result stands (fail-open). The official SDK lives only in
`packages/ai/src/openai-provider.ts` (server-only) and is reached through the `getAiRiskProvider` factory.

## Environment variables (names only — never commit values)

Enable (all required together for a real call):
- `AI_RISK_PROVIDER=openai`
- `AI_RISK_PROVIDER_ENABLED=true`
- `AI_PAID_ENABLED=true`
- `OPENAI_API_KEY` (preferred; `AI_API_KEY` is a documented fallback)
- `OPENAI_MODEL` (**required** when the provider is openai; `AI_MODEL` is a fallback)

Canary + budget + resilience (keep existing, tune for rollout):
- `AI_PAID_TENANT_ALLOWLIST` — comma-separated tenant ids. **Empty = inactive** (flags/quota only);
  **non-empty = only those tenants** may use paid AI.
- `AI_PAID_GLOBAL_DAILY_CALL_LIMIT`, `AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS`, `AI_PAID_PROVIDER_DAILY_CALL_LIMIT`
- `AI_PAID_RPM_LIMIT`, `AI_PAID_MAX_CONCURRENCY`, `AI_PAID_TIMEOUT_MS`, `AI_PAID_MAX_RETRIES`
- `AI_PAID_CIRCUIT_FAILURE_THRESHOLD`, `AI_PAID_CIRCUIT_COOLDOWN_MS`
- `AI_PAID_EMERGENCY_DISABLE` — emergency master off (see below)
- `AI_RISK_MIN_CONFIDENCE` — rules-confidence threshold below which the AI layer is consulted

If the provider is openai but the key or model is missing, the provider is **forced disabled** and a
`configError` (`openai_api_key_missing` / `openai_model_missing`) is surfaced — it never masquerades as active.

## Safe production enable order

- **A. Deploy code, all AI flags OFF.** `AI_RISK_PROVIDER_ENABLED=false`, `AI_PAID_ENABLED=false`. Nothing changes.
- **B. Verify rules-only production** is healthy (classification still works via Risk Rules).
- **C. Restrict to a canary.** Set `AI_PAID_TENANT_ALLOWLIST` to the internal Tamanor tenant id (or a tiny allowlist).
- **D. Set very low limits.** e.g. `AI_PAID_GLOBAL_DAILY_CALL_LIMIT`/`AI_PAID_PROVIDER_DAILY_CALL_LIMIT` = a few dozen,
  `AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS` low. **Confirm real per-token prices in `usage-pricing.ts` first** —
  until an `openai` model is priced there, every reservation uses the conservative `SAFE_FALLBACK_MICROS`
  (fails closed against budget; real token usage is still recorded).
- **E. Turn it on for the canary:** `AI_RISK_PROVIDER=openai`, `AI_RISK_PROVIDER_ENABLED=true`, `AI_PAID_ENABLED=true`,
  set `OPENAI_API_KEY` + `OPENAI_MODEL`. Run **one explicitly-approved** smoke comment.
- **F. Watch** fallback rate, latency, 429s, schema-validation failures, and cost before widening.
- **G. Widen** the allowlist gradually (or clear it once confident).

## Emergency disable (no deploy)

Fastest → slowest, any one is sufficient (all fail closed):
1. `AI_PAID_EMERGENCY_DISABLE=true` — kills every paid call instantly.
2. `AI_PAID_ENABLED=false` — master off.
3. `AI_RISK_PROVIDER_ENABLED=false` — provider off.
4. `AI_RISK_PROVIDER=none` — unselect openai.
Any of these leaves classification running on rules only. The circuit breaker also auto-opens after
`AI_PAID_CIRCUIT_FAILURE_THRESHOLD` failures for `AI_PAID_CIRCUIT_COOLDOWN_MS`.

## Metrics interpretation

- `processingStatus` on a ReputationItem: `processed_paid` = OpenAI classified; `processed_rules`/`cached` =
  rules/cache (normal majority); `failed` + reason `paid_provider_failed`/`paid_provider_timeout` = the AI
  call failed and **rules were used** (not a data loss — expected fail-open).
- `ProviderCall` rows carry a normalized `errorCode` only (`provider_auth_error`, `provider_rate_limited`,
  `provider_server_error`, `provider_timeout`, `provider_refusal`, `provider_incomplete:*`, `schema_invalid:*`).
  A spike in `provider_auth_error` = bad/expired key → disable + rotate. `schema_invalid:*` spike = model/schema
  drift → investigate before widening.
- No prompt/response/comment text is ever logged (only provider/model/latency/token-usage/status/correlationId).

## Rollback without deploy

Set the flags back to OFF (any of the emergency-disable options). No code rollback needed — the code is
inert with the flags off. To roll back the code itself, redeploy the prior commit; the adapter files are
additive and safe to remove.

## Test mode

- Adapter unit tests are fully mocked (no network/key): `pnpm openai-provider:test`.
- Boundary + metering + fuse tests: `pnpm ai-boundary:test`, `pnpm usage-policy:test`, `pnpm risk:test`.
- To exercise the pipeline locally without paid calls, leave the flags OFF (rules-only) or use
  `AI_RISK_PROVIDER=mock` in a non-production `NODE_ENV`.

## Privacy assumptions

- The request carries only: truncated comment text (≤ `OPENAI_MAX_INPUT_CHARS`), detected language, a
  coarse platform enum, and existing rule signals. **No** name/email/user-id/tenant-id/brand-id/token/URL.
- The Responses API call sets `store: false` (no OpenAI-side retention requested) and uses no tools.
  `store: false` is NOT the same as account-level Zero Data Retention — if ZDR is required, arrange it on
  the OpenAI account/org separately. Do not assume it is automatic.
