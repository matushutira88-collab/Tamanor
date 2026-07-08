# Guardora.ai — Known Limitations

Read before testing. These are **intentional** for the beta — not bugs. State
them plainly to testers so expectations are correct.

## Actions & execution

- **Moderation actions (reply / hide / delete) are DISABLED** at the connector
  runtime. They stay off even after human approval, until a separate
  action-enable phase (per-brand opt-in, audit, capability checks, legal review).
- **No platform action is ever executed** — Guardora is read-only by default.
  Unsupported actions are never faked as success.

## Sync

- Read-only sync is **manual** (button) and, when `AUTO_SYNC_ENABLED=true`,
  **automatic polling** by the worker every `AUTO_SYNC_INTERVAL_SECONDS`
  (default 300, off by default in dev). It is **polling, not real-time live
  monitoring** — do not present it as live. It reads only and never executes a
  platform action; dedup and rate-limit backoff apply.

## Platforms

- **Not all platforms are live.** Only **Meta (Facebook Page) read-only sync** is
  really verified. Instagram, YouTube, LinkedIn, TikTok, Google connectors are
  **placeholder/mock** in the demo and must not be presented as live.

## Data

- **Demo data are not real customers.** The Demo Workspace, its brands
  (Aurora Fitness, Northwind Coffee) and reputation items are seeded `[MOCK]`
  content. Case studies are **example scenarios**, not real clients, with no real
  numbers.
- Demo **comment content** may be in English even when the UI is SK/DE — that is
  expected (only UI chrome is localized).

## Providers (translation + AI risk)

- **Provider interfaces are ready** (`TranslationProvider`, `AiRiskProvider`) but
  **no real external provider is wired**. Defaults: `TRANSLATION_PROVIDER=none`,
  `AI_RISK_PROVIDER=none` → **Risk Rules V1 alone**, no translation.
- `mock` providers exist for **local tests only** — clearly labelled and
  **refused in production** (`NODE_ENV=production` → falls back to `none`).
- The hybrid pipeline calls the AI provider **only when gated** (unknown/mixed
  language, low confidence, high/critical risk, scam/threat/legal signal, or a
  brand-rule match) — never on every comment.
- Provider calls are recorded for observability (`provider_calls`): provider,
  type, status, latency — **no tokens, secrets, or full payloads**.
- **No fake AI, no fake translation.** Nothing is executed on any platform.

## Languages & translation

- **App UI supports EN / SK / DE only.** Comment/review **intelligence is
  multilingual**: per-item language detection (best-effort for EN/SK/CS/DE/PL/HU
  and `unknown` fallback for the rest) and multilingual risk lexicons.
- **Do not claim "perfect support for all languages."** Detection and risk are
  heuristic and may be imperfect; uncertain risky items are surfaced for **human
  review**.
- **Translation requires a provider.** With `TRANSLATION_ENABLED=false` (default)
  or no provider, translation status is **"unavailable"** — **no translation is
  ever fabricated**. The **original text is always preserved and shown**.
- Human approval remains required for anything sensitive; nothing is executed.

## Localization

- Marketing (EN/SK/DE) and dashboard **customer-facing UI** are localized
  (513 keys; smoke-tested SK/DE across 13 routes).
- **Legal bodies** of trust pages (privacy/terms/security/about) may still show an
  **EN fallback** — the shells (header/footer/nav) localize, the legal prose is
  pending native translation.
- A few long descriptive paragraphs and billing plan feature bullets remain EN by
  design (no keys yet).

## Commerce & team

- **Billing checkout is disabled** — no payment is processed; plans are display-only.
- **Team invites do not send** — invitation delivery is not wired for the beta.

## Production readiness (before public launch — not beta)

- **Token storage**: production must use **`aes-gcm`** (or a KMS provider);
  plaintext is dev-only and blocked in `NODE_ENV=production`.
- **Meta App Review** required for the exact read scopes before public production.
- **Domain, real emails** (hello@ / security@ / privacy@), backups, monitoring,
  incident response — still to configure. See
  [LAUNCH_SAFETY_CHECKLIST.md](./LAUNCH_SAFETY_CHECKLIST.md).

---

Related: [PRODUCT_STATUS.md](./PRODUCT_STATUS.md) ·
[LAUNCH_SAFETY_CHECKLIST.md](./LAUNCH_SAFETY_CHECKLIST.md) ·
[PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md)
