/**
 * V1.38.2 — SEO / GEO / AI-discoverability integration tests.
 *
 * Validates every generated artifact against the real entity graph + knowledge base:
 * robots, sitemap (+hreflang), llms.txt/full, ai-index + all *-map.json, JSON-LD,
 * canonical/hreflang, entity-graph consistency, internal links, and TRUTHFULNESS
 * (no invented capabilities, no asserted price). Pure — no network, no Next runtime.
 *
 * Run: pnpm seo:test
 */
import { FACEBOOK_CAPABILITIES, GOOGLE_BUSINESS_CAPABILITIES, TIKTOK_CAPABILITIES } from "@guardora/core";
import {
  buildRobotsTxt, buildSitemapXml, sitemapUrls, buildLlmsTxt, buildLlmsFullTxt,
  buildAiIndex, buildCapabilities, buildEntityMap, buildTopics, buildIntegrationMap,
  buildFeatureMap, buildProductMap, buildKnowledgeMap, buildTrustMap, buildAtomFeed,
  allPublicPaths,
} from "../src/lib/discoverability";
import { ENTITIES, CAPABILITY_SIGNALS, danglingRelations } from "../src/lib/entities";
import {
  organizationLd, websiteLd, softwareApplicationLd, breadcrumbLd, faqLd, techArticleLd, collectionLd,
} from "../src/lib/jsonld";
import { KNOWLEDGE, pathForSlug, pathForEntry, getEntry } from "../src/content/knowledge";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const SITE = "https://tamanor.com";
const entityIds = new Set(ENTITIES.map((e) => e.id));

function run() {
  // -------------------------- robots --------------------------
  const robots = buildRobotsTxt();
  check("1) robots: points to sitemap", robots.includes(`Sitemap: ${SITE}/sitemap.xml`));
  check("2) robots: welcomes AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Bingbot)",
    ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "Bingbot"].every((b) => robots.includes(`User-agent: ${b}`)));
  check("3) robots: disallows dashboard + api", robots.includes("Disallow: /dashboard/") && robots.includes("Disallow: /api/"));

  // -------------------------- sitemap --------------------------
  const sitemap = buildSitemapXml();
  const urls = sitemapUrls();
  check("4) sitemap: valid urlset root + xhtml ns", sitemap.startsWith('<?xml') && sitemap.includes("<urlset") && sitemap.includes("xmlns:xhtml"));
  check("5) sitemap: home + every knowledge page present", sitemap.includes(`<loc>${SITE}</loc>`) && KNOWLEDGE.every((e) => sitemap.includes(`<loc>${SITE}${pathForEntry(e)}</loc>`)));
  check("6) sitemap: section indexes present", ["/platform", "/features", "/integrations", "/docs", "/ai"].every((p) => sitemap.includes(`<loc>${SITE}${p}</loc>`)));
  const home = urls.find((u) => u.loc === SITE)!;
  check("7) sitemap: home has hreflang en/sk/de + x-default", !!home.alternates && ["en", "sk", "de", "x-default"].every((h) => home.alternates!.some((a) => a.hreflang === h)));
  check("8) sitemap: x-default points at the EN url", home.alternates!.find((a) => a.hreflang === "x-default")!.href === SITE);
  check("9) sitemap: /search (a tool) is NOT indexed", !sitemap.includes(`<loc>${SITE}/search</loc>`));

  // -------------------------- llms.txt --------------------------
  const llms = buildLlmsTxt();
  check("10) llms.txt: titled + summary + capabilities + provider status + revision", llms.startsWith("# Tamanor") && llms.includes("## Capabilities") && llms.includes("## Provider status (single source of truth)") && llms.includes("Last updated:"));
  check("11) llms.txt: honesty — Facebook live, Instagram verification-pending, TikTok research", /Facebook Page: live_verified/.test(llms) && /Instagram Business: implementation_complete_verification_pending/.test(llms) && /TikTok: research/.test(llms));
  const full = buildLlmsFullTxt();
  check("12) llms-full.txt: every knowledge page inlined", KNOWLEDGE.every((e) => full.includes(`## ${e.title}`)));

  // -------------------------- ai-index --------------------------
  const ai = buildAiIndex();
  check("13) ai-index: honest core flags (humanInTheLoop true, autoExecution false, OAuth only)", ai.humanInTheLoop === true && ai.autoExecution === false && /OAuth only/i.test(ai.connectionMethod));
  check("14) ai-index: entities + capabilities + pages populated", ai.entities.length === ENTITIES.length && ai.capabilities.length === CAPABILITY_SIGNALS.length && ai.pages.length === KNOWLEDGE.length);

  // -------------------------- capabilities (truthfulness vs core) --------------------------
  const caps = buildCapabilities();
  const sig = (k: string) => caps.signals.find((s) => s.key === k)!;
  check("15) capabilities: automaticExecution=false, humanApprovalRequired=true", caps.automaticExecution === false && caps.humanApprovalRequired === true);
  check("16) capabilities: Facebook signals MATCH core capability constants", sig("supportsFacebookPages").supported === FACEBOOK_CAPABILITIES.canReadComments && sig("supportsFacebookHide").supported === FACEBOOK_CAPABILITIES.canHideComment);
  check("17) capabilities: Google review sync MATCHES core", sig("supportsGoogleBusiness").supported === GOOGLE_BUSINESS_CAPABILITIES.canReviewSync);
  check("18) capabilities: honesty — TikTok/YouTube/LinkedIn NOT claimed, no auto-execution", sig("supportsTikTok").supported === TIKTOK_CAPABILITIES.canReadComments && sig("supportsTikTok").supported === false && sig("supportsYouTube").supported === false && sig("supportsLinkedIn").supported === false && sig("supportsAutoExecution").supported === false);
  check("19) capabilities: platform statuses honest (central provider model)", caps.platforms.find((p) => p.platform === "facebook")!.status === "live_verified" && caps.platforms.find((p) => p.platform === "instagram")!.status === "implementation_complete_verification_pending" && caps.platforms.find((p) => p.platform === "tiktok")!.status === "research");

  // -------------------------- entity graph --------------------------
  const dangling = danglingRelations();
  check("20) entity graph: no dangling relations", dangling.length === 0, JSON.stringify(dangling));
  check("21) entity graph: every entity has id/slug/url/canonical/lastUpdated", ENTITIES.every((e) => e.id && e.slug && e.url.startsWith(SITE) && e.canonical === e.url && /^\d{4}-\d{2}-\d{2}$/.test(e.lastUpdated)));
  const emap = buildEntityMap();
  check("22) entity-map.json: count matches graph", emap.count === ENTITIES.length && emap.entities.length === ENTITIES.length);

  // -------------------------- internal link graph --------------------------
  const badRelated = KNOWLEDGE.flatMap((e) => e.related.filter((s) => !pathForSlug(s)).map((s) => `${e.slug}->${s}`));
  check("23) internal links: every related slug resolves to a real route", badRelated.length === 0, badRelated.join(", "));
  const badRefs = KNOWLEDGE.flatMap((e) => e.entityRefs.filter((r) => !entityIds.has(r)).map((r) => `${e.slug}->${r}`));
  check("24) internal links: every entityRef resolves to a real entity", badRefs.length === 0, badRefs.join(", "));

  // -------------------------- JSON-LD --------------------------
  const org = organizationLd(), site = websiteLd(), app = softwareApplicationLd();
  check("25) JSON-LD: Organization/WebSite/SoftwareApplication valid @context/@type", org["@type"] === "Organization" && site["@type"] === "WebSite" && app["@type"] === "SoftwareApplication" && [org, site, app].every((x) => x["@context"] === "https://schema.org"));
  check("26) JSON-LD: WebSite has a real SearchAction → /search", site.potentialAction["@type"] === "SearchAction" && String(site.potentialAction.target.urlTemplate).includes("/search?q="));
  // Truthfulness: no asserted price / Offer anywhere in the software JSON-LD.
  const appJson = JSON.stringify(app);
  check("27) JSON-LD: SoftwareApplication asserts NO price/Offer (beta, no billing)", !("offers" in app) && !/\"price\"|Offer/.test(appJson) && app.isAccessibleForFree === true);
  const sample = getEntry("platform", "what-is-tamanor")!;
  const art = techArticleLd(sample);
  check("28) JSON-LD: TechArticle canonical URL matches entry path", art.url === `${SITE}${pathForEntry(sample)}`);
  const bc = breadcrumbLd([{ name: "Home", path: "/" }, { name: "Platform", path: "/platform" }]);
  check("29) JSON-LD: BreadcrumbList positions are 1-based + absolute", bc.itemListElement[0]!.position === 1 && bc.itemListElement[1]!.item === `${SITE}/platform`);
  const faq = faqLd(sample.faqs);
  const coll = collectionLd("Features", "/features", [{ name: "x", path: "/features/x" }]);
  check("30) JSON-LD: FAQPage + CollectionPage/ItemList shape valid", faq["@type"] === "FAQPage" && faq.mainEntity.length === sample.faqs.length && coll.mainEntity["@type"] === "ItemList");

  // -------------------------- maps + feed + coverage --------------------------
  const imap = buildIntegrationMap(), fmap = buildFeatureMap(), pmap = buildProductMap(), kmap = buildKnowledgeMap(), tmap = buildTrustMap(), topics = buildTopics();
  check("31) maps: integration/feature/product/knowledge/topics all populated", imap.integrations.length === 6 && fmap.features.length === 9 && pmap.features.length === 9 && kmap.collections.length === 6 && topics.topics.length === KNOWLEDGE.length);
  check("32) trust-map: honest principles (read-only, human approval, no auto-execution)", tmap.principles.some((p) => /read-only/i.test(p)) && tmap.principles.some((p) => /human approval/i.test(p)) && tmap.principles.some((p) => /no automatic execution/i.test(p)));
  const feed = buildAtomFeed();
  check("33) feed.xml: valid Atom with entries for real pages", feed.includes("<feed") && KNOWLEDGE.every((e) => feed.includes(`<id>${SITE}${pathForEntry(e)}</id>`)));
  check("34) coverage: public paths include new sections + all knowledge pages", ["/platform", "/features", "/integrations", "/docs", "/ai"].every((p) => allPublicPaths().includes(p)) && KNOWLEDGE.every((e) => allPublicPaths().includes(pathForEntry(e))));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — SEO/GEO/AI discoverability (V1.38.2)`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
