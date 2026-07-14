# Tamanor — Production Environment Checklist (V1.48P)

All secrets are provisioned via the platform's environment/secret manager — **never committed**.
`git grep` the repo: no production secret value is committed (`.env` is git-ignored; `.env.example`
holds placeholders only; the committed `tamanor_app` DB password + `AUTH_secret` default are **dev-only**
and MUST be overridden — see ⚠️ below).

Legend: **M**=mandatory · **O**=optional · **F**=feature-flag · **S**=secret · **D**=safe default exists.

## Web
| Var | Class | Notes |
|---|---|---|
| `NODE_ENV=production` | M | enables fail-closed prod checks (plaintext-token ban, RLS strictness) |
| `APP_URL` | M / D | canonical app URL |
| `DATABASE_URL` | **M · S** | **owner** role; migrations only |
| `APP_DATABASE_URL` | **M · S** | ⚠️ **non-superuser `tamanor_app` role; MUST differ from `DATABASE_URL`** (RLS runtime). Readiness fails if missing/equal. **Rotate the committed `tamanor_app` password** and keep the DB on a private network. |
| `AUTH_SECRET` | O · D | currently **unused** by session code (opaque DB tokens); readiness checks presence — set a random value anyway |
| `TOKEN_ENCRYPTION_MODE` | **M** | `aes-gcm` (or `kms`) in prod — **`plaintext` is rejected**; readiness → misconfigured otherwise |
| `TOKEN_ENCRYPTION_KEY` | **M · S** | required for `aes-gcm` |

## Meta
| Var | Class | Notes |
|---|---|---|
| `META_APP_ID` / `META_APP_SECRET` | **M · S** | OAuth; `getMetaConfig().configured` false without them |
| `META_REDIRECT_URI` | M | OAuth callback |
| `META_WEBHOOK_VERIFY_TOKEN` | **M · S** | webhook challenge verification |
| `META_LIVE_SYNC` | F | default OFF |
| `META_WEBHOOK_SYNC` | F | default OFF — webhook-driven sync |

## Worker
| Var | Class | Notes |
|---|---|---|
| `WORKER_SYNC_INTERVAL_MS` | O · D | maintenance cadence (60s) |
| `AUTO_SYNC_ENABLED` / `AUTO_SYNC_INTERVAL_SECONDS` | F · D | auto read-only sync (default OFF) |
| (worker shares all DB/encryption/Meta vars above) | M | worker is a **long-running process** — deploy on a persistent host, not serverless |

## AI / cost
| Var | Class | Notes |
|---|---|---|
| `AI_PAID_ENABLED` | **F** | **default OFF** — no paid call without it |
| `AI_PAID_EMERGENCY_DISABLE` | F | hard kill switch |
| `AI_PAID_GLOBAL_DAILY_CALL_LIMIT` / `_COST_LIMIT_MICROS` | O · D | global fuses |
| `AI_PAID_RPM_LIMIT` / `_MAX_CONCURRENCY` / `_TIMEOUT_MS` | O · D | backstops |

## Retention (V1.45C3)
| Var | Class | Notes |
|---|---|---|
| `WEBHOOK_MAX_PAYLOAD_AGE_DAYS` | O · D | 30 — technical default, confirm with policy |
| `WEBHOOK_ROW_TTL_DAYS` | O · D | 90 — must be `>` payload age |
| `WEBHOOK_PURGE_BATCH` | O · D | 250 |

## Token lifecycle (V1.46/47)
| Var | Class | Notes |
|---|---|---|
| `TOKEN_EXPIRY_WARN_DAYS` | O · D | 7 — reconnect-warning window |

## Rate limiting (V1.48P)
| Var | Class | Notes |
|---|---|---|
| `PUBLIC_FORM_RATE_LIMIT` / `_WINDOW_MS` | O · D | 5 / 60s per IP (book-demo/contact/lead) |
| `WEBHOOK_RATE_LIMIT` / `_WINDOW_MS` | O · D | 600 / 60s per IP (generous; signature still authoritative) |

## Observability
| Var | Class | Notes |
|---|---|---|
| (none required) | — | ops sink initialized at startup → **structured stdout**; centralize logs at the platform. A vendor sink is swapped in via `setOpsSink` — no env needed for the default. Metrics are in-process (add an exporter for multi-customer). |

## Feature flags (default state)
`META_LIVE_SYNC`=off · `META_WEBHOOK_SYNC`=off · `AUTO_SYNC_ENABLED`=off · `AI_PAID_ENABLED`=off ·
`LIVE_ACTIONS_ENABLED`=off · `GOOGLE_BUSINESS_*` unset (GBP not a pilot provider).

## ⚠️ Pre-launch secret hardening (required)
1. **Override the committed `tamanor_app` DB-role password** (the RLS migration hardcodes `'tamanor_app'`
   for dev); create the role with a strong password (the migration skips creation if the role exists).
2. Keep Postgres on a **private network** (not publicly reachable).
3. `TOKEN_ENCRYPTION_MODE=aes-gcm` + a real `TOKEN_ENCRYPTION_KEY`.
4. Distinct `DATABASE_URL` (owner) vs `APP_DATABASE_URL` (`tamanor_app`).
5. Set all Meta secrets + `META_WEBHOOK_VERIFY_TOKEN`.
6. Verify `GET /api/ready` → 200 with every check `healthy` before opening traffic.
