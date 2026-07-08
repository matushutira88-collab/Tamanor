# Guardora.ai — Product Requirements Document

## 1. Summary

Guardora.ai is an **AI Reputation Firewall** for brands. It protects the
comments, reviews, and public reputation of one or more brands across every
major social and review platform, from a single unified inbox — guarded by an
AI Risk Engine, a human approval workflow, and a complete audit log.

Guardora is a **global, multi-tenant, multi-brand, multi-platform SaaS**, not a
single-network tool. Facebook is one connector among many.

## 2. Problem

Brands are attacked and eroded in public: spam, scams impersonating the brand,
harassment of staff and customers, coordinated brand attacks, misinformation,
and unanswered complaints — spread across Facebook, Instagram, YouTube,
LinkedIn, TikTok, and Google reviews. Teams monitor these manually, per
network, with no shared triage, no consistent policy, and no audit trail. The
result is slow response, inconsistent moderation, and reputational damage.

## 3. Goals

- **Unify** reputation signals from all platforms into one inbox.
- **Classify** every item for risk and sentiment with an AI Risk Engine.
- **Protect** automatically where it is safe and permitted; **escalate** where
  it is not.
- **Keep humans in control** — sensitive actions require approval.
- **Prove** what happened — a full, immutable audit trail.
- **Scale** to many brands, many platforms, many languages, many tenants.

### Non-goals (initially)
- Content publishing / scheduling.
- Paid-ad management.
- Full social listening beyond owned-surface reputation.
- Any scraping or non-official data access.

## 4. Target users

- **Brand / reputation managers** — own the outcome, set policy.
- **Moderators / community managers** — triage and act on the inbox.
- **Agencies** — manage many brands (tenants) from one account.
- **Legal / compliance** — rely on the audit log and controls.

## 5. Core capabilities

1. **Brand Inbox** — unified, filterable stream of comments, reviews, and
   mentions across platforms and brands.
2. **AI Risk Engine** — per-item risk level, categories, sentiment, and a
   confidence score that gates automation.
3. **Human Approval** — sensitive / low-confidence items routed to a person;
   nothing destructive happens silently.
4. **Brand Rules** — deterministic policies layered over the AI engine.
5. **Moderation actions** — reply, hide, delete, mark resolved, escalate —
   only where the platform API allows, always audited.
6. **Audit Log** — append-only record of every automated and manual action.
7. **Reports** — reputation trends and moderation metrics per brand/platform.

## 6. Guardrails (product-level)

- No scraping. Official OAuth / APIs only.
- No client passwords are ever requested or stored.
- Every automated action is audited.
- Auto-hide only at high confidence and only where the API allows it.
- Sensitive items (legal threats, self-harm, high-severity) always require a
  human.
- Global by design: multi-language, multi-region, multi-platform.

## 7. Success metrics (illustrative)

- Median time-to-triage for high-risk items.
- % of high-confidence spam/scam auto-actioned without human effort.
- Reduction in unanswered negative reviews/comments.
- Zero un-audited automated actions (hard invariant).

## 8. Status

Early scaffold. Domain model, connector interface, placeholder adapters, a
placeholder AI classifier, DB schema, dashboard, and worker skeleton exist. **No
real platform API calls are made yet.** See [ROADMAP.md](./ROADMAP.md).
