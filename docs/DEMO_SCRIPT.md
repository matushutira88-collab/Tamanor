# Guardora.ai — Demo Script

A practical, ordered walkthrough for a first professional demo. Keep it honest:
show what works, label demo data as demo, and never overstate what is enabled.

> Golden rule: **read-only by default, human approval for anything sensitive,
> official OAuth/API only.** Never claim a moderation action ran — they are
> intentionally disabled.

---

## A. Opening (30–45s)

- **Guardora.ai is an AI Reputation Firewall for modern brands.**
- It monitors comments, reviews, and public feedback across platforms and
  surfaces reputation risk in one place.
- The product is **read-only by default.**
- **No scraping, no client passwords — only official OAuth / API connectors.**

## B. Landing demo (`/`)

Show:
- The homepage and positioning ("AI Reputation Firewall for modern brands").
- **Supported platforms** with real brand icons (Facebook, Instagram, YouTube,
  LinkedIn, TikTok, Google; API = neutral code icon).
- The **"Safe by design"** section (read-only, OAuth-only, human approval).
- **Case studies** (`/case-studies`) — present them explicitly as **example
  scenarios**, not real customers, with no real numbers.

## C. Dashboard demo (`/dashboard`)

Point at the KPI cards and panels:
- **Received items**, **High risk**, **Pending approvals**, **Connected accounts**.
- **Risk trend** (30-day chart).
- **Platform breakdown** (with real platform icons).
- **Top risky topics**.
- **Sync health** and **Recent incidents**.

Note the **"Demo" badge** in the sidebar — this workspace is demo data.

## D. Accounts demo (`/dashboard/accounts`)

Show:
- **Platform cards** with real social icons, connection **health**, granted
  **permissions**, **last sync**, and connect buttons.
- The connected **Meta account** in **read-only mode**.
- Technical environment checks live under a collapsed **"Developer diagnostics"**
  section — open it only if a technical audience asks.

## E. Real Meta sync proof

This is the credibility moment — it is genuinely verified:
- A real **Facebook Page** was connected via official OAuth (Page selection).
- A **live read-only sync** ran against the Meta Graph API.
- Result: **fetched 1, created 1**, and **dedup works** (re-running does not
  duplicate the item).
- **No platform action was performed** — reads only.

(See [LIVE_META_TEST.md](./LIVE_META_TEST.md) for the runbook and troubleshooting.)

## F. Inbox demo (`/dashboard/inbox`)

Open a comment (ideally the one synced from the Facebook Page):
- The original comment with the **platform icon** and author.
- The **AI risk assessment** card: **risk level**, **sentiment**, **priority**,
  **categories**, and whether it **requires approval**.
- **Triage actions** (immediate, internal — e.g. mark resolved/ignored/escalate).
- **Proposed platform action** section — clearly marked **"No platform action
  executed."**

## G. Approval workflow demo (`/dashboard/approvals`)

- Show a **proposed action** in the queue.
- Explain the **approve / reject / execute** model: a proposal is a suggestion,
  not an action.
- **Nothing runs without human approval.**
- Be explicit: **runtime moderation actions are currently disabled** — even after
  approval, execution is gated off until a separate action-enable phase.

## H. Insights / Reports demo (`/dashboard/insights`, `/dashboard/reports`)

Show the derived charts (data comes from the seeded demo dataset plus the real
synced item):
- **Sentiment trend** (30 days).
- **Risk distribution**.
- **Platform breakdown**.
- **Topics**.
- **Reports** overview and sync monitoring.

Say plainly: most of this is **demo data**; the Facebook item is from the **real
read-only sync**.

## I. Safety close

Reiterate the guarantees:
- **No scraping. No shared passwords. OAuth only.**
- **Token-safe** — tokens are never shown in the UI, logs, or audit.
- **Read-only by default.**
- **Human approval** for sensitive actions.
- **Audit log** of decisions.
- **Capability checks** — unsupported platform actions are shown as unsupported.
- **Unsupported actions never fake success.**

## J. What NOT to say

- ❌ Do **not** say Guardora is "Meta approved" / an official Meta partner.
- ❌ Do **not** claim real customers when showing example/demo scenarios.
- ❌ Do **not** cite fake percentages or savings (e.g. "saved 40%").
- ❌ Do **not** say moderation actions are live — they are **disabled**.
- ❌ Do **not** say all platforms are live — several are placeholder/mock
  connectors today (only Meta read-only is really verified).

## K. Pre-demo checklist

- [ ] `pnpm dev` is running.
- [ ] Postgres is running (Docker `guardora_postgres`).
- [ ] `.env` exists and is populated.
- [ ] `META_LIVE_SYNC` set as needed (`true` only if demoing a live sync).
- [ ] A real Meta account is connected (if showing the sync proof).
- [ ] The Inbox has at least one item (seed the demo workspace if empty).
- [ ] Landing and dashboard load cleanly.
- [ ] Token leak check: no `plain:v1:` / `aesgcm:v1:` in any rendered page.
- [ ] `.env` is **not** committed.

---

Related: [PRODUCT_STATUS.md](./PRODUCT_STATUS.md) ·
[LAUNCH_SAFETY_CHECKLIST.md](./LAUNCH_SAFETY_CHECKLIST.md) ·
[SECURITY.md](./SECURITY.md)
