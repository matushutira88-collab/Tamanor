# Guardora.ai — Data Model

The data model lives in two mirrored places:
- **`@guardora/core`** — TypeScript domain types & enums (source of truth for
  application code).
- **`@guardora/db`** — the Prisma schema (source of truth for the database).

Enums are kept identical in both. All rows are **tenant-scoped**.

## Entity relationships

```
Tenant 1───* Membership *───1 User
  │
  ├──* Brand
  │      ├──* ConnectedAccount ──* ContentItem 1──1 ReputationItem
  │      │                                              │
  │      ├──* BrandRule                                 └──* ModerationDecision
  │      └──* ReportSnapshot
  │
  └──* AuditLog
```

## Entities

### Tenant
Billing/account boundary. Owns all brands, users (via membership), and data.
Fields: `name`, `slug` (unique), `plan`.

### User & Membership
`User` is a person (email-unique, `locale`). `Membership` links a user to a
tenant with a `Role` (`owner` | `admin` | `moderator` | `viewer`). Unique on
`(userId, tenantId)`.

### Brand
A protected identity owned by a tenant. One tenant → many brands. Fields:
`name`, `displayName`, `defaultLocale`.

### ConnectedAccount
Links a brand to one external platform account via **official OAuth**. Stores
OAuth tokens only (never passwords); encrypt at rest in production. Fields:
`platform`, `status` (`pending`/`active`/`expired`/`disconnected`/`error`),
`externalId`, `externalName`, `scopes`, token fields, `lastSyncedAt`.
Unique on `(brandId, platform, externalId)`.

### ContentItem
Immutable, normalized source content pulled from a platform (comment, reply,
review, mention, DM). Fields: `kind`, `externalId`, `externalParentId`, `text`,
author fields, `rating`, `permalink`, `publishedAt`, `ingestedAt`.
Unique on `(connectedAccountId, externalId)` for dedupe.

### ReputationItem
The workflow object wrapping a `ContentItem` with its risk assessment and
status. 1:1 with `ContentItem`. Fields: `status`
(`new`/`classified`/`needs_approval`/`actioned`/`resolved`),
`requiresApproval`, and embedded risk: `riskLevel`, `riskConfidence`,
`riskCategories[]`, `sentiment`, `riskRationale`, `riskEngine`, `assessedAt`.

### ModerationDecision
An action proposed or taken on a reputation item. Fields: `action`
(`none`/`reply`/`hide`/`delete`/`mark_resolved`/`escalate`), `actorKind`
(`ai`/`human`/`rule`/`system`), `status`
(`proposed`/`approved`/`rejected`/`executed`/`failed`), `replyText`, `reason`,
`confidence`, approval fields, `executedAt`, `error`. Every automated action
produces one; each is auditable.

### BrandRule
Deterministic policy layered over the AI engine. `conditions` (JSON: platforms,
categories, min level, min confidence, keywords) + `action` (JSON: action,
`requiresApproval`, `replyTemplate`), plus `enabled`, `priority`.

### AuditLog
Append-only, immutable. Fields: dot-namespaced `event` (e.g.
`moderation.hide.executed`), `actorKind`, `actorUserId`, `targetType`,
`targetId`, `metadata` (JSON). Indexed by `(tenantId, createdAt)` and `event`.

### ReportSnapshot
Point-in-time aggregated metrics for a brand over a period (`periodStart`,
`periodEnd`, `metrics` JSON), so history survives item resolution.

## Enums (shared)

`Platform`, `Role`, `ConnectorStatus`, `ContentKind`, `ReputationStatus`,
`RiskLevel`, `RiskCategory`, `Sentiment`, `ModerationAction`, `ActorKind`,
`DecisionStatus`.

## Invariants

- Every row carries `tenantId`; all queries are tenant-scoped.
- `ContentItem` is immutable after ingest; workflow state lives on
  `ReputationItem`.
- No `ModerationDecision` with `status = executed` may exist without a
  corresponding `AuditLog` entry.
- Sensitive categories force `requiresApproval = true` regardless of rules.
