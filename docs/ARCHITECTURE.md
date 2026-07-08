# Guardora.ai — Architecture

## Overview

Guardora is a pnpm monorepo split into **apps** (deployable) and **packages**
(shared libraries). The design goal is a clean separation between the domain
model, the platform adapters, the AI engine, and the surfaces (web + worker),
so any one can evolve — or be swapped — without touching the others.

```
┌────────────────────────────────────────────────────────────────┐
│                          apps/web (Next.js)                      │
│   Landing · Dashboard (Inbox, Accounts, Rules, Audit, Reports)   │
└───────────────┬───────────────────────────────┬─────────────────┘
                │                                │
                │ reads/writes                   │ OAuth callbacks
                ▼                                ▼
┌────────────────────────────────────────────────────────────────┐
│                        packages/db (Prisma)                      │
│      Tenant · Brand · ConnectedAccount · ContentItem ·           │
│      ReputationItem · ModerationDecision · BrandRule ·           │
│      AuditLog · ReportSnapshot                                    │
└───────────────▲───────────────────────────────▲─────────────────┘
                │                                │
                │ persists                       │ persists
┌───────────────┴────────────────┐   ┌───────────┴─────────────────┐
│        apps/worker              │   │      shared packages         │
│  scheduler → sync → classify →  │   │  core  · ai · connectors ·   │
│  triage → (audited) actions     │   │  config                      │
└───────────────┬─────────────────┘   └──────────────────────────────┘
                │
        ┌───────┴──────────────┐
        ▼                      ▼
  packages/connectors    packages/ai
  (Meta, YouTube,        (RiskClassifier /
   LinkedIn, TikTok,      RiskEngine)
   GoogleBusiness)
        │
        ▼
  Official platform APIs (OAuth) — no scraping
```

## Packages

| Package | Responsibility |
| --- | --- |
| `@guardora/core` | Domain types & enums: platforms, brands, reputation items, risk, moderation, rules, audit. The single source of truth. No runtime deps. |
| `@guardora/ai` | The AI Risk Engine behind a `RiskEngine` interface. Ships a deterministic placeholder `RiskClassifier`; real model-backed engines plug in without downstream changes. |
| `@guardora/connectors` | The unified `PlatformConnector` interface + one adapter per platform. Adapters are placeholders today; each documents the official endpoints it will use. |
| `@guardora/db` | Prisma schema + a shared client singleton. Mirrors `core` enums. |
| `@guardora/config` | Zod-validated env loading + per-connector credential resolution. Placeholder-friendly (secrets optional in dev). |

## Apps

| App | Responsibility |
| --- | --- |
| `apps/web` | Next.js App Router. Public landing page + multi-tenant SaaS dashboard. |
| `apps/worker` | Long-running background process: schedules syncs, classifies content, triages, and (later) executes audited moderation actions. |

## Key flows

### Ingestion & classification (worker)
1. Scheduler tick loads active `ConnectedAccount`s.
2. For each, the matching `PlatformConnector` pulls comments/reviews via
   official API (placeholder returns empty today).
3. Fetched content is normalized to `ContentItem`s and persisted (dedupe by
   `(connectedAccountId, externalId)`).
4. The `RiskEngine` classifies each item → `ReputationRisk`.
5. Triage decides: auto-eligible (high confidence) vs. **needs approval**
   (sensitive or low confidence).

### Moderation (separate, audited step)
- `BrandRule`s + risk decide a proposed `ModerationAction`.
- Auto-action is allowed only at high confidence, only where the platform API
  supports it, and never for sensitive categories.
- Every proposal/approval/execution writes a `ModerationDecision` **and** an
  `AuditLog` entry.

## Design principles

- **Interface-first.** The worker and moderation pipeline talk only to
  `PlatformConnector` and `RiskEngine`, never to a vendor SDK.
- **Capability-aware.** `PLATFORM_META` declares per-platform support for
  reviews/hide/delete/reply; unsupported actions degrade gracefully
  (`{ ok: false, unsupported: true }`) rather than throwing.
- **Safe by default.** Placeholders make no network calls and take no
  destructive action.
- **Multi-tenant everywhere.** Every domain row carries `tenantId`; queries are
  always tenant-scoped.

## Tech stack

TypeScript · Next.js (App Router) · Tailwind CSS v4 · Prisma · PostgreSQL ·
pnpm workspaces · tsx (worker) · Zod (config).
