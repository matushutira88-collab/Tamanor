/**
 * V1.38.2 — Tamanor knowledge base. The SINGLE truthful content source that feeds
 * every GEO/landing page AND the AI-discoverability artifacts (llms.txt, ai-index,
 * knowledge-map). Every statement here describes what Tamanor ACTUALLY does today.
 * No marketing embellishment, no capability the product does not have, no pricing
 * the product does not commit to.
 */

export type KnowledgeCollection = "platform" | "features" | "integrations" | "docs" | "compare" | "security";

export interface KnowledgeSection {
  heading: string;
  body: string[];
}
export interface KnowledgeFaq {
  q: string;
  a: string;
}

export interface KnowledgeEntry {
  slug: string;
  collection: KnowledgeCollection;
  /** Page H1 / OpenGraph title. */
  title: string;
  /** Browser <title>. */
  metaTitle: string;
  /** Meta description + llms.txt summary line. One truthful sentence. */
  summary: string;
  keywords: string[];
  sections: KnowledgeSection[];
  faqs: KnowledgeFaq[];
  /** Slugs of related entries (any collection) — powers the internal link graph. */
  related: string[];
  /** Entity ids this page is about (resolved by the entity graph). */
  entityRefs: string[];
  /** Integrations only — the provider key resolved against the central provider-status model. */
  platformKey?: string;
}

/** Route base path for a collection. */
export function collectionBasePath(c: KnowledgeCollection): string {
  return `/${c}`;
}

const K: KnowledgeEntry[] = [
  // ===================== PLATFORM (GEO knowledge) =====================
  {
    slug: "what-is-tamanor",
    collection: "platform",
    title: "What is Tamanor?",
    metaTitle: "What is Tamanor? — Social Account Firewall",
    summary:
      "Tamanor is a Social Account Firewall that monitors comments and reviews on connected social accounts, detects risk with AI, and prepares safe moderation actions a human approves.",
    keywords: ["what is tamanor", "social account firewall", "comment moderation", "brand reputation protection"],
    sections: [
      {
        heading: "A firewall for your social presence",
        body: [
          "Tamanor connects to the social accounts a brand already owns and continuously reads their comments and reviews. It classifies each item for risk — spam, scams, harassment, and repeated risky behavior — and surfaces what needs attention.",
          "Tamanor is read-only by default. When a moderation action is appropriate, Tamanor prepares it and a human approves it before anything happens on the platform. It never posts, replies, or deletes on its own.",
        ],
      },
      {
        heading: "Who it is for",
        body: [
          "Brands, agencies, e-commerce shops, creators and local businesses that receive public comments and reviews and need to protect their reputation without watching every channel by hand.",
        ],
      },
    ],
    faqs: [
      { q: "Does Tamanor post or reply on my behalf?", a: "No. Tamanor is read-only by default and only prepares actions; a human approves every moderation action before it runs." },
      { q: "Which accounts can Tamanor protect?", a: "Facebook Pages are live and verified. The Instagram Professional connector is implementation-complete but verification-pending, and Google Business is a foundation pending approved API access. It connects only through official OAuth." },
    ],
    related: ["how-tamanor-works", "why-tamanor", "ai-moderation", "facebook", "instagram"],
    entityRefs: ["software-application", "product", "brand"],
  },
  {
    slug: "how-tamanor-works",
    collection: "platform",
    title: "How Tamanor works",
    metaTitle: "How Tamanor works — monitoring, risk detection, approval",
    summary:
      "Tamanor connects via official OAuth, reads comments and reviews on a schedule and via webhooks, classifies risk with AI, and routes proposed actions through a human approval queue.",
    keywords: ["how tamanor works", "comment monitoring workflow", "human approval moderation", "oauth social"],
    sections: [
      {
        heading: "Connect",
        body: [
          "You connect an account through the platform's official OAuth flow. Tamanor stores only OAuth tokens (encrypted at rest in production) — never a password, and it never scrapes.",
        ],
      },
      {
        heading: "Monitor",
        body: [
          "A background worker reads new comments and reviews on a schedule, and webhooks deliver near-real-time events. Every fetched item is normalized and deduplicated so the same comment is never processed twice.",
        ],
      },
      {
        heading: "Detect & propose",
        body: [
          "Each item is classified by a hybrid engine (brand rules plus AI risk analysis) into a risk level and category. High-risk items can generate a proposed action, but Tamanor only proposes — it never executes automatically.",
        ],
      },
      {
        heading: "Approve",
        body: [
          "Proposed actions wait in an approval queue. A reviewer with the right role approves or rejects. Only Facebook comment hiding is enabled as a live action today, and only after approval, with the whole flow written to an immutable audit log.",
        ],
      },
    ],
    faqs: [
      { q: "How fresh is the data?", a: "Scheduled reads plus webhook events. Polling and webhooks are deduplicated, so coexistence never creates duplicate items." },
      { q: "What actions can Tamanor take?", a: "Today, controlled Facebook comment hiding after human approval. Everything else is monitoring and analysis." },
    ],
    related: ["worker-architecture", "webhook-architecture", "proposal-engine", "approval-workflow", "what-is-tamanor"],
    entityRefs: ["software-application", "capability-moderation", "capability-webhook"],
  },
  {
    slug: "why-tamanor",
    collection: "platform",
    title: "Why Tamanor",
    metaTitle: "Why Tamanor — safe, honest, human-in-the-loop moderation",
    summary:
      "Tamanor is built safe-by-default: official OAuth only, read-only by default, human approval before any action, row-level tenant isolation, and a full audit trail.",
    keywords: ["why tamanor", "safe moderation", "human in the loop", "brand safety software"],
    sections: [
      {
        heading: "Safe by design",
        body: [
          "No scraping, no stored passwords, no automatic execution. Tamanor offers an action only when the platform truly supports it and a human has approved it.",
        ],
      },
      {
        heading: "Honest about capability",
        body: [
          "Tamanor advertises only what it can actually do per platform. Where a platform is not yet supported, it says so instead of pretending. Capabilities are read from a single source of truth in the codebase.",
        ],
      },
    ],
    faqs: [
      { q: "Is Tamanor fully automated?", a: "No — automation prepares proposals; a human stays in control of every action." },
    ],
    related: ["security", "what-is-tamanor", "automation", "roadmap"],
    entityRefs: ["product", "security", "capability-approval"],
  },
  {
    slug: "architecture",
    collection: "platform",
    title: "Tamanor architecture",
    metaTitle: "Architecture — Tamanor multi-tenant, read→HTTP→write",
    summary:
      "Tamanor is a multi-tenant application with a Next.js web app, a background worker, PostgreSQL with row-level security, and injectable platform connectors that isolate provider network calls from database transactions.",
    keywords: ["tamanor architecture", "multi-tenant saas architecture", "row level security", "background worker"],
    sections: [
      {
        heading: "Components",
        body: [
          "A Next.js web application serves the dashboard and marketing site. A separate worker process runs scheduled monitoring, token health checks and webhook follow-up. PostgreSQL is the system of record.",
          "Platform connectors are injectable: production uses real official-API transports, and tests inject mock transports so the exact production code runs without any network call.",
        ],
      },
      {
        heading: "Read → provider HTTP → write",
        body: [
          "Database work runs in short tenant-scoped transactions. Provider HTTP calls happen strictly between transactions, never inside one, so a slow or failing provider can never hold a database lock or corrupt local state.",
        ],
      },
    ],
    faqs: [
      { q: "Does the worker share the web app's database access?", a: "Both use the same row-level-security runtime role; neither can bypass tenant isolation." },
    ],
    related: ["worker-architecture", "row-level-security", "webhook-architecture", "data-protection"],
    entityRefs: ["software-application", "capability-multi-tenant", "capability-rls"],
  },
  {
    slug: "security",
    collection: "platform",
    title: "Tamanor security",
    metaTitle: "Security — Tamanor OAuth-only, read-only by default",
    summary:
      "Tamanor connects only through official OAuth, never scrapes, never stores passwords, keeps tokens server-side and out of logs, and is read-only by default with human approval before any action.",
    keywords: ["tamanor security", "oauth only", "no scraping", "brand safety security"],
    sections: [
      {
        heading: "Connections",
        body: [
          "Official OAuth and API integrations only. Tamanor never scrapes any platform and never asks for or stores social passwords. Platform capability checks run before any action is offered.",
        ],
      },
      {
        heading: "Tokens",
        body: [
          "OAuth tokens are stored server-side only, encrypted at rest in production. They are never shown in the interface, never written to logs, and never included in the audit trail.",
        ],
      },
      {
        heading: "Isolation & audit",
        body: [
          "Every tenant's data is isolated by PostgreSQL row-level security. Every meaningful action is recorded in an append-only audit log.",
        ],
      },
    ],
    faqs: [
      { q: "Do you store my social password?", a: "Never. Tamanor uses official OAuth; passwords are never requested or stored." },
      { q: "Are tokens ever logged?", a: "No. Tokens are kept out of logs, the UI, error messages and the audit trail." },
    ],
    related: ["row-level-security", "encryption", "data-protection", "audit-log", "privacy"],
    entityRefs: ["security", "compliance", "capability-audit"],
  },
  {
    slug: "row-level-security",
    collection: "platform",
    title: "Row-level security (RLS)",
    metaTitle: "Row-level security — Tamanor tenant isolation",
    summary:
      "Tamanor enforces tenant isolation at the database level with PostgreSQL row-level security, so a forgotten filter in application code can never leak another tenant's data.",
    keywords: ["row level security", "postgres rls", "multi-tenant isolation", "tenant security"],
    sections: [
      {
        heading: "Isolation in the database, not just the app",
        body: [
          "Every tenant-scoped query runs through a non-superuser database role with FORCE ROW LEVEL SECURITY and a tenant-isolation policy. The current tenant is set per transaction; the database itself rejects rows from any other tenant.",
          "This is defense in depth: even if application code forgot a tenant filter, the database still returns only the active tenant's rows.",
        ],
      },
    ],
    faqs: [
      { q: "What if a query forgets to filter by tenant?", a: "Row-level security still restricts results to the active tenant — isolation does not depend on application code remembering to filter." },
    ],
    related: ["security", "architecture", "role-model", "permission-model"],
    entityRefs: ["capability-rls", "capability-multi-tenant", "security"],
  },
  {
    slug: "audit-log",
    collection: "platform",
    title: "Audit log",
    metaTitle: "Audit log — Tamanor append-only action history",
    summary:
      "Tamanor records every meaningful action — connections, syncs, proposals, approvals and moderation — in an append-only, tenant-scoped audit log that never contains token material.",
    keywords: ["audit log", "moderation audit trail", "compliance logging", "action history"],
    sections: [
      {
        heading: "Every action, permanently recorded",
        body: [
          "Connecting an account, running a sync, proposing an action, approving or rejecting it, and executing an approved hide are each written to the audit log with actor, target and metadata. Entries are append-only and scoped to the tenant.",
          "Audit metadata is scrubbed of secrets: no token, password or database URL ever appears in an audit entry.",
        ],
      },
    ],
    faqs: [
      { q: "Can audit entries be edited or deleted?", a: "The audit log is append-only; entries are not edited in place." },
    ],
    related: ["security", "approval-workflow", "proposal-engine", "data-protection"],
    entityRefs: ["capability-audit", "security", "compliance"],
  },
  {
    slug: "permission-model",
    collection: "platform",
    title: "Permission model",
    metaTitle: "Permission model — Tamanor platform + role permissions",
    summary:
      "Tamanor separates platform capability (what an account's OAuth grant truly allows) from workspace roles (what a team member is allowed to do), and offers an action only when both permit it.",
    keywords: ["permission model", "oauth permissions", "role based access", "capability checks"],
    sections: [
      {
        heading: "Two layers of permission",
        body: [
          "Platform permission is the truth of what the connected account can do — read comments, hide a comment, read reviews — derived from the OAuth grant and the platform's API. Workspace permission is what a team member's role allows inside Tamanor.",
          "An action is only offered when the platform supports it AND the user's role allows it. Missing platform permissions are surfaced honestly as a reconnect/re-grant prompt.",
        ],
      },
    ],
    faqs: [
      { q: "What happens if a permission is revoked on the platform?", a: "Tamanor detects the revoked permission on its next check and surfaces a reconnect prompt instead of failing silently." },
    ],
    related: ["role-model", "row-level-security", "security", "connect-facebook"],
    entityRefs: ["capability-role-access", "capability-approval", "security"],
  },
  {
    slug: "role-model",
    collection: "platform",
    title: "Role model",
    metaTitle: "Role model — Tamanor workspace roles",
    summary:
      "Tamanor uses role-based access within each workspace so owners, admins, analysts, reviewers and viewers see and do only what their role allows.",
    keywords: ["role based access control", "rbac", "workspace roles", "team permissions"],
    sections: [
      {
        heading: "Roles fit the job",
        body: [
          "Workspace roles scope who can connect accounts, who can approve moderation actions, and who can only view analytics. Role checks run server-side on every protected action, layered on top of database row-level security.",
        ],
      },
    ],
    faqs: [
      { q: "Can a viewer approve a moderation action?", a: "No. Approval is restricted to roles that permit it; viewers can read but not act." },
    ],
    related: ["permission-model", "approval-workflow", "row-level-security"],
    entityRefs: ["capability-role-access", "capability-approval"],
  },
  {
    slug: "webhook-architecture",
    collection: "platform",
    title: "Webhook architecture",
    metaTitle: "Webhook architecture — Tamanor signed, deduplicated events",
    summary:
      "Tamanor verifies every inbound webhook's signature, routes Facebook and Instagram events through one unified connector, rejects replays, and always resolves the tenant from the connected account — never from the payload.",
    keywords: ["webhook architecture", "webhook signature verification", "replay protection", "meta webhooks"],
    sections: [
      {
        heading: "Trustworthy by construction",
        body: [
          "Inbound events are verified with an HMAC signature before anything is trusted. A stable dedup key rejects replayed deliveries. Only signature-valid events are ever processed; forged or unsigned events are stored for audit but never acted upon.",
          "The tenant is always derived from the matched connected account, never from the webhook body, so a crafted payload cannot cross tenant boundaries.",
        ],
      },
    ],
    faqs: [
      { q: "What stops a replayed or forged webhook?", a: "Signature verification plus a unique dedup key: replays collapse to one event and unsigned events are never processed." },
    ],
    related: ["worker-architecture", "how-tamanor-works", "instagram", "facebook", "webhooks"],
    entityRefs: ["capability-webhook", "capability-multi-tenant"],
  },
  {
    slug: "worker-architecture",
    collection: "platform",
    title: "Worker architecture",
    metaTitle: "Worker architecture — Tamanor scheduled monitoring",
    summary:
      "A separate Tamanor worker runs scheduled read-only monitoring, token-expiry checks and webhook follow-up, each under a trusted tenant context and an account-level lease that prevents overlapping syncs.",
    keywords: ["background worker", "scheduled sync", "sync lease", "token monitor"],
    sections: [
      {
        heading: "One sync per account, safely",
        body: [
          "The worker acquires a short-lived account-level lease before syncing, so a scheduled run and a manual run can never collide. Reads are idempotent; each item is created once and updated in place on change.",
          "The worker only reads. It never executes a moderation action; those flow exclusively through the approval queue.",
        ],
      },
    ],
    faqs: [
      { q: "Can two syncs run for the same account at once?", a: "No. An account-level lease guarantees a single active sync; the second run is skipped cleanly." },
    ],
    related: ["architecture", "webhook-architecture", "how-tamanor-works", "automation"],
    entityRefs: ["software-application", "capability-multi-tenant"],
  },
  {
    slug: "data-protection",
    collection: "platform",
    title: "Data protection",
    metaTitle: "Data protection — Tamanor minimal, isolated data",
    summary:
      "Tamanor stores only the OAuth tokens and public content needed to protect a brand, isolates it per tenant with row-level security, keeps secrets out of logs, and cleans up short-lived onboarding data automatically.",
    keywords: ["data protection", "data minimization", "gdpr readiness", "tenant data isolation"],
    sections: [
      {
        heading: "Store less, protect more",
        body: [
          "Tamanor ingests public comments and reviews plus the OAuth tokens required to read them. Tokens are encrypted at rest in production and never exposed. Short-lived onboarding sessions that hold temporary tokens are deleted automatically once they expire.",
        ],
      },
    ],
    faqs: [
      { q: "Is data shared between customers?", a: "No. Row-level security isolates every tenant's data at the database level." },
    ],
    related: ["privacy", "encryption", "security", "row-level-security"],
    entityRefs: ["security", "compliance", "capability-rls"],
  },
  {
    slug: "privacy",
    collection: "platform",
    title: "Privacy",
    metaTitle: "Privacy — Tamanor data handling",
    summary:
      "Tamanor processes public social content and OAuth tokens for the sole purpose of protecting the connected brand, with tenant isolation, secret scrubbing and no selling of data.",
    keywords: ["privacy", "data privacy", "social data handling"],
    sections: [
      {
        heading: "Purpose-limited processing",
        body: [
          "Content and tokens are processed only to monitor and protect the accounts a customer connects. Tamanor does not sell customer data. See the privacy policy for the authoritative statement.",
        ],
      },
    ],
    faqs: [
      { q: "Where is the authoritative privacy statement?", a: "The privacy policy page is the authoritative source; this page summarizes the technical posture." },
    ],
    related: ["data-protection", "security", "encryption"],
    entityRefs: ["compliance", "security"],
  },
  {
    slug: "encryption",
    collection: "platform",
    title: "Encryption",
    metaTitle: "Encryption — Tamanor token encryption at rest",
    summary:
      "Tamanor encrypts OAuth tokens at rest in production and blocks storing plaintext tokens in production, so credentials are protected even at the database layer.",
    keywords: ["encryption at rest", "token encryption", "kms", "credential protection"],
    sections: [
      {
        heading: "Tokens encrypted at rest",
        body: [
          "In production, OAuth tokens are encrypted before storage and a safety check prevents plaintext tokens from being persisted. Tokens are decrypted only in memory when a read is performed, and are never logged or shown.",
        ],
      },
    ],
    faqs: [
      { q: "Are tokens stored in plaintext?", a: "Not in production — plaintext token storage is blocked and tokens are encrypted at rest." },
    ],
    related: ["security", "data-protection", "privacy"],
    entityRefs: ["security", "compliance"],
  },
  {
    slug: "ai-moderation",
    collection: "platform",
    title: "AI moderation",
    metaTitle: "AI moderation — Tamanor risk detection with human approval",
    summary:
      "Tamanor's AI classifies each comment and review for risk and category, combining brand rules with AI analysis, then proposes actions for a human to approve — it never moderates automatically.",
    keywords: ["ai moderation", "comment risk detection", "content classification", "brand rules"],
    sections: [
      {
        heading: "Hybrid classification",
        body: [
          "Every item is scored by a hybrid engine: deterministic brand rules plus AI risk analysis. The result is a risk level, categories and a sentiment, used to prioritize what a human sees first.",
          "AI output drives proposals and prioritization only. A human approves any action that touches a platform.",
        ],
      },
    ],
    faqs: [
      { q: "Does the AI hide comments by itself?", a: "No. The AI detects and proposes; hiding a comment requires human approval." },
    ],
    related: ["ai-risk-detection", "proposal-engine", "automation", "auto-protection"],
    entityRefs: ["capability-ai-recommendations", "capability-moderation"],
  },
  {
    slug: "automation",
    collection: "platform",
    title: "Automation",
    metaTitle: "Automation — Tamanor proposes, humans decide",
    summary:
      "Tamanor automates monitoring, risk detection and action preparation, but keeps execution human-approved: automation creates proposals, it never executes moderation on its own.",
    keywords: ["moderation automation", "safe automation", "human in the loop automation"],
    sections: [
      {
        heading: "Automate the work, not the decision",
        body: [
          "Scheduled monitoring, deduplicated ingestion, risk scoring and proposal generation are automated. The decision to act stays with a human, so automation never posts, hides or deletes without approval.",
        ],
      },
    ],
    faqs: [
      { q: "Can I turn on fully automatic hiding?", a: "Automatic execution is intentionally not enabled; proposals are prepared for human approval." },
    ],
    related: ["proposal-engine", "auto-protection", "approval-workflow", "ai-moderation"],
    entityRefs: ["capability-automation", "capability-approval"],
  },
  {
    slug: "proposal-engine",
    collection: "platform",
    title: "Proposal engine",
    metaTitle: "Proposal engine — Tamanor prepares safe actions",
    summary:
      "For high-risk items, Tamanor prepares a proposed moderation action with context and routes it to the approval queue; it proposes but never executes automatically.",
    keywords: ["proposal engine", "moderation proposals", "approval queue", "high risk detection"],
    sections: [
      {
        heading: "From risk to a reviewable proposal",
        body: [
          "When an item is high risk and has no open proposal, Tamanor prepares one. The proposal carries the reason and target so a reviewer can decide quickly. Nothing reaches a platform until the proposal is approved.",
        ],
      },
    ],
    faqs: [
      { q: "Do proposals expire or duplicate?", a: "Tamanor avoids duplicate proposals for the same item and keeps each proposal reviewable in the queue." },
    ],
    related: ["approval-workflow", "action-queue", "automation", "ai-moderation"],
    entityRefs: ["capability-automation", "capability-approval"],
  },
  {
    slug: "roadmap",
    collection: "platform",
    title: "Roadmap",
    metaTitle: "Roadmap — Tamanor honest platform status",
    summary:
      "Facebook Page comment monitoring is verified live. Instagram is implementation-complete but verification-pending (Meta App Review). Google Business is a foundation pending approved API access. YouTube, LinkedIn and TikTok are research — not supported.",
    keywords: ["tamanor roadmap", "platform support", "instagram verification pending", "google business reviews"],
    sections: [
      {
        heading: "What is live, what is pending, what is research",
        body: [
          "Live (verified): Facebook Page read-only comment monitoring, with human-approved hiding off by default.",
          "Implementation complete, verification pending: Instagram Professional comment monitoring (read-only) — awaiting Meta App Review before it is live.",
          "Foundation, verification pending: Google Business review monitoring — ready for approved API access, not yet live.",
          "Research (not supported): YouTube, LinkedIn and TikTok. Tamanor does not claim support until it is real and verified.",
        ],
      },
    ],
    faqs: [
      { q: "Does Tamanor support TikTok, YouTube or LinkedIn today?", a: "Not yet. These are planned; Tamanor states honestly that it does not claim support for them until verified." },
    ],
    related: ["facebook", "instagram", "google-business", "youtube", "linkedin", "tiktok"],
    entityRefs: ["product", "software-application"],
  },

  // ===================== FEATURES =====================
  {
    slug: "comment-monitoring",
    collection: "features",
    title: "Comment & review monitoring",
    metaTitle: "Comment monitoring — Tamanor",
    summary:
      "Tamanor continuously reads comments and reviews on connected accounts, deduplicates them, and classifies each for risk so nothing important is missed.",
    keywords: ["comment monitoring", "review monitoring", "social listening", "brand mentions"],
    sections: [
      {
        heading: "Never miss a risky comment",
        body: [
          "Tamanor reads new comments and reviews on a schedule and via webhooks, normalizes them into one model, and deduplicates by account and external id so the same item is never counted twice.",
        ],
      },
    ],
    faqs: [{ q: "Which platforms are monitored today?", a: "Facebook Pages and connected Instagram Professional accounts, plus Google Business reviews as a foundation." }],
    related: ["ai-risk-detection", "reputation-analytics", "unified-inbox", "how-tamanor-works"],
    entityRefs: ["feature-monitoring", "capability-moderation"],
  },
  {
    slug: "reputation-analytics",
    collection: "features",
    title: "Reputation analytics",
    metaTitle: "Reputation analytics — Tamanor",
    summary:
      "Tamanor turns monitored comments and reviews into reputation analytics — risk levels, categories and trends — so a brand can see its exposure at a glance.",
    keywords: ["reputation analytics", "brand reputation", "sentiment", "risk trends"],
    sections: [
      {
        heading: "See your exposure",
        body: [
          "Classified items roll up into reputation views by risk level and category, helping teams focus on the highest-impact issues first.",
        ],
      },
    ],
    faqs: [{ q: "Is the analysis based on real content?", a: "Yes — analytics are computed from the real comments and reviews Tamanor monitors, not sample data." }],
    related: ["comment-monitoring", "actor-risk", "ai-risk-detection"],
    entityRefs: ["feature-analytics", "capability-ai-recommendations"],
  },
  {
    slug: "actor-risk",
    collection: "features",
    title: "Actor risk",
    metaTitle: "Actor risk — Tamanor repeat-offender detection",
    summary:
      "Tamanor tracks repeated risky behavior from the same author across a brand's content, so persistent bad actors stand out rather than being judged one comment at a time.",
    keywords: ["actor risk", "repeat offender detection", "coordinated abuse", "author reputation"],
    sections: [
      {
        heading: "Judge the pattern, not just one comment",
        body: [
          "By associating risk with authors over time, Tamanor highlights accounts that repeatedly post spam, scams or harassment, giving reviewers context a single comment can't provide.",
        ],
      },
    ],
    faqs: [{ q: "Does Tamanor ban authors automatically?", a: "No. Actor risk informs reviewers; Tamanor does not ban or take automatic action against authors." }],
    related: ["reputation-analytics", "comment-monitoring", "ai-risk-detection"],
    entityRefs: ["feature-actor-risk", "capability-ai-recommendations"],
  },
  {
    slug: "action-queue",
    collection: "features",
    title: "Action queue",
    metaTitle: "Action queue — Tamanor human-approved actions",
    summary:
      "The Tamanor action queue holds proposed moderation actions for human review; nothing runs on a platform until a reviewer approves it.",
    keywords: ["action queue", "moderation queue", "approval queue"],
    sections: [
      {
        heading: "A single place to decide",
        body: [
          "Proposed actions collect in one queue with the context needed to decide. Approving runs the action (today, Facebook comment hiding); rejecting closes it. Every outcome is audited.",
        ],
      },
    ],
    faqs: [{ q: "What actions can be approved today?", a: "Controlled Facebook comment hiding. Other platforms are monitored only." }],
    related: ["approval-workflow", "proposal-engine", "unified-inbox"],
    entityRefs: ["feature-action-queue", "capability-approval"],
  },
  {
    slug: "approval-workflow",
    collection: "features",
    title: "Approval workflow",
    metaTitle: "Approval workflow — Tamanor",
    summary:
      "Tamanor's approval workflow keeps a human in control: proposed actions are approved or rejected by an authorized role before anything touches a platform, with every step audited.",
    keywords: ["approval workflow", "human in the loop", "moderation approval"],
    sections: [
      {
        heading: "Human control, end to end",
        body: [
          "A proposal is created, reviewed by an authorized role, and only then executed. The full lifecycle — proposed, approved or rejected, executed — is written to the audit log.",
        ],
      },
    ],
    faqs: [{ q: "Who can approve?", a: "Only workspace roles permitted to approve; role checks run server-side." }],
    related: ["action-queue", "role-model", "audit-log", "proposal-engine"],
    entityRefs: ["feature-approval", "capability-approval"],
  },
  {
    slug: "auto-protection",
    collection: "features",
    title: "Auto-protection policies",
    metaTitle: "Auto-protection — Tamanor safe defaults",
    summary:
      "Auto-protection policies let a brand define, per category, when Tamanor should prepare a protective action — still routed through human approval, never auto-executed.",
    keywords: ["auto protection", "moderation policy", "safe automation", "brand rules"],
    sections: [
      {
        heading: "Policy in, proposals out",
        body: [
          "You set per-category policies for how aggressively Tamanor should react. Policies influence what gets proposed and prioritized; they do not enable automatic execution.",
        ],
      },
    ],
    faqs: [{ q: "Can a policy hide comments automatically?", a: "No — policies shape proposals; approval stays human." }],
    related: ["automation", "control-center", "proposal-engine", "ai-moderation"],
    entityRefs: ["feature-auto-protection", "capability-automation"],
  },
  {
    slug: "control-center",
    collection: "features",
    title: "Control center",
    metaTitle: "Control center — Tamanor rules and settings",
    summary:
      "The Tamanor control center is where a brand configures rules, categories and protection settings that drive monitoring and proposals.",
    keywords: ["control center", "moderation rules", "brand configuration"],
    sections: [
      {
        heading: "Configure the firewall",
        body: [
          "Brand rules and protection settings live in one place, so teams can tune what counts as risk and how proposals are prepared.",
        ],
      },
    ],
    faqs: [{ q: "Are rules per brand?", a: "Yes — rules and policies are scoped to each brand within a workspace." }],
    related: ["auto-protection", "control-center", "reputation-analytics"],
    entityRefs: ["feature-control-center", "capability-automation"],
  },
  {
    slug: "unified-inbox",
    collection: "features",
    title: "Unified inbox",
    metaTitle: "Unified inbox — Tamanor",
    summary:
      "Tamanor brings comments and reviews from connected accounts into one inbox, so teams triage risk across platforms in a single view.",
    keywords: ["unified inbox", "social inbox", "cross-platform moderation"],
    sections: [
      {
        heading: "One view across accounts",
        body: [
          "Monitored items from every connected account appear in a shared inbox with risk context, so triage isn't scattered across platform tabs.",
        ],
      },
    ],
    faqs: [{ q: "Does the inbox let me reply?", a: "The inbox is for triage and approval; Tamanor does not post replies on your behalf." }],
    related: ["comment-monitoring", "action-queue", "reputation-analytics"],
    entityRefs: ["feature-inbox", "capability-moderation"],
  },
  {
    slug: "ai-risk-detection",
    collection: "features",
    title: "AI risk detection",
    metaTitle: "AI risk detection — Tamanor",
    summary:
      "Tamanor classifies each comment and review with a hybrid of brand rules and AI analysis, producing a risk level, categories and sentiment used for prioritization and proposals.",
    keywords: ["ai risk detection", "content classification", "spam scam detection", "harassment detection"],
    sections: [
      {
        heading: "Rules plus AI",
        body: [
          "Deterministic brand rules catch known patterns; AI analysis handles nuance and language. Together they produce the risk signals that drive what a human sees and what gets proposed.",
        ],
      },
    ],
    faqs: [{ q: "Does AI make the final call?", a: "No — AI informs prioritization and proposals; a human decides." }],
    related: ["ai-moderation", "reputation-analytics", "actor-risk", "proposal-engine"],
    entityRefs: ["capability-ai-recommendations", "feature-analytics"],
  },

  // ===================== INTEGRATIONS =====================
  {
    slug: "facebook",
    collection: "integrations",
    platformKey: "facebook",
    title: "Facebook Page integration",
    metaTitle: "Facebook integration — Tamanor comment protection",
    summary:
      "Tamanor connects Facebook Pages via official OAuth to monitor comments, detect risk, and hide harmful comments after human approval — the only live moderation action today.",
    keywords: ["facebook page moderation", "hide facebook comments", "facebook comment monitoring", "meta oauth"],
    sections: [
      {
        heading: "What Tamanor does with Facebook",
        body: [
          "Tamanor reads Page and post comments, classifies them, and can hide a comment after a human approves it. Hidden-state can be verified. Tamanor never deletes, replies, likes, bans or reports.",
        ],
      },
    ],
    faqs: [
      { q: "Can Tamanor hide Facebook comments?", a: "Yes, after human approval. This is the only live moderation action Tamanor performs today." },
      { q: "Does Tamanor delete or reply on Facebook?", a: "No. Tamanor only hides (after approval) and otherwise monitors." },
    ],
    related: ["instagram", "connect-facebook", "webhook-architecture", "ai-moderation", "roadmap"],
    entityRefs: ["connector-facebook", "platform-facebook", "capability-moderation"],
  },
  {
    slug: "instagram",
    collection: "integrations",
    platformKey: "instagram",
    title: "Instagram integration",
    metaTitle: "Instagram integration — Tamanor (verification pending)",
    summary:
      "Tamanor's Instagram Professional connector is implementation-complete — discovery through the linked Facebook Page, read-only comment ingestion with pagination and webhooks. Real provider verification via Meta App Review is pending, so it is not yet live.",
    keywords: ["instagram business moderation", "instagram comment monitoring", "instagram professional oauth"],
    sections: [
      {
        heading: "What Tamanor does with Instagram",
        body: [
          "The Instagram connector discovers a connected Instagram Professional account through its Facebook Page and reads its comments — media comments and replies, with pagination and near-real-time webhooks. It is read-only: no hide, delete, reply, ban or report.",
          "Status: implementation complete, real provider verification pending. Live use requires Meta App Review; until then Tamanor does not present Instagram as live.",
        ],
      },
    ],
    faqs: [
      { q: "Is Instagram live today?", a: "No. The Instagram connector is implementation-complete but not yet live — real provider verification via Meta App Review is pending." },
      { q: "Can Tamanor hide Instagram comments?", a: "No. Instagram is read-only; no moderation action is enabled." },
      { q: "How is Instagram connected?", a: "Through its linked Facebook Page using official OAuth — the two behave as one unified connector." },
    ],
    related: ["facebook", "connect-instagram", "webhook-architecture", "comment-monitoring", "roadmap"],
    entityRefs: ["connector-instagram", "platform-instagram", "capability-moderation"],
  },
  {
    slug: "google-business",
    collection: "integrations",
    platformKey: "google_business",
    title: "Google Business integration",
    metaTitle: "Google Business integration — Tamanor (verification pending)",
    summary:
      "Tamanor's Google Business Profile connector is a foundation ready for approved API access — it reads reviewer, rating and text. Real provider verification is pending, so review monitoring is not yet live.",
    keywords: ["google business reviews", "review monitoring", "google business profile api"],
    sections: [
      {
        heading: "What Tamanor does with Google Business",
        body: [
          "The Google Business connector reads location reviews (reviewer, star rating, review text) into reputation. It does not reply to reviews automatically.",
          "Status: connector implementation/foundation ready for approved API access; real provider verification pending. Review monitoring is not yet live and is not presented as such.",
        ],
      },
    ],
    faqs: [
      { q: "Is Google Business review monitoring live?", a: "No. The connector is a foundation ready for approved API access; real provider verification is pending." },
      { q: "Does Tamanor reply to Google reviews?", a: "No — review replies are not automated." },
    ],
    related: ["facebook", "instagram", "reputation-analytics", "roadmap"],
    entityRefs: ["connector-google-business", "platform-google-business", "capability-review-sync"],
  },
  {
    slug: "youtube",
    collection: "integrations",
    platformKey: "youtube",
    title: "YouTube integration (planned)",
    metaTitle: "YouTube integration (planned) — Tamanor",
    summary:
      "A YouTube connector is planned. Tamanor does not yet claim YouTube support; comment monitoring will be enabled only once it is built and verified.",
    keywords: ["youtube comment monitoring", "youtube moderation", "planned integration"],
    sections: [
      {
        heading: "Planned, not yet claimed",
        body: [
          "YouTube exposes comment threads via its official API. A connector foundation exists in the codebase, but Tamanor does not advertise YouTube support until read sync is implemented and verified.",
        ],
      },
    ],
    faqs: [{ q: "Can I monitor YouTube today?", a: "Not yet — YouTube is planned and not claimed as supported." }],
    related: ["roadmap", "facebook", "instagram"],
    entityRefs: ["platform-youtube"],
  },
  {
    slug: "linkedin",
    collection: "integrations",
    platformKey: "linkedin",
    title: "LinkedIn integration (planned)",
    metaTitle: "LinkedIn integration (planned) — Tamanor",
    summary:
      "A LinkedIn Company Page connector is planned. LinkedIn's API access for organic comments is partner-gated, so Tamanor advertises no LinkedIn capabilities until access is verified.",
    keywords: ["linkedin company page", "linkedin moderation", "planned integration"],
    sections: [
      {
        heading: "Honest about restricted access",
        body: [
          "LinkedIn heavily restricts organic comment access. Until that access is granted and verified, Tamanor claims no LinkedIn capability.",
        ],
      },
    ],
    faqs: [{ q: "Does Tamanor support LinkedIn?", a: "Not yet — it is planned and access is partner-gated." }],
    related: ["roadmap", "facebook", "instagram"],
    entityRefs: ["platform-linkedin"],
  },
  {
    slug: "tiktok",
    collection: "integrations",
    platformKey: "tiktok",
    title: "TikTok integration (planned)",
    metaTitle: "TikTok integration (planned) — Tamanor",
    summary:
      "A TikTok connector is planned. Comment read/moderation via the official API is app-review-gated, so Tamanor advertises no TikTok capabilities until it is proven.",
    keywords: ["tiktok comment moderation", "tiktok business api", "planned integration"],
    sections: [
      {
        heading: "Planned, gated by review",
        body: [
          "TikTok's official comment API is limited and app-review-gated. Tamanor states honestly that TikTok is planned and not yet supported.",
        ],
      },
    ],
    faqs: [{ q: "Does Tamanor support TikTok?", a: "Not yet — it is planned and app-review-gated." }],
    related: ["roadmap", "facebook", "instagram"],
    entityRefs: ["platform-tiktok"],
  },

  // ===================== DOCS =====================
  {
    slug: "getting-started",
    collection: "docs",
    title: "Getting started",
    metaTitle: "Getting started — Tamanor docs",
    summary:
      "Connect a Facebook Page or Instagram Professional account through official OAuth, let Tamanor monitor comments, and approve proposed actions from the queue.",
    keywords: ["getting started", "tamanor setup", "connect social account"],
    sections: [
      {
        heading: "Three steps",
        body: [
          "1) Connect an account via official OAuth. 2) Tamanor begins monitoring and classifying comments. 3) Review proposed actions in the approval queue and approve or reject.",
        ],
      },
    ],
    faqs: [{ q: "Do I need a password?", a: "No — you connect through official OAuth, never a password." }],
    related: ["connect-facebook", "connect-instagram", "roles-and-permissions"],
    entityRefs: ["documentation", "software-application"],
  },
  {
    slug: "connect-facebook",
    collection: "docs",
    title: "Connect a Facebook Page",
    metaTitle: "Connect Facebook — Tamanor docs",
    summary:
      "Connect a Facebook Page through Meta's official OAuth so Tamanor can monitor comments and, after approval, hide harmful ones.",
    keywords: ["connect facebook", "facebook oauth", "facebook page setup"],
    sections: [
      {
        heading: "Connect via OAuth",
        body: [
          "Start the connection, grant the requested permissions on Meta, and Tamanor stores only the OAuth token (encrypted in production). Tamanor then discovers your Page and begins read-only monitoring.",
        ],
      },
    ],
    faqs: [{ q: "What permissions are needed?", a: "The Page permissions required to read comments and, for hiding, manage engagement — requested through Meta's OAuth." }],
    related: ["facebook", "connect-instagram", "permission-model"],
    entityRefs: ["documentation", "connector-facebook"],
  },
  {
    slug: "connect-instagram",
    collection: "docs",
    title: "Connect an Instagram account",
    metaTitle: "Connect Instagram — Tamanor docs",
    summary:
      "Connect an Instagram Professional account through its linked Facebook Page via official OAuth so Tamanor can monitor its comments (read-only).",
    keywords: ["connect instagram", "instagram professional", "instagram oauth"],
    sections: [
      {
        heading: "Connected through the Facebook Page",
        body: [
          "Tamanor discovers the Instagram Professional account linked to your Facebook Page during OAuth. The Page and Instagram behave as one unified connector, and Instagram monitoring is read-only.",
        ],
      },
    ],
    faqs: [{ q: "Do I connect Instagram separately?", a: "No — it is discovered through its linked Facebook Page." }],
    related: ["instagram", "connect-facebook", "webhook-architecture"],
    entityRefs: ["documentation", "connector-instagram"],
  },
  {
    slug: "roles-and-permissions",
    collection: "docs",
    title: "Roles & permissions",
    metaTitle: "Roles & permissions — Tamanor docs",
    summary:
      "Understand Tamanor's workspace roles and how platform permission plus role permission together decide what actions are available.",
    keywords: ["roles and permissions", "rbac docs", "workspace roles"],
    sections: [
      {
        heading: "Two permission layers",
        body: [
          "Platform permission (what the OAuth grant allows) and workspace role (what your role allows) both must permit an action before it is offered. Approvals are limited to authorized roles.",
        ],
      },
    ],
    faqs: [{ q: "Can I limit who approves actions?", a: "Yes — approval is restricted to roles you grant it to." }],
    related: ["role-model", "permission-model", "approval-workflow"],
    entityRefs: ["documentation", "capability-role-access"],
  },
  {
    slug: "webhooks",
    collection: "docs",
    title: "Webhooks",
    metaTitle: "Webhooks — Tamanor docs",
    summary:
      "Tamanor verifies webhook signatures, deduplicates deliveries, routes Facebook and Instagram events through one connector, and resolves the tenant from the connected account.",
    keywords: ["webhooks docs", "webhook signature", "meta webhooks", "instagram webhooks"],
    sections: [
      {
        heading: "Signed, deduplicated, tenant-safe",
        body: [
          "Every inbound event is signature-verified; only valid events are processed. A dedup key rejects replays. The tenant is always derived from the matched account, never from the payload.",
        ],
      },
    ],
    faqs: [{ q: "Are unsigned webhooks processed?", a: "No — they are stored for audit but never processed." }],
    related: ["webhook-architecture", "worker-architecture", "security"],
    entityRefs: ["documentation", "capability-webhook"],
  },
  {
    slug: "security-overview",
    collection: "docs",
    title: "Security overview",
    metaTitle: "Security overview — Tamanor docs",
    summary:
      "A concise technical overview of Tamanor's security posture: OAuth only, read-only by default, encrypted tokens, row-level tenant isolation, and an append-only audit log.",
    keywords: ["security overview", "security docs", "oauth security", "rls"],
    sections: [
      {
        heading: "The essentials",
        body: [
          "Official OAuth only; no scraping; no passwords. Tokens encrypted at rest and kept out of logs. Row-level security isolates tenants. Every action is audited. Read-only by default with human-approved actions.",
        ],
      },
    ],
    faqs: [{ q: "Where is the full security page?", a: "The public security page summarizes trust and safety; this doc is the technical companion." }],
    related: ["security", "row-level-security", "encryption", "audit-log"],
    entityRefs: ["documentation", "security"],
  },

  // ===================== COMPARE (workflow-model comparisons — no competitors) =====================
  {
    slug: "manual-moderation",
    collection: "compare",
    title: "Tamanor vs. manual moderation",
    metaTitle: "Tamanor vs. manual moderation — approach comparison",
    summary:
      "How a centralized, audited, rule-consistent firewall compares with checking each platform by hand. A workflow comparison — no numeric time-savings are claimed.",
    keywords: ["manual moderation", "social moderation workflow", "centralized inbox", "audit trail"],
    sections: [
      {
        heading: "What changes",
        body: [
          "Manual moderation means opening each platform and reading comments by hand: coverage depends on who is watching and when, rules live in people's heads, and there is no single record of what was decided.",
          "Tamanor centralizes monitored comments and reviews into one place, applies the same brand rules and AI risk detection to every item, and records every action in an append-only audit log — so decisions are consistent and reviewable rather than ad hoc.",
        ],
      },
      {
        heading: "Honest limits",
        body: [
          "Tamanor still keeps a human in the loop: it prepares proposals and a person approves them. It does not claim to eliminate review effort or to guarantee nothing is ever missed — it makes coverage systematic and auditable. No specific percentage of time saved is claimed, because that depends on your volume.",
        ],
      },
    ],
    faqs: [
      { q: "Does Tamanor replace human reviewers?", a: "No. It centralizes and prioritizes the work; a human still approves every action." },
      { q: "Do you claim a specific time saving?", a: "No — any number would depend on your comment volume and team, so we do not publish one." },
    ],
    related: ["separate-social-tools", "unified-brand-inbox", "audit-log", "control-center"],
    entityRefs: ["compare-hub", "capability-audit", "capability-approval"],
  },
  {
    slug: "separate-social-tools",
    collection: "compare",
    title: "Tamanor vs. separate per-platform tools",
    metaTitle: "Tamanor vs. separate social tools — approach comparison",
    summary:
      "How a provider-neutral model with shared risk rules and one audit compares with stitching together separate per-platform interfaces. A workflow comparison.",
    keywords: ["separate social tools", "provider neutral", "unified moderation", "cross-platform"],
    sections: [
      {
        heading: "What changes",
        body: [
          "Using a different interface per platform fragments rules, risk scoring and history across tools. Each tool sees only its own platform, and what an action means differs from one to the next.",
          "Tamanor normalizes comments and reviews into one provider-neutral model, applies shared risk and sentiment rules, and keeps one audit — while still respecting each provider's real capabilities (an action a platform cannot perform is never offered).",
        ],
      },
    ],
    faqs: [
      { q: "Does one model mean every platform behaves the same?", a: "No — Tamanor honors each provider's real capability limits; the model is unified, the capabilities are honest per platform." },
    ],
    related: ["manual-moderation", "unified-brand-inbox", "unified-inbox", "permission-model"],
    entityRefs: ["compare-hub", "capability-multi-tenant"],
  },
  {
    slug: "autonomous-ai-moderation",
    collection: "compare",
    title: "Tamanor vs. autonomous AI moderation",
    metaTitle: "Human-in-the-loop vs. autonomous AI moderation",
    summary:
      "Tamanor is human-in-the-loop, not autonomous: AI detects and proposes, rules and capability gates apply, and a human approves before any action. Execution is fail-closed.",
    keywords: ["autonomous ai moderation", "human in the loop", "approval workflow", "fail closed"],
    sections: [
      {
        heading: "The real difference",
        body: [
          "A fully autonomous system decides and acts on its own. Tamanor deliberately does not: automatic execution is off. AI produces a risk assessment and a proposed action; brand rules, the approval workflow, platform-capability checks and connector-health gates all apply; and a human approves before anything touches a platform.",
          "Execution is fail-closed — if a capability or permission is missing at execute time, the action fails safely and is audited rather than forced through. Tamanor is not, and is not presented as, a fully autonomous moderator.",
        ],
      },
    ],
    faqs: [
      { q: "Can I enable fully automatic hiding?", a: "No. Automatic execution is intentionally not available; proposals are prepared for human approval." },
      { q: "Is Tamanor an autonomous AI agent?", a: "No. It is human-in-the-loop by design; autoExecution is off." },
    ],
    related: ["automation", "proposal-engine", "approval-workflow", "responsible-ai"],
    entityRefs: ["compare-hub", "capability-approval", "capability-automation"],
  },
  {
    slug: "unified-brand-inbox",
    collection: "compare",
    title: "Tamanor vs. separate Facebook/Instagram/Google interfaces",
    metaTitle: "Unified brand inbox vs. separate provider interfaces",
    summary:
      "How one normalized inbox for comments and reviews compares with separate provider interfaces — with honest per-provider capability limits and truthful connector states.",
    keywords: ["unified brand inbox", "social inbox", "comments vs reviews", "connector status"],
    sections: [
      {
        heading: "What changes",
        body: [
          "Separate provider interfaces mean switching context between Facebook, Instagram and Google, each with its own view of comments or reviews. Tamanor brings monitored items into one normalized inbox with shared risk context, distinguishing comments from reviews.",
          "Availability is honest: each provider shows its real connector state, and only Facebook is live-verified today. Instagram and Google Business appear with their true status (verification pending), never as live.",
        ],
      },
    ],
    faqs: [
      { q: "Are all providers live in the inbox?", a: "No. Facebook is live-verified; Instagram and Google Business are shown with their true verification-pending status." },
    ],
    related: ["separate-social-tools", "unified-inbox", "facebook", "instagram", "google-business"],
    entityRefs: ["compare-hub", "feature-inbox"],
  },
  {
    slug: "reputation-management-platform-checklist",
    collection: "compare",
    title: "Reputation management platform checklist",
    metaTitle: "Reputation platform checklist — neutral evaluation",
    summary:
      "A neutral buyer's checklist for evaluating any reputation/moderation platform, with Tamanor's honest status per item — including what is not yet done.",
    keywords: ["reputation management checklist", "evaluation criteria", "buyer checklist", "moderation platform"],
    sections: [
      {
        heading: "How to use this",
        body: [
          "These are provider-neutral criteria to evaluate any platform. Each line states Tamanor's honest status; where something is not yet done, it says so rather than implying completeness.",
        ],
      },
      {
        heading: "Security & data",
        body: [
          "Tenant isolation — yes: PostgreSQL row-level security isolates every tenant at the database layer.",
          "Audit — yes: append-only, tenant-scoped audit log without secrets.",
          "Token encryption — yes: OAuth tokens encrypted at rest in production; plaintext storage blocked in production.",
          "Permission gates — yes: platform capability and workspace role must both permit an action.",
          "Data ownership — yes: a customer's data is isolated per tenant and not shared or sold.",
          "Key rotation — not yet: token-encryption key rotation remains a roadmap gap.",
          "Export / retention controls — not yet: self-service export and retention policies are not implemented.",
        ],
      },
      {
        heading: "Workflow & operations",
        body: [
          "Approval workflow — yes: human approval before any action; fail-closed execution.",
          "Provider health — yes: honest connector health/permission states, no fake green.",
          "Disconnect lifecycle — yes: disconnecting removes local tokens; provider revoke is best-effort.",
          "Workflow persistence — yes: proposals, approvals and outcomes persist and are auditable.",
          "Pagination / scalability — yes: read syncs paginate with cursors and are idempotent.",
          "Provider verification — partial: Facebook is live-verified; Instagram and Google Business are verification-pending; YouTube/LinkedIn/TikTok are research.",
        ],
      },
    ],
    faqs: [
      { q: "Does Tamanor meet every item?", a: "No — key rotation and export/retention are explicitly not done yet, and several providers are verification-pending. The checklist states each honestly." },
    ],
    related: ["security", "provider-tokens", "disclosure", "roadmap"],
    entityRefs: ["compare-hub", "security", "capability-audit", "capability-rls"],
  },

  // ===================== SECURITY (dedicated security route tree) =====================
  {
    slug: "tenant-isolation",
    collection: "security",
    title: "Tenant isolation",
    metaTitle: "Tenant isolation — Tamanor security",
    summary:
      "Tamanor scopes every session and query to one active tenant, layering application permission checks over database row-level security, with system and runtime database access kept separate.",
    keywords: ["tenant isolation", "multi-tenant security", "active tenant", "runtime rls"],
    sections: [
      {
        heading: "One active tenant, enforced twice",
        body: [
          "Sessions are tenant-scoped: a request carries exactly one active tenant. Application permission checks decide what a member may do, and PostgreSQL row-level security enforces which rows exist for that tenant at the database layer.",
          "Cross-tenant system work (worker discovery, cleanup) uses a separate, narrow access path that is never used on a normal tenant request. The runtime tenant client and the system client are distinct by design.",
        ],
      },
    ],
    faqs: [{ q: "Can one customer see another's data?", a: "No. Isolation is enforced by row-level security at the database layer, not only by application code." }],
    related: ["row-level-security", "authentication", "data-integrity"],
    entityRefs: ["security-hub", "capability-rls", "capability-multi-tenant"],
  },
  {
    slug: "row-level-security",
    collection: "security",
    title: "Row-level security",
    metaTitle: "Row-level security — Tamanor security posture",
    summary:
      "Tamanor runs tenant queries through a non-superuser role with FORCE row-level security and a transaction-local tenant context — defense in depth beneath application checks.",
    keywords: ["row level security", "force rls", "non-superuser role", "defense in depth"],
    sections: [
      {
        heading: "Database-enforced, transaction-local",
        body: [
          "The runtime database role is a non-superuser without the ability to bypass row-level security. FORCE ROW LEVEL SECURITY is on, and the active tenant is set per transaction, so isolation travels with each unit of work.",
          "This is defense in depth: even if an application query omitted a tenant filter, the database still returns only the active tenant's rows.",
        ],
      },
    ],
    faqs: [{ q: "What if application code forgets a tenant filter?", a: "Row-level security still restricts results to the active tenant; isolation does not depend on remembering to filter." }],
    related: ["tenant-isolation", "data-integrity", "audit-logging"],
    entityRefs: ["security-hub", "capability-rls"],
  },
  {
    slug: "authentication",
    collection: "security",
    title: "Authentication & sessions",
    metaTitle: "Authentication — Tamanor sessions",
    summary:
      "Tamanor uses opaque sessions with the token hashed in the database, supporting revocation, expiration and logout invalidation.",
    keywords: ["authentication", "opaque session", "session revocation", "logout"],
    sections: [
      {
        heading: "Opaque, revocable sessions",
        body: [
          "A session is an opaque token; the database stores only its hash, never the raw token. Sessions expire, can be revoked, and are invalidated on logout. Server-side checks enforce authentication on every protected route and action.",
        ],
      },
    ],
    faqs: [{ q: "Is the raw session token stored?", a: "No — only a hash is stored, so the database never holds the usable token." }],
    related: ["tenant-isolation", "provider-tokens", "audit-logging"],
    entityRefs: ["security-hub", "capability-role-access"],
  },
  {
    slug: "provider-tokens",
    collection: "security",
    title: "Provider tokens",
    metaTitle: "Provider tokens — Tamanor token security",
    summary:
      "OAuth provider tokens are encrypted at rest, removed locally on disconnect, and revoked at the provider on a best-effort basis; key rotation is a remaining roadmap gap.",
    keywords: ["provider tokens", "oauth token security", "encryption at rest", "token revocation"],
    sections: [
      {
        heading: "How tokens are handled",
        body: [
          "OAuth tokens are encrypted at rest in production and never shown, logged or placed in the audit trail. Disconnecting an account removes the stored token locally; revoking at the provider is attempted on a best-effort basis.",
          "Honest gap: automated key rotation for token encryption is not yet implemented and remains on the roadmap.",
        ],
      },
    ],
    faqs: [{ q: "Is key rotation implemented?", a: "Not yet — encryption at rest is in place, but automated key rotation is a remaining roadmap gap." }],
    related: ["authentication", "row-level-security", "disclosure"],
    entityRefs: ["security-hub", "security"],
  },
  {
    slug: "audit-logging",
    collection: "security",
    title: "Audit logging",
    metaTitle: "Audit logging — Tamanor security",
    summary:
      "Tamanor writes an append-only, tenant-scoped audit log; actor references use a SetNull lifecycle so history survives user removal, and tokens are never logged.",
    keywords: ["audit logging", "append-only", "actor lifecycle", "no token logging"],
    sections: [
      {
        heading: "Append-only, secret-free",
        body: [
          "Meaningful actions are recorded append-only and scoped to the tenant. Actor references use a SetNull lifecycle so removing a user does not erase the historical record. No token, password or connection string ever appears in an audit entry.",
        ],
      },
    ],
    faqs: [{ q: "Do audit entries ever contain tokens?", a: "No — secrets are scrubbed; the audit log never contains token material." }],
    related: ["row-level-security", "data-integrity", "webhook-security"],
    entityRefs: ["security-hub", "capability-audit"],
  },
  {
    slug: "data-integrity",
    collection: "security",
    title: "Data integrity",
    metaTitle: "Data integrity — Tamanor security",
    summary:
      "Tamanor persists content and reputation atomically, ingests idempotently, uses account-level leases, and enforces referential integrity to prevent orphaned records.",
    keywords: ["data integrity", "atomic write", "idempotent ingest", "referential integrity"],
    sections: [
      {
        heading: "Consistent by construction",
        body: [
          "Each piece of content and its reputation record are written in one atomic transaction. Ingestion is idempotent, so the same item is never duplicated. An account-level lease prevents overlapping syncs, and referential integrity prevents orphaned records.",
        ],
      },
    ],
    faqs: [{ q: "Can a sync create duplicates?", a: "No — ingestion is idempotent on a unique key, so re-processing an item deduplicates it." }],
    related: ["row-level-security", "audit-logging", "webhook-security"],
    entityRefs: ["security-hub", "capability-rls"],
  },
  {
    slug: "webhook-security",
    collection: "security",
    title: "Webhook security",
    metaTitle: "Webhook security — Tamanor",
    summary:
      "Tamanor verifies webhook signatures, deduplicates replays, derives the tenant from the connected account (never the payload), and stores invalid webhooks only for audit — never processing them.",
    keywords: ["webhook security", "signature verification", "replay protection", "tenant derivation"],
    sections: [
      {
        heading: "Trusted by construction",
        body: [
          "Inbound webhooks are signature-verified; only valid events are processed. A stable dedup key rejects replays. The tenant is derived from the matched connected account, never from the payload, so a crafted body cannot cross tenants. Invalid or unsigned events are stored for audit but never processed.",
        ],
      },
    ],
    faqs: [{ q: "Are unsigned webhooks acted on?", a: "No — they are stored for audit only and never processed." }],
    related: ["webhook-architecture", "audit-logging", "data-integrity"],
    entityRefs: ["security-hub", "capability-webhook"],
  },
  {
    slug: "responsible-ai",
    collection: "security",
    title: "Responsible AI",
    metaTitle: "Responsible AI — Tamanor",
    summary:
      "Tamanor's AI is human-in-the-loop: it detects and proposes under brand rules and provider capability gates, with an approval step and fail-closed execution — never unbounded autonomy.",
    keywords: ["responsible ai", "human in the loop", "ai governance", "capability gates"],
    sections: [
      {
        heading: "AI proposes, humans decide",
        body: [
          "AI produces risk assessments and proposals only. Brand rules, the approval workflow and provider capability gates all apply, and execution is fail-closed. Automatic execution is off; Tamanor is not an unbounded autonomous agent.",
        ],
      },
    ],
    faqs: [{ q: "Does the AI act on its own?", a: "No — it proposes; a human approves, and execution is capability-gated and fail-closed." }],
    related: ["autonomous-ai-moderation", "ai-moderation", "approval-workflow"],
    entityRefs: ["security-hub", "capability-ai-recommendations", "capability-approval"],
  },
  {
    slug: "disclosure",
    collection: "security",
    title: "Security disclosure",
    metaTitle: "Security disclosure — Tamanor",
    summary:
      "How to report a security concern to Tamanor. Reports reach the team through the contact channel; a dedicated security address is configurable before production.",
    keywords: ["security disclosure", "responsible disclosure", "report vulnerability", "security contact"],
    sections: [
      {
        heading: "Reporting a concern",
        body: [
          "If you believe you have found a security issue, please reach the team through the contact page. We ask reporters to avoid accessing or modifying other users' data and to give us a reasonable chance to respond before public disclosure.",
          "A dedicated security mailbox is configurable before production; until it is announced, the contact channel is the authoritative route. Tamanor does not publish a placeholder address that is not monitored.",
        ],
      },
    ],
    faqs: [
      { q: "Where do I report a vulnerability?", a: "Use the contact page. A dedicated security address is configurable before production and will be announced when live." },
    ],
    related: ["provider-tokens", "responsible-ai", "audit-logging"],
    entityRefs: ["security-hub", "security"],
  },
];

/** All knowledge entries. */
export const KNOWLEDGE: readonly KnowledgeEntry[] = K;

const BY_SLUG = new Map(K.map((e) => [`${e.collection}/${e.slug}`, e]));
const BY_SLUG_ANY = new Map<string, KnowledgeEntry>();
for (const e of K) if (!BY_SLUG_ANY.has(e.slug)) BY_SLUG_ANY.set(e.slug, e);

/** Entries in one collection. */
export function entriesIn(collection: KnowledgeCollection): KnowledgeEntry[] {
  return K.filter((e) => e.collection === collection);
}

/** Resolve an entry by collection + slug. */
export function getEntry(collection: KnowledgeCollection, slug: string): KnowledgeEntry | undefined {
  return BY_SLUG.get(`${collection}/${slug}`);
}

/** Resolve a related slug (collection-agnostic) to its canonical path. */
export function pathForSlug(slug: string): string | undefined {
  const e = BY_SLUG_ANY.get(slug);
  return e ? `${collectionBasePath(e.collection)}/${e.slug}` : undefined;
}

/** Canonical path for an entry. */
export function pathForEntry(e: KnowledgeEntry): string {
  return `${collectionBasePath(e.collection)}/${e.slug}`;
}
