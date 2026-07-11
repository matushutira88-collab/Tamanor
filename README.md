# Tamanor — Social Account Firewall

**Tamanor protects your social accounts.**

Tamanor protects social accounts from spam, scams, harmful comments and repeated
risky behavior across social platforms — from a single, unified place. You define
the rules; Tamanor applies them automatically, and unclear cases go to your team.

Tamanor is a **multi-tenant, multi-brand, multi-platform** self-service SaaS built
around an **AI Risk Engine**, a **human approval workflow**, and a complete
**audit log** of every automated action.

> Public brand: **Tamanor**. Internal package names (`@guardora/*`), DB tables,
> and Prisma models may still use "guardora" during the transition — this is
> intentional and not user-visible.

---

## Beta launch status (V1.34)

Tamanor is in **beta pilot**. First agencies/clients can request access at
`/book-demo`.

**Platform matrix (V1.35 — read-first, capability-honest):**

| Platform | Read / Monitoring | Reviews | Hide / Moderation |
| --- | --- | --- | --- |
| **Facebook Page** | ✓ comments | — | ✓ auto-hide + manual |
| **Instagram Business** | ✓ comments | — | research/test only (not enabled) |
| **YouTube** | ✓ comments | — | — (read-only) |
| **Google Business Profile** | — | ✓ reviews | — (no auto-reply) |
| **LinkedIn Company** | research | — | — |
| **TikTok Business** | research | — | — |

Every platform must reach **READ → ANALYZE → REPUTATION → ACTOR RISK** before any
moderation is considered. Moderation is only enabled after real API verification.
Capabilities are never guessed: an unsupported action returns `capability = false`
and its UI control is never shown. Actor identity is **platform-scoped**
(`facebook:id:X` ≠ `youtube:id:X`) — identities are never merged across platforms.

**Safe env gates (default, fail-closed):**

```
LIVE_ACTIONS_DRY_RUN=true
LIVE_HIDE_TEST_CONFIRM=NO
INSTAGRAM_HIDE_TEST_ENABLED=false
INSTAGRAM_HIDE_TEST_CONFIRM=NO
INSTAGRAM_AUTO_HIDE_ENABLED=false
```

**Beta demo checklist** (verify on a real connected Facebook Page — never with fake data):

- [ ] Facebook Page connected
- [ ] safe test comment available
- [ ] positive comment visible in Comments
- [ ] normal criticism visible but **not** hidden
- [ ] risky comment goes to Action Queue or is hidden from public
- [ ] hidden-from-public explanation visible ("author/admins may still see it")
- [ ] Reputation shows sentiment and topics
- [ ] Actor Risk only flags repeated risky behavior
- [ ] Control Center shows customer-defined rules
- [ ] mobile: no horizontal overflow
- [ ] no raw provider/debug data visible by default

**No fake data rule:** never seed fake demo comments, fake accounts, fake
customers, testimonials or logos. Demo/QA data is scoped to test brands and
cleaned up; real-data verification uses a real connected account only.

---

## Principles (non-negotiable)

- **No scraping.** Ever.
- **No client passwords.** We never ask for or store login credentials.
- **Official OAuth / API only.** Every connector uses a platform's sanctioned API.
- **Every automated action is audited.** No silent moderation.
- **Auto-hide only at high confidence**, and only where the platform API allows it.
- **Sensitive items require human approval** before any action.
- **Global by design** — multi-language, multi-region, multi-platform from day one.

---

## Monorepo layout

```
guardora/
├── apps/
│   ├── web/          # Landing page + SaaS dashboard (Next.js App Router)
│   └── worker/       # Background jobs: platform sync + AI classification
├── packages/
│   ├── core/         # Shared domain types, enums, reputation model
│   ├── ai/           # AI Risk Engine
│   ├── connectors/   # Platform adapters (Meta, YouTube, LinkedIn, TikTok, Google)
│   ├── db/           # Prisma schema + DB client
│   └── config/       # Shared env / config
└── docs/             # PRD, architecture, roadmap, data model, security, connectors
```

## Getting started

```bash
pnpm install
cp .env.example .env      # fill in as needed — placeholders run without secrets
pnpm db:generate          # generate Prisma client
pnpm dev                  # run the web app
pnpm dev:worker           # run the worker (separate terminal)
```

> **Status:** early scaffold. Connectors are placeholder implementations — no
> real platform API calls are made yet. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Documentation

| Doc | Purpose |
| --- | --- |
| [PRD.md](docs/PRD.md) | Product requirements |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture |
| [ROADMAP.md](docs/ROADMAP.md) | V1–V4 roadmap |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Entities & relationships |
| [API_CONNECTORS.md](docs/API_CONNECTORS.md) | Connector approach per platform |
| [SECURITY.md](docs/SECURITY.md) | Security & compliance principles |
