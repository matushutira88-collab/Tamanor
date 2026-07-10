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
