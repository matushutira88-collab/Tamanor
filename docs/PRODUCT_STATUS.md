# Guardora.ai — Product Status

A concise snapshot of where the product is today.

**One-liner:** AI Reputation Firewall for modern brands — read-only by default,
human approval for sensitive actions, official OAuth/API connectors only.

---

## Milestones delivered

| Stage | What it added |
| --- | --- |
| **V0** | Scaffold — pnpm monorepo, Next.js App Router, Prisma/Postgres. |
| **V1** | Foundation — domain model, dashboard, seed dev data. |
| **V1.1** | Human approval workflow (propose → approve/reject → execute gate). |
| **V1.2** | Connector runtime & modes; moderation actions gated off. |
| **V1.3** | Meta OAuth (official login) + Facebook Page selection. |
| **V1.4** | Live Meta validation (read-only), safe-failure paths. |
| **V1.8** | Public trust pages + demo/lead capture, SEO, footer/CTA. |
| **V1.9** | Demo-ready product polish (rich demo data, charts, case studies). |
| **Global Visual QA Polish** | Contrast/premium pass, real brand icons, dark landing / light dashboard / dark-teal sidebar, `[MOCK]` removed from customer UI. |
| **Real Meta read-only sync** | **Verified end-to-end** against a real Facebook Page. |

## Current verified capability

**Facebook Page comment → Meta API → Guardora live read-only sync →
ReputationItem → Inbox / detail.**

- Official OAuth connection with Page selection.
- Live read-only sync (fetched 1, created 1, dedup works).
- AI risk assessment (risk level, sentiment, priority, categories).
- No platform action performed — reads only.

## Still disabled intentionally

- **reply / hide / delete / any moderation action.**
- Even after human approval, execution is gated off at the connector runtime.
- Enablement is a separate, later phase with per-brand opt-in, approval, audit,
  capability checks, and legal/safety review
  (see [LAUNCH_SAFETY_CHECKLIST.md](./LAUNCH_SAFETY_CHECKLIST.md) §E).

## Notes on data & platforms

- The demo workspace is **demo data**, clearly labeled (sidebar "Demo" badge).
- Only **Meta read-only** is really verified today; other platform connectors are
  placeholder/mock and must not be presented as live.
- Tokens are encrypted at the storage seam and never shown in UI/logs/audit;
  production requires `aes-gcm` or `kms` (plaintext is dev-only).

---

Related: [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) ·
[LAUNCH_SAFETY_CHECKLIST.md](./LAUNCH_SAFETY_CHECKLIST.md) ·
[ROADMAP.md](./ROADMAP.md)
