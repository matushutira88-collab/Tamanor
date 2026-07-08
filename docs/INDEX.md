# Guardora.ai — Docs Index

Start here. Guardora is an **AI Reputation Firewall for modern brands** —
read-only by default, human approval for sensitive actions, official OAuth/API
connectors only.

## Demo & launch

- [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) — ordered walkthrough for a professional demo (A–K).
- [LAUNCH_SAFETY_CHECKLIST.md](./LAUNCH_SAFETY_CHECKLIST.md) — gate before public exposure.
- [PRODUCT_STATUS.md](./PRODUCT_STATUS.md) — current state, verified capability, what's still disabled.

## Setup & operations

- [META_SETUP.md](./META_SETUP.md) — connect a real Meta App (read-only) + OAuth scopes.
- [LIVE_META_TEST.md](./LIVE_META_TEST.md) — live read-only test runbook + troubleshooting.
- [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) — token storage modes + production TODO.

## Reference

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system architecture.
- [DATA_MODEL.md](./DATA_MODEL.md) — Prisma data model.
- [API_CONNECTORS.md](./API_CONNECTORS.md) — connector runtime & modes.
- [SECURITY.md](./SECURITY.md) — security & compliance principles.
- [PRD.md](./PRD.md) — product requirements.
- [ROADMAP.md](./ROADMAP.md) — roadmap.

## Ground rules (apply everywhere)

- Read-only by default; **moderation actions (reply/hide/delete) are disabled.**
- No scraping, no shared passwords — official OAuth/API only.
- Tokens never appear in UI, logs, or audit.
- No fake claims: no "Meta approved", no fake clients/partners/KPIs.
- Demo data is clearly labeled; only Meta read-only sync is truly verified.
