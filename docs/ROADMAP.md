# Guardora.ai — Roadmap (V1–V4)

Each version is shippable and builds on the last. Guardrails
([SECURITY.md](./SECURITY.md)) apply from V1 and never regress.

---

## V0 — Scaffold ✅ (current)

Foundation only; no real platform calls.

- Monorepo (apps + packages), shared domain model.
- Unified `PlatformConnector` interface + placeholder adapters (Meta, YouTube,
  LinkedIn, TikTok, Google Business).
- Placeholder `RiskClassifier` behind the `RiskEngine` interface.
- Prisma schema for the full data model.
- Landing page + dashboard skeleton (Inbox, Accounts, Rules, Audit, Reports).
- Worker skeleton (scheduler → sync → classify → triage), no actions executed.

---

## V1 — First real platform, read-only + manual reply

**Theme: a working unified inbox for one platform, humans in control.**

- Auth + tenants: sign-in, `Tenant`/`User`/`Membership`, roles enforced.
- Real OAuth for the **first connector** (Meta: Facebook Page + Instagram).
- Real sync of comments & reviews → `ContentItem` → `ReputationItem`.
- Live AI Risk Engine (model-backed) replacing the placeholder classifier.
- Inbox: view, filter (brand/platform/risk/status), **manual** reply/hide/
  delete/resolve — every action audited.
- Audit log fully populated. Basic overview stats.

**Exit:** one brand can manage one platform end-to-end, safely and auditably.

---

## V2 — Multi-platform + Brand Rules + approval workflow

**Theme: breadth and controlled automation.**

- Add connectors: **YouTube, Google Business, LinkedIn, TikTok** (official APIs).
- `BrandRule` engine: conditions (platform, category, min level, min
  confidence, keywords) → proposed action.
- **Human approval queue**: proposed actions await approval; sensitive
  categories always require it.
- **Auto-action** for high-confidence spam/scam where the API allows (e.g.
  auto-hide), still audited.
- Reports v1: volume, risk breakdown, response time per brand/platform.

**Exit:** many platforms under one inbox; safe automation with human oversight.

---

## V3 — Scale, teams, and reporting depth

**Theme: production-grade multi-tenant operations.**

- Full RBAC (Owner/Admin/Moderator/Viewer), invitations, multi-brand agencies.
- `ReportSnapshot` history + scheduled reports and exports.
- i18n: multi-language UI + reply templates; locale-aware classification.
- Reliability: retries, rate-limit handling, token refresh, backfill jobs,
  per-platform health monitoring.
- Notifications (email/webhook) for high-risk items and approvals.

**Exit:** agencies run many brands/tenants reliably at scale.

---

## V4 — Intelligence, billing, and ecosystem

**Theme: differentiation and commercialization.**

- Billing & plans (usage tiers, seats, brand/platform limits).
- Advanced AI: brand-voice replies, coordinated-attack detection, escalation
  prediction, per-brand tuning/feedback loop.
- Public API + webhooks for external workflows.
- SSO/SAML, audit exports, data-residency options, advanced compliance.
- Marketplace of reply templates and rule packs.

**Exit:** a commercial, extensible, enterprise-ready reputation firewall.

---

### Cross-cutting (every version)

Security & privacy guardrails, complete audit coverage, no scraping, official
OAuth only, and no destructive default behavior.
