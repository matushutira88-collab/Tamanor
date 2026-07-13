/**
 * V1.38.2 — Tamanor entity graph + capability signals.
 *
 * This is the machine-readable knowledge graph that AI search engines and LLMs
 * consume (via ai-index.json, entity-map.json, *-map.json and JSON-LD). Every
 * entity and every capability signal is DERIVED from the real product:
 *   - platform + connector facts from `@guardora/core` capability constants,
 *   - features / docs / integrations from the truthful knowledge base.
 * Nothing here is hand-asserted marketing; signals cannot drift from the code.
 */
import {
  FACEBOOK_CAPABILITIES,
  INSTAGRAM_CAPABILITIES,
  GOOGLE_BUSINESS_CAPABILITIES,
  LINKEDIN_CAPABILITIES,
  TIKTOK_CAPABILITIES,
} from "@guardora/core";
import { SITE_URL, SITE_NAME, CONTENT_REVISION, abs } from "./site";
import { KNOWLEDGE, pathForEntry, type KnowledgeEntry } from "../content/knowledge";

export type EntityType =
  | "Organization"
  | "SoftwareApplication"
  | "Product"
  | "Brand"
  | "Feature"
  | "Connector"
  | "Platform"
  | "Capability"
  | "UseCase"
  | "Integration"
  | "Documentation"
  | "Pricing"
  | "Security"
  | "Compliance"
  | "Resource";

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  slug: string;
  /** Site-relative path (or "" for the abstract org/product). */
  path: string;
  url: string;
  canonical: string;
  description: string;
  relations: string[];
  aliases: string[];
  keywords: string[];
  supportedLanguages: string[];
  lastUpdated: string;
}

const APP_LANGS = ["en", "sk", "de"];
const CONTENT_LANGS = ["en"];

function entity(e: Omit<Entity, "url" | "canonical" | "lastUpdated"> & { lastUpdated?: string }): Entity {
  const url = e.path ? abs(e.path) : SITE_URL;
  return { ...e, url, canonical: url, lastUpdated: e.lastUpdated ?? CONTENT_REVISION };
}

// --------------------------------------------------------------------------
// Capability signals — the truthful AI signal layer. Each boolean is derived
// from the real capability constants (or an explicit product fact), so a signal
// is only `true` when the product genuinely supports it.
// --------------------------------------------------------------------------
export interface CapabilitySignal {
  key: string;
  label: string;
  supported: boolean;
  /** Where the truth comes from (grep-auditable). */
  source: string;
}

export const CAPABILITY_SIGNALS: readonly CapabilitySignal[] = [
  { key: "supportsFacebookPages", label: "Facebook Page comment monitoring", supported: FACEBOOK_CAPABILITIES.canReadComments, source: "core/FACEBOOK_CAPABILITIES.canReadComments" },
  { key: "supportsFacebookHide", label: "Facebook comment hiding (human-approved)", supported: FACEBOOK_CAPABILITIES.canHideComment, source: "core/FACEBOOK_CAPABILITIES.canHideComment" },
  { key: "supportsInstagramBusiness", label: "Instagram Professional comment monitoring", supported: INSTAGRAM_CAPABILITIES.canReadComments, source: "core/INSTAGRAM_CAPABILITIES.canReadComments" },
  { key: "supportsGoogleBusiness", label: "Google Business review monitoring", supported: GOOGLE_BUSINESS_CAPABILITIES.canReviewSync, source: "core/GOOGLE_BUSINESS_CAPABILITIES.canReviewSync" },
  { key: "supportsYouTube", label: "YouTube comment monitoring", supported: false, source: "planned — connector placeholder, no real sync; not claimed" },
  { key: "supportsLinkedIn", label: "LinkedIn comment monitoring", supported: LINKEDIN_CAPABILITIES.canReadComments, source: "core/LINKEDIN_CAPABILITIES (none)" },
  { key: "supportsTikTok", label: "TikTok comment monitoring", supported: TIKTOK_CAPABILITIES.canReadComments, source: "core/TIKTOK_CAPABILITIES (none)" },
  { key: "supportsModeration", label: "Human-approved moderation actions", supported: FACEBOOK_CAPABILITIES.canHideComment, source: "core/FACEBOOK_CAPABILITIES.canHideComment" },
  { key: "supportsAutoExecution", label: "Fully automatic moderation (no human)", supported: false, source: "product fact — proposals only, never auto-execute" },
  { key: "supportsApprovalWorkflow", label: "Human approval workflow", supported: true, source: "product fact — approval queue" },
  { key: "supportsWebhook", label: "Signed, deduplicated webhooks", supported: true, source: "product fact — webhook architecture" },
  { key: "supportsAutomation", label: "Automated monitoring & proposals", supported: true, source: "product fact — worker + proposal engine" },
  { key: "supportsAudit", label: "Append-only audit log", supported: true, source: "product fact — audit log" },
  { key: "supportsMultiTenant", label: "Multi-tenant workspaces", supported: true, source: "product fact — multi-tenant" },
  { key: "supportsRLS", label: "PostgreSQL row-level security isolation", supported: true, source: "product fact — RLS runtime" },
  { key: "supportsRoleBasedAccess", label: "Role-based access control", supported: true, source: "product fact — workspace roles" },
  { key: "supportsAIRecommendations", label: "AI risk detection & prioritization", supported: true, source: "product fact — hybrid classifier" },
  { key: "supportsEncryptionAtRest", label: "Token encryption at rest (production)", supported: true, source: "product fact — token crypto" },
];

/** Only the truthful, supported signals (for compact advertising). */
export function supportedSignals(): CapabilitySignal[] {
  return CAPABILITY_SIGNALS.filter((s) => s.supported);
}

// --------------------------------------------------------------------------
// Core entities (abstract — no page of their own, or map to /security etc.)
// --------------------------------------------------------------------------
const CORE_ENTITIES: Entity[] = [
  entity({
    id: "organization", type: "Organization", name: SITE_NAME, slug: "organization", path: "",
    description: "Tamanor is the organization behind the Tamanor Social Account Firewall.",
    relations: ["software-application", "product", "brand"],
    aliases: ["Tamanor", "Tamanor.com"], keywords: ["tamanor", "social account firewall", "reputation protection"],
    supportedLanguages: APP_LANGS,
  }),
  entity({
    id: "software-application", type: "SoftwareApplication", name: "Tamanor", slug: "software-application", path: "",
    description: "A web application that monitors social comments and reviews, detects risk with AI, and prepares human-approved moderation actions.",
    relations: ["organization", "product", "security", "connector-facebook", "connector-instagram", "capability-moderation"],
    aliases: ["Tamanor app", "Tamanor firewall"],
    keywords: ["comment moderation software", "reputation management", "brand safety", "ai moderation"],
    supportedLanguages: APP_LANGS,
  }),
  entity({
    id: "product", type: "Product", name: "Tamanor Social Account Firewall", slug: "product", path: "/platform/what-is-tamanor",
    description: "The Tamanor product: a firewall for social accounts — monitor, detect, propose, approve.",
    relations: ["software-application", "brand", "pricing"],
    aliases: ["Social Account Firewall"], keywords: ["social account firewall", "comment firewall"],
    supportedLanguages: APP_LANGS,
  }),
  entity({
    id: "brand", type: "Brand", name: "Tamanor", slug: "brand", path: "",
    description: "Tamanor — Social Account Firewall.",
    relations: ["organization", "product"], aliases: ["Tamanor"], keywords: ["tamanor brand"],
    supportedLanguages: APP_LANGS,
  }),
  entity({
    id: "security", type: "Security", name: "Tamanor Security", slug: "security", path: "/security",
    description: "OAuth-only connections, read-only by default, encrypted tokens, RLS tenant isolation, append-only audit.",
    relations: ["capability-rls", "capability-audit", "compliance", "software-application"],
    aliases: ["Tamanor trust & safety"], keywords: ["security", "oauth only", "no scraping"],
    supportedLanguages: APP_LANGS,
  }),
  entity({
    id: "compliance", type: "Compliance", name: "Tamanor Data Protection", slug: "compliance", path: "/platform/data-protection",
    description: "Data minimization, tenant isolation, secret scrubbing and automatic cleanup of short-lived onboarding data.",
    relations: ["security", "capability-rls"], aliases: ["data protection"], keywords: ["data protection", "privacy", "gdpr readiness"],
    supportedLanguages: CONTENT_LANGS,
  }),
  entity({
    id: "pricing", type: "Pricing", name: "Tamanor Pricing", slug: "pricing", path: "/#pricing",
    description: "Tamanor is in beta. Pricing is being finalized and there is no checkout or billing yet; a free start is available.",
    relations: ["product"], aliases: ["plans"], keywords: ["pricing", "beta pricing", "free trial"],
    supportedLanguages: APP_LANGS,
  }),
  entity({
    id: "documentation", type: "Documentation", name: "Tamanor Documentation", slug: "documentation", path: "/docs",
    description: "Guides for connecting accounts, roles and permissions, webhooks and security.",
    relations: ["software-application", "security"], aliases: ["docs"], keywords: ["documentation", "docs", "setup"],
    supportedLanguages: CONTENT_LANGS,
  }),
];

// Platform + connector entities from the real capability model.
const PLATFORM_ENTITIES: Entity[] = [
  entity({ id: "platform-facebook", type: "Platform", name: "Facebook Page", slug: "platform-facebook", path: "/integrations/facebook", description: "Facebook Pages — comment monitoring and human-approved comment hiding.", relations: ["connector-facebook", "capability-moderation"], aliases: ["Facebook", "Meta Facebook"], keywords: ["facebook page", "facebook comments"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "platform-instagram", type: "Platform", name: "Instagram Business", slug: "platform-instagram", path: "/integrations/instagram", description: "Instagram Professional accounts — read-only comment monitoring via the linked Facebook Page.", relations: ["connector-instagram"], aliases: ["Instagram", "Instagram Professional"], keywords: ["instagram business", "instagram comments"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "platform-google-business", type: "Platform", name: "Google Business Profile", slug: "platform-google-business", path: "/integrations/google-business", description: "Google Business Profile — review monitoring foundation.", relations: ["connector-google-business", "capability-review-sync"], aliases: ["Google Business", "Google reviews"], keywords: ["google business reviews"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "platform-youtube", type: "Platform", name: "YouTube", slug: "platform-youtube", path: "/integrations/youtube", description: "YouTube — planned comment monitoring (not yet claimed as supported).", relations: [], aliases: ["YouTube"], keywords: ["youtube comments"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "platform-linkedin", type: "Platform", name: "LinkedIn Company Page", slug: "platform-linkedin", path: "/integrations/linkedin", description: "LinkedIn — planned; organic comment access is partner-gated.", relations: [], aliases: ["LinkedIn"], keywords: ["linkedin company page"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "platform-tiktok", type: "Platform", name: "TikTok", slug: "platform-tiktok", path: "/integrations/tiktok", description: "TikTok — planned; comment API is app-review-gated.", relations: [], aliases: ["TikTok"], keywords: ["tiktok comments"], supportedLanguages: CONTENT_LANGS }),

  entity({ id: "connector-facebook", type: "Connector", name: "Facebook connector", slug: "connector-facebook", path: "/integrations/facebook", description: "Official-OAuth Facebook Page connector: read comments, hide after approval, verify hidden state.", relations: ["platform-facebook", "capability-moderation", "capability-webhook"], aliases: ["Facebook integration"], keywords: ["facebook connector", "facebook oauth"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "connector-instagram", type: "Connector", name: "Instagram connector", slug: "connector-instagram", path: "/integrations/instagram", description: "Official-OAuth Instagram connector (unified with the Facebook Page): read-only comment ingestion.", relations: ["platform-instagram", "connector-facebook", "capability-webhook"], aliases: ["Instagram integration"], keywords: ["instagram connector"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "connector-google-business", type: "Connector", name: "Google Business connector", slug: "connector-google-business", path: "/integrations/google-business", description: "Official-API Google Business connector foundation: read reviews.", relations: ["platform-google-business", "capability-review-sync"], aliases: ["Google Business integration"], keywords: ["google business connector"], supportedLanguages: CONTENT_LANGS }),
];

// Capability entities (from the truthful signal list, only supported ones get an entity).
const CAPABILITY_ENTITIES: Entity[] = [
  entity({ id: "capability-moderation", type: "Capability", name: "Human-approved moderation", slug: "capability-moderation", path: "/platform/ai-moderation", description: "Detect risk and hide harmful Facebook comments after human approval.", relations: ["capability-approval", "connector-facebook"], aliases: ["moderation"], keywords: ["comment moderation", "hide comments"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "capability-approval", type: "Capability", name: "Approval workflow", slug: "capability-approval", path: "/features/approval-workflow", description: "Every action is approved by an authorized role before it runs.", relations: ["capability-role-access", "capability-audit"], aliases: ["human approval"], keywords: ["approval workflow"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "capability-webhook", type: "Capability", name: "Signed webhooks", slug: "capability-webhook", path: "/platform/webhook-architecture", description: "Signature-verified, deduplicated, replay-protected webhook processing.", relations: ["capability-multi-tenant"], aliases: ["webhooks"], keywords: ["webhook signature", "replay protection"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "capability-audit", type: "Capability", name: "Audit log", slug: "capability-audit", path: "/platform/audit-log", description: "Append-only, tenant-scoped audit trail with no secrets.", relations: ["security"], aliases: ["audit trail"], keywords: ["audit log"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "capability-multi-tenant", type: "Capability", name: "Multi-tenant", slug: "capability-multi-tenant", path: "/platform/architecture", description: "Isolated workspaces for many brands and agencies.", relations: ["capability-rls"], aliases: ["multi tenant"], keywords: ["multi-tenant saas"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "capability-rls", type: "Capability", name: "Row-level security", slug: "capability-rls", path: "/platform/row-level-security", description: "Database-enforced tenant isolation via PostgreSQL RLS.", relations: ["security", "capability-multi-tenant"], aliases: ["rls"], keywords: ["row level security", "postgres rls"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "capability-role-access", type: "Capability", name: "Role-based access", slug: "capability-role-access", path: "/platform/role-model", description: "Workspace roles decide who can connect, approve or only view.", relations: ["capability-approval"], aliases: ["rbac"], keywords: ["role based access control"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "capability-automation", type: "Capability", name: "Safe automation", slug: "capability-automation", path: "/platform/automation", description: "Automated monitoring and proposal preparation, without automatic execution.", relations: ["capability-approval", "capability-ai-recommendations"], aliases: ["automation"], keywords: ["safe automation"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "capability-ai-recommendations", type: "Capability", name: "AI risk detection", slug: "capability-ai-recommendations", path: "/features/ai-risk-detection", description: "Hybrid brand-rule + AI classification of comments and reviews.", relations: ["capability-moderation"], aliases: ["ai recommendations"], keywords: ["ai risk detection"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "capability-review-sync", type: "Capability", name: "Review monitoring", slug: "capability-review-sync", path: "/integrations/google-business", description: "Read Google Business reviews into reputation.", relations: ["connector-google-business"], aliases: ["review sync"], keywords: ["review monitoring"], supportedLanguages: CONTENT_LANGS }),
];

// Feature entities (the abstract capability-as-feature nodes the knowledge pages reference).
const FEATURE_ENTITIES: Entity[] = [
  entity({ id: "feature-monitoring", type: "Feature", name: "Comment & review monitoring", slug: "feature-monitoring", path: "/features/comment-monitoring", description: "Continuous, deduplicated reading and classification of comments and reviews.", relations: ["capability-moderation", "capability-ai-recommendations"], aliases: ["monitoring"], keywords: ["comment monitoring"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "feature-analytics", type: "Feature", name: "Reputation analytics", slug: "feature-analytics", path: "/features/reputation-analytics", description: "Risk levels, categories and trends from monitored content.", relations: ["capability-ai-recommendations"], aliases: ["analytics"], keywords: ["reputation analytics"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "feature-actor-risk", type: "Feature", name: "Actor risk", slug: "feature-actor-risk", path: "/features/actor-risk", description: "Repeat-offender detection across a brand's content.", relations: ["capability-ai-recommendations"], aliases: ["actor risk"], keywords: ["actor risk"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "feature-action-queue", type: "Feature", name: "Action queue", slug: "feature-action-queue", path: "/features/action-queue", description: "Proposed actions awaiting human approval.", relations: ["capability-approval"], aliases: ["action queue"], keywords: ["action queue"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "feature-approval", type: "Feature", name: "Approval workflow", slug: "feature-approval", path: "/features/approval-workflow", description: "Human approval before any moderation action runs.", relations: ["capability-approval"], aliases: ["approval workflow"], keywords: ["approval workflow"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "feature-auto-protection", type: "Feature", name: "Auto-protection policies", slug: "feature-auto-protection", path: "/features/auto-protection", description: "Per-category policies that shape proposals (never auto-execute).", relations: ["capability-automation", "capability-approval"], aliases: ["auto protection"], keywords: ["auto protection"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "feature-control-center", type: "Feature", name: "Control center", slug: "feature-control-center", path: "/features/control-center", description: "Where brand rules and protection settings are configured.", relations: ["capability-automation"], aliases: ["control center"], keywords: ["control center"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "feature-inbox", type: "Feature", name: "Unified inbox", slug: "feature-inbox", path: "/features/unified-inbox", description: "One triage view across connected accounts.", relations: ["capability-moderation"], aliases: ["unified inbox"], keywords: ["unified inbox"], supportedLanguages: CONTENT_LANGS }),
];

// Compare + Security hub entities (the section roots the child pages reference).
const HUB_ENTITIES: Entity[] = [
  entity({ id: "compare-hub", type: "UseCase", name: "Compare Tamanor", slug: "compare-hub", path: "/compare", description: "Truthful approach comparisons — manual moderation, separate tools, autonomous AI, unified inbox and a neutral evaluation checklist. No competitor claims.", relations: ["product", "software-application"], aliases: ["comparisons"], keywords: ["compare tamanor", "moderation approach comparison"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "security-hub", type: "Security", name: "Tamanor Security Center", slug: "security-hub", path: "/security", description: "The security route tree: tenant isolation, RLS, authentication, provider tokens, audit logging, data integrity, webhook security, responsible AI and disclosure.", relations: ["security", "capability-rls", "capability-audit", "compliance"], aliases: ["security center"], keywords: ["security", "tenant isolation", "responsible ai"], supportedLanguages: CONTENT_LANGS }),
];

// Feature / UseCase / Integration / Documentation / Security / Resource entities from the knowledge base.
function knowledgeEntity(e: KnowledgeEntry): Entity {
  const type: EntityType =
    e.collection === "features" ? "Feature"
    : e.collection === "integrations" ? "Integration"
    : e.collection === "docs" ? "Documentation"
    : e.collection === "security" ? "Security"
    : "UseCase";
  return entity({
    id: `k-${e.collection}-${e.slug}`,
    type,
    name: e.title,
    slug: e.slug,
    path: pathForEntry(e),
    description: e.summary,
    relations: e.entityRefs,
    aliases: [],
    keywords: e.keywords,
    supportedLanguages: CONTENT_LANGS,
  });
}

const KNOWLEDGE_ENTITIES: Entity[] = KNOWLEDGE.map(knowledgeEntity);

const RESOURCE_ENTITIES: Entity[] = [
  entity({ id: "resource-llms", type: "Resource", name: "llms.txt", slug: "resource-llms", path: "/llms.txt", description: "Machine-readable summary of Tamanor for LLMs.", relations: ["software-application"], aliases: ["llms.txt"], keywords: ["llms.txt", "ai discoverability"], supportedLanguages: CONTENT_LANGS }),
  entity({ id: "resource-ai-index", type: "Resource", name: "ai-index.json", slug: "resource-ai-index", path: "/ai-index.json", description: "Structured AI index of entities, capabilities and pages.", relations: ["software-application"], aliases: ["ai-index"], keywords: ["ai index", "structured data"], supportedLanguages: CONTENT_LANGS }),
];

/** The full entity graph. */
export const ENTITIES: readonly Entity[] = [
  ...CORE_ENTITIES,
  ...PLATFORM_ENTITIES,
  ...CAPABILITY_ENTITIES,
  ...FEATURE_ENTITIES,
  ...HUB_ENTITIES,
  ...KNOWLEDGE_ENTITIES,
  ...RESOURCE_ENTITIES,
];

const ENTITY_IDS = new Set(ENTITIES.map((e) => e.id));

/** True when every relation target resolves to a real entity (graph consistency). */
export function danglingRelations(): Array<{ from: string; to: string }> {
  const bad: Array<{ from: string; to: string }> = [];
  for (const e of ENTITIES) for (const r of e.relations) if (!ENTITY_IDS.has(r)) bad.push({ from: e.id, to: r });
  return bad;
}

export function entitiesByType(type: EntityType): Entity[] {
  return ENTITIES.filter((e) => e.type === type);
}
