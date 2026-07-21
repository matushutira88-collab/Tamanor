/**
 * V1.38.2 — pure builders for every AI-discoverability artifact. Kept framework-free
 * (return strings / plain objects) so the route handlers are thin wrappers AND the
 * integration tests can import and validate them WITHOUT the Next.js runtime.
 *
 * Every artifact is generated from the real entity graph + knowledge base. No file
 * is hand-authored; nothing is asserted that the product cannot do.
 */
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, CONTENT_REVISION, AI_CRAWLERS, abs } from "./site";
import { ENTITIES, CAPABILITY_SIGNALS, supportedSignals, entitiesByType, type Entity } from "./entities";
import { PROVIDERS, providerStatusFor } from "./provider-status";
import {
  KNOWLEDGE,
  entriesIn,
  pathForEntry,
  collectionBasePath,
  type KnowledgeCollection,
  type KnowledgeEntry,
} from "../content/knowledge";

// --------------------------- static public routes ---------------------------
/** Localized marketing routes that physically exist in the app (EN + sk/de variants). */
export const MARKETING_ROUTES: { path: string; changefreq: string; priority: number; i18n?: boolean }[] = [
  { path: "/", changefreq: "weekly", priority: 1.0, i18n: true },
  { path: "/security", changefreq: "monthly", priority: 0.7 },
  { path: "/about", changefreq: "monthly", priority: 0.5 },
  { path: "/case-studies", changefreq: "monthly", priority: 0.5, i18n: true },
  { path: "/contact", changefreq: "yearly", priority: 0.3 },
  { path: "/privacy", changefreq: "yearly", priority: 0.3 },
  { path: "/terms", changefreq: "yearly", priority: 0.3 },
  // V1.72 (Release C1) — standalone legal/policy pages: indexable, now discoverable via the sitemap.
  { path: "/cookies", changefreq: "yearly", priority: 0.2 },
  { path: "/dpa", changefreq: "yearly", priority: 0.2 },
  { path: "/subprocessors", changefreq: "yearly", priority: 0.2 },
  { path: "/business-terms", changefreq: "yearly", priority: 0.2 },
  { path: "/consumer-terms", changefreq: "yearly", priority: 0.2 },
  { path: "/ai-transparency", changefreq: "yearly", priority: 0.3 },
  { path: "/copyright", changefreq: "yearly", priority: 0.2 },
  { path: "/data-retention", changefreq: "yearly", priority: 0.2 },
  { path: "/data-subject-rights", changefreq: "yearly", priority: 0.2 },
  { path: "/incident-policy", changefreq: "yearly", priority: 0.2 },
  { path: "/information-security", changefreq: "yearly", priority: 0.3 },
  { path: "/security-policy", changefreq: "yearly", priority: 0.3 },
];

/** Section index routes generated in V1.38.2. */
export const SECTION_INDEX_ROUTES = ["/platform", "/features", "/integrations", "/docs", "/ai", "/compare", "/search"] as const;

/** Every public, indexable URL (site-relative), incl. knowledge pages + sections. */
export function allPublicPaths(): string[] {
  const paths = new Set<string>();
  for (const r of MARKETING_ROUTES) {
    paths.add(r.path);
    if (r.i18n) {
      const suffix = r.path === "/" ? "" : r.path;
      paths.add(`/sk${suffix}`);
      paths.add(`/de${suffix}`);
    }
  }
  for (const s of SECTION_INDEX_ROUTES) if (s !== "/search") paths.add(s);
  for (const e of KNOWLEDGE) paths.add(pathForEntry(e));
  return [...paths];
}

// ------------------------------- sitemap.xml -------------------------------
interface SitemapUrl {
  loc: string;
  changefreq: string;
  priority: number;
  alternates?: { hreflang: string; href: string }[];
}

export function sitemapUrls(): SitemapUrl[] {
  const urls: SitemapUrl[] = [];
  for (const r of MARKETING_ROUTES) {
    if (r.i18n) {
      const suffix = r.path === "/" ? "" : r.path;
      const en = abs(r.path);
      const sk = abs(`/sk${suffix}`);
      const de = abs(`/de${suffix}`);
      const alternates = [
        { hreflang: "en", href: en },
        { hreflang: "sk", href: sk },
        { hreflang: "de", href: de },
        { hreflang: "x-default", href: en },
      ];
      urls.push({ loc: en, changefreq: r.changefreq, priority: r.priority, alternates });
      urls.push({ loc: sk, changefreq: r.changefreq, priority: r.priority, alternates });
      urls.push({ loc: de, changefreq: r.changefreq, priority: r.priority, alternates });
    } else {
      urls.push({ loc: abs(r.path), changefreq: r.changefreq, priority: r.priority });
    }
  }
  for (const s of SECTION_INDEX_ROUTES) {
    if (s === "/search") continue; // search is a tool, not indexable content
    urls.push({ loc: abs(s), changefreq: "weekly", priority: 0.6 });
  }
  for (const e of KNOWLEDGE) {
    urls.push({ loc: abs(pathForEntry(e)), changefreq: "monthly", priority: 0.6 });
  }
  return urls;
}

export function buildSitemapXml(): string {
  const urls = sitemapUrls();
  const body = urls
    .map((u) => {
      const alts = (u.alternates ?? [])
        .map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`)
        .join("\n");
      return [
        "  <url>",
        `    <loc>${u.loc}</loc>`,
        `    <lastmod>${CONTENT_REVISION}</lastmod>`,
        `    <changefreq>${u.changefreq}</changefreq>`,
        `    <priority>${u.priority.toFixed(1)}</priority>`,
        alts,
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    body,
    "</urlset>",
  ].join("\n") + "\n";
}

// ------------------------------- robots.txt --------------------------------
export function buildRobotsTxt(): string {
  const lines: string[] = [];
  lines.push("# Tamanor — robots.txt (V1.38.2)");
  lines.push("# Human + AI crawlers welcome on public pages. Dashboard and API are disallowed.");
  lines.push("");
  lines.push("User-agent: *");
  lines.push("Allow: /");
  lines.push("Disallow: /dashboard/");
  lines.push("Disallow: /api/");
  lines.push("Disallow: /login");
  lines.push("Disallow: /register");
  lines.push("Disallow: /onboarding");
  lines.push("Disallow: /verify-email");
  lines.push("Disallow: /forgot-password");
  lines.push("Disallow: /reset-password");
  lines.push("");
  // Explicitly welcome documented AI crawlers to the public site.
  for (const ua of AI_CRAWLERS) {
    lines.push(`User-agent: ${ua}`);
    lines.push("Allow: /");
    lines.push("Disallow: /dashboard/");
    lines.push("Disallow: /api/");
    lines.push("");
  }
  lines.push(`Sitemap: ${abs("/sitemap.xml")}`);
  lines.push(`# LLM guide: ${abs("/llms.txt")}`);
  return lines.join("\n") + "\n";
}

// ------------------------------- llms.txt ----------------------------------
/** Concise llms.txt (the /llms.txt convention): title, summary, curated links. */
export function buildLlmsTxt(): string {
  const L: string[] = [];
  L.push(`# ${SITE_NAME}`);
  L.push("");
  L.push(`> ${SITE_DESCRIPTION}`);
  L.push("");
  L.push("Tamanor is read-only by default and never executes a moderation action without human approval. It connects only through official OAuth and never scrapes or stores passwords.");
  L.push("");
  L.push("## Capabilities (verified true)");
  for (const s of supportedSignals()) L.push(`- ${s.label}`);
  L.push("");
  L.push("## Provider status (single source of truth)");
  for (const p of PROVIDERS) L.push(`- ${p.name}: ${p.status}${p.live ? " (live)" : p.verificationPending ? " (verification pending, not live)" : ""} — ${p.publicStatement}`);
  L.push("");
  const section = (title: string, coll: KnowledgeCollection) => {
    L.push(`## ${title}`);
    for (const e of entriesIn(coll)) L.push(`- [${e.title}](${abs(pathForEntry(e))}): ${e.summary}`);
    L.push("");
  };
  section("Platform & architecture", "platform");
  section("Features", "features");
  section("Integrations", "integrations");
  section("Comparisons", "compare");
  section("Security", "security");
  section("Documentation", "docs");
  L.push("## Machine-readable");
  L.push(`- [ai-index.json](${abs("/ai-index.json")})`);
  L.push(`- [capabilities.json](${abs("/capabilities.json")})`);
  L.push(`- [entity-map.json](${abs("/entity-map.json")})`);
  L.push(`- [llms-full.txt](${abs("/llms-full.txt")})`);
  L.push("");
  L.push(`Last updated: ${CONTENT_REVISION}`);
  return L.join("\n") + "\n";
}

/** Full llms-full.txt: every knowledge page inlined as Markdown (for LLM ingestion). */
export function buildLlmsFullTxt(): string {
  const L: string[] = [];
  L.push(`# ${SITE_NAME} — full knowledge export`);
  L.push("");
  L.push(`> ${SITE_DESCRIPTION}`);
  L.push("");
  L.push(`Origin: ${SITE_URL} · Last updated: ${CONTENT_REVISION}`);
  L.push("");
  for (const coll of ["platform", "features", "integrations", "compare", "security", "docs"] as KnowledgeCollection[]) {
    for (const e of entriesIn(coll)) {
      L.push(`## ${e.title}`);
      L.push(`URL: ${abs(pathForEntry(e))}`);
      const ps = e.platformKey ? providerStatusFor(e.platformKey) : undefined;
      if (ps) L.push(`Provider status: ${ps.status}${ps.live ? " (live)" : " (not live)"}`);
      L.push("");
      L.push(e.summary);
      L.push("");
      for (const sec of e.sections) {
        L.push(`### ${sec.heading}`);
        for (const p of sec.body) L.push(p);
        L.push("");
      }
      if (e.faqs.length) {
        L.push("### FAQ");
        for (const f of e.faqs) {
          L.push(`Q: ${f.q}`);
          L.push(`A: ${f.a}`);
        }
        L.push("");
      }
    }
  }
  return L.join("\n") + "\n";
}

// ------------------------- structured JSON artifacts ------------------------
function entityCard(e: Entity) {
  return {
    id: e.id,
    type: e.type,
    name: e.name,
    slug: e.slug,
    url: e.url,
    canonical: e.canonical,
    description: e.description,
    relations: e.relations,
    aliases: e.aliases,
    keywords: e.keywords,
    supportedLanguages: e.supportedLanguages,
    lastUpdated: e.lastUpdated,
  };
}

export function buildAiIndex() {
  return {
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    lastUpdated: CONTENT_REVISION,
    languages: ["en", "sk", "de"],
    humanInTheLoop: true,
    autoExecution: false,
    connectionMethod: "official OAuth only (no scraping, no passwords)",
    capabilities: CAPABILITY_SIGNALS.map((s) => ({ key: s.key, label: s.label, supported: s.supported })),
    providerStatus: PROVIDERS.map((p) => ({ platform: p.key, name: p.name, status: p.status, live: p.live, verificationPending: p.verificationPending, statement: p.publicStatement })),
    entities: ENTITIES.map(entityCard),
    pages: KNOWLEDGE.map((e) => ({ title: e.title, url: abs(pathForEntry(e)), collection: e.collection, summary: e.summary })),
    resources: {
      llms: abs("/llms.txt"),
      llmsFull: abs("/llms-full.txt"),
      sitemap: abs("/sitemap.xml"),
      capabilities: abs("/capabilities.json"),
      entityMap: abs("/entity-map.json"),
    },
  };
}

export function buildCapabilities() {
  return {
    name: SITE_NAME,
    lastUpdated: CONTENT_REVISION,
    humanApprovalRequired: true,
    automaticExecution: false,
    signals: CAPABILITY_SIGNALS.map((s) => ({ key: s.key, label: s.label, supported: s.supported, source: s.source })),
    platforms: PROVIDERS.map((p) => ({ platform: p.key, name: p.name, status: p.status, live: p.live, verificationPending: p.verificationPending, statement: p.publicStatement, url: abs(pathForEntry(integrationEntryFor(p.key))) })),
  };
}

/** Resolve the integration page for a provider key (for map URLs). */
function integrationEntryFor(key: string): KnowledgeEntry {
  const e = entriesIn("integrations").find((x) => x.platformKey === key);
  if (!e) throw new Error(`no integration page for provider ${key}`);
  return e;
}

export function buildEntityMap() {
  return { name: SITE_NAME, lastUpdated: CONTENT_REVISION, count: ENTITIES.length, entities: ENTITIES.map(entityCard) };
}

export function buildTopics() {
  return {
    name: SITE_NAME,
    lastUpdated: CONTENT_REVISION,
    topics: KNOWLEDGE.map((e) => ({ slug: e.slug, collection: e.collection, title: e.title, url: abs(pathForEntry(e)), keywords: e.keywords, related: e.related })),
  };
}

function mapFor(collection: KnowledgeCollection) {
  return entriesIn(collection).map((e: KnowledgeEntry) => {
    const ps = e.platformKey ? providerStatusFor(e.platformKey) : undefined;
    return {
      slug: e.slug,
      title: e.title,
      url: abs(pathForEntry(e)),
      summary: e.summary,
      ...(ps ? { status: ps.status, live: ps.live, verificationPending: ps.verificationPending } : {}),
      keywords: e.keywords,
      related: e.related.map((r) => r),
    };
  });
}

export function buildIntegrationMap() {
  return { name: SITE_NAME, lastUpdated: CONTENT_REVISION, base: abs(collectionBasePath("integrations")), integrations: mapFor("integrations") };
}
export function buildFeatureMap() {
  return { name: SITE_NAME, lastUpdated: CONTENT_REVISION, base: abs(collectionBasePath("features")), features: mapFor("features") };
}
export function buildProductMap() {
  return {
    name: SITE_NAME,
    lastUpdated: CONTENT_REVISION,
    product: "Tamanor Social Account Firewall",
    tagline: "Monitor, detect, propose, approve",
    features: entriesIn("features").map((e) => ({ title: e.title, url: abs(pathForEntry(e)) })),
    integrations: entriesIn("integrations").map((e) => ({ title: e.title, status: providerStatusFor(e.platformKey)?.status, live: providerStatusFor(e.platformKey)?.live ?? false, url: abs(pathForEntry(e)) })),
    capabilities: supportedSignals().map((s) => s.label),
  };
}
export function buildKnowledgeMap() {
  return {
    name: SITE_NAME,
    lastUpdated: CONTENT_REVISION,
    collections: (["platform", "features", "integrations", "compare", "security", "docs"] as KnowledgeCollection[]).map((c) => ({
      collection: c,
      base: abs(collectionBasePath(c)),
      entries: mapFor(c),
    })),
  };
}
export function buildTrustMap() {
  const security = entitiesByType("Security").concat(entitiesByType("Compliance"));
  return {
    name: SITE_NAME,
    lastUpdated: CONTENT_REVISION,
    principles: [
      "Official OAuth only — no scraping, no passwords",
      "Read-only by default",
      "Human approval before any moderation action",
      "No automatic execution",
      "Tokens encrypted at rest (production) and never logged",
      "PostgreSQL row-level security tenant isolation",
      "Append-only audit log without secrets",
    ],
    references: security.map((e) => ({ name: e.name, url: e.url })),
    // The dedicated /security route tree (V1.38.2B) + related platform security pages.
    securityPages: [
      ...entriesIn("security").map((e) => ({ title: e.title, url: abs(pathForEntry(e)) })),
      ...KNOWLEDGE.filter((e) => e.collection === "platform" && ["encryption", "data-protection", "privacy"].includes(e.slug)).map((e) => ({ title: e.title, url: abs(pathForEntry(e)) })),
    ],
    disclosure: abs("/security/disclosure"),
  };
}

// ------------------------------- Atom feed ---------------------------------
/** Atom feed of the real published knowledge pages (no fabricated blog). */
export function buildAtomFeed(): string {
  const updated = `${CONTENT_REVISION}T00:00:00Z`;
  const entries = KNOWLEDGE.map((e) => {
    const url = abs(pathForEntry(e));
    return [
      "  <entry>",
      `    <title>${xml(e.title)}</title>`,
      `    <id>${url}</id>`,
      `    <link href="${url}"/>`,
      `    <updated>${updated}</updated>`,
      `    <summary>${xml(e.summary)}</summary>`,
      "  </entry>",
    ].join("\n");
  }).join("\n");
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${xml(SITE_NAME)} — Knowledge</title>`,
    `  <id>${SITE_URL}/feed.xml</id>`,
    `  <link href="${SITE_URL}/feed.xml" rel="self"/>`,
    `  <link href="${SITE_URL}"/>`,
    `  <updated>${updated}</updated>`,
    `  <author><name>${xml(SITE_NAME)}</name></author>`,
    entries,
    "</feed>",
  ].join("\n") + "\n";
}

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
