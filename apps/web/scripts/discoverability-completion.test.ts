/**
 * V1.38.2B — Compare & Security route completion + provider-truth centralization.
 *
 * Behavior/builder checks against the real content + generators, plus narrow source
 * guardrails for static route/metadata presence. Verifies: the /compare and /security
 * route trees exist with metadata/canonical/breadcrumbs, compare pages assert no
 * Review/AggregateRating/Offer and no competitor/numeric claims, one centralized
 * provider-truth model is used everywhere (llms/ai-index/capabilities/integration
 * pages), Instagram & GBP are verification-pending (not live), unsupported platforms
 * are not shown as supported, the entity graph stays consistent, sitemap/hreflang are
 * truthful, search covers the new content, and disclosure uses no invented contact.
 *
 * Run: pnpm seo-completion:test
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSitemapXml, sitemapUrls, buildLlmsTxt, buildLlmsFullTxt, buildAiIndex,
  buildCapabilities, buildIntegrationMap, buildKnowledgeMap, buildTrustMap, buildRobotsTxt,
} from "../src/lib/discoverability";
import { danglingRelations, ENTITIES } from "../src/lib/entities";
import { PROVIDERS, providerStatusFor } from "../src/lib/provider-status";
import { techArticleLd, faqLd, breadcrumbLd } from "../src/lib/jsonld";
import { KNOWLEDGE, entriesIn, getEntry, pathForEntry, pathForSlug } from "../src/content/knowledge";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const SITE = "https://tamanor.com";
const APP = (p: string) => resolve(process.cwd(), "../web/src/app", p);
const src = (p: string) => (existsSync(APP(p)) ? readFileSync(APP(p), "utf8") : "");
const entityIds = new Set(ENTITIES.map((e) => e.id));

const COMPARE_SLUGS = ["manual-moderation", "separate-social-tools", "autonomous-ai-moderation", "unified-brand-inbox", "reputation-management-platform-checklist"];
const SECURITY_SLUGS = ["tenant-isolation", "row-level-security", "authentication", "provider-tokens", "audit-logging", "data-integrity", "webhook-security", "responsible-ai", "disclosure"];

const COMPETITORS = ["hootsuite", "sprout social", "sprout", "brandwatch", "meltwater", "talkwalker", "agorapulse", "sprinklr", "khoros", "birdeye", "podium", "trustpilot", "reputation.com"];

function run() {
  // 1–4: route trees exist
  check("1) /compare route exists", existsSync(APP("compare/page.tsx")) && existsSync(APP("compare/[slug]/page.tsx")));
  check("2) all compare child routes exist", COMPARE_SLUGS.every((s) => !!getEntry("compare", s)) && entriesIn("compare").length === COMPARE_SLUGS.length);
  check("3) /security route exists (hub + children)", existsSync(APP("security/page.tsx")) && existsSync(APP("security/[slug]/page.tsx")));
  check("4) all security child routes exist", SECURITY_SLUGS.every((s) => !!getEntry("security", s)) && entriesIn("security").length === SECURITY_SLUGS.length);

  // 5–7: metadata / canonical / breadcrumb
  const compareSrc = src("compare/[slug]/page.tsx"), securitySrc = src("security/[slug]/page.tsx");
  check("5) dynamic routes define metadata", /generateMetadata/.test(compareSrc) && /generateMetadata/.test(securitySrc) && /export const metadata/.test(src("compare/page.tsx")));
  check("6) dynamic routes set canonical = entry path", /alternates:\s*{\s*canonical:\s*pathForEntry\(entry\)/.test(compareSrc) && /canonical:\s*pathForEntry\(entry\)/.test(securitySrc)
    && [...entriesIn("compare"), ...entriesIn("security")].every((e) => techArticleLd(e).url === `${SITE}${pathForEntry(e)}`));
  const kvSrc = readFileSync(resolve(process.cwd(), "../web/src/components/knowledge-view.tsx"), "utf8");
  check("7) pages emit BreadcrumbList JSON-LD", /breadcrumbLd\(/.test(kvSrc) && breadcrumbLd([{ name: "Home", path: "/" }, { name: "Compare", path: "/compare" }]).itemListElement.length === 2);

  // 8: compare pages have NO Review / AggregateRating / Offer
  const compareLd = entriesIn("compare").flatMap((e) => [JSON.stringify(techArticleLd(e)), JSON.stringify(faqLd(e.faqs)), JSON.stringify(breadcrumbLd([{ name: "Home", path: "/" }]))]).join(" ");
  // Match schema.org TYPES/props (not the English word "review" that appears in copy).
  check("8) compare JSON-LD has no Review/AggregateRating/Offer type or price prop", !/"@type"\s*:\s*"(Review|AggregateRating|Offer|Product)"|"aggregateRating"|"offers"|"price"/.test(compareLd));

  // 9: no unsupported numbers or competitor claims in compare content
  const compareText = entriesIn("compare").map((e) => [e.title, e.summary, ...e.sections.flatMap((s) => s.body), ...e.faqs.flatMap((f) => [f.q, f.a])].join(" ")).join(" ").toLowerCase();
  const hasPercent = /\d+\s?%/.test(compareText);
  const hasCompetitor = COMPETITORS.find((c) => compareText.includes(c));
  check("9) compare content has no numeric stats or competitor names", !hasPercent && !hasCompetitor, hasCompetitor ? `competitor: ${hasCompetitor}` : "percent claim");

  // 10: centralized provider truth used by capabilities + ai-index
  const caps = buildCapabilities(), ai = buildAiIndex();
  const providerConsistent = PROVIDERS.every((p) => {
    const c = caps.platforms.find((x) => x.platform === p.key);
    const a = ai.providerStatus.find((x) => x.platform === p.key);
    return c?.status === p.status && a?.status === p.status && c?.live === p.live && a?.live === p.live;
  });
  check("10) provider status is centralized (capabilities + ai-index derive from one model)", providerConsistent);

  // 11–13: honesty
  const ig = providerStatusFor("instagram")!, gbp = providerStatusFor("google_business")!;
  check("11) Instagram = implementation_complete_verification_pending, not live", ig.status === "implementation_complete_verification_pending" && ig.verificationPending === true && ig.live === false);
  check("12) Google Business = foundation, verification pending, not live", gbp.status === "foundation_only" && gbp.verificationPending === true && gbp.live === false);
  check("13) YouTube/LinkedIn/TikTok = research, not live/supported", ["youtube", "linkedin", "tiktok"].every((k) => { const p = providerStatusFor(k)!; return p.status === "research" && p.live === false; }));

  // 14–16: same statuses across artifacts + integration pages
  const llms = buildLlmsTxt();
  check("14) llms.txt uses the central provider statuses", PROVIDERS.every((p) => llms.includes(p.status)) && /verification pending, not live/.test(llms));
  check("15) ai-index provider status present + honest flags", ai.humanInTheLoop === true && ai.autoExecution === false && ai.providerStatus.length === PROVIDERS.length);
  const imap = buildIntegrationMap();
  check("16) integration map + pages use central status (badge derives from provider-status)", entriesIn("integrations").every((e) => !!providerStatusFor(e.platformKey)) && imap.integrations.every((i, idx) => i.status === providerStatusFor(entriesIn("integrations")[idx]!.platformKey)!.status) && /statusLabelFor/.test(kvSrc));

  // 17–19: entity graph + links
  const dangling = danglingRelations();
  check("17) entity graph: no dangling relations", dangling.length === 0, JSON.stringify(dangling));
  const compareSecEntities = ENTITIES.filter((e) => e.id === "compare-hub" || e.id === "security-hub" || e.id.startsWith("k-compare-") || e.id.startsWith("k-security-"));
  check("18) every compare/security entity maps to a real route", compareSecEntities.length >= 2 + COMPARE_SLUGS.length + SECURITY_SLUGS.length && compareSecEntities.every((e) => e.path && e.url.startsWith(SITE)));
  const newEntries = [...entriesIn("compare"), ...entriesIn("security")];
  const badRelated = newEntries.flatMap((e) => e.related.filter((s) => !pathForSlug(s)).map((s) => `${e.slug}->${s}`));
  const badRefs = newEntries.flatMap((e) => e.entityRefs.filter((r) => !entityIds.has(r)).map((r) => `${e.slug}->${r}`));
  check("19) internal links + entity refs all resolve (compare + security)", badRelated.length === 0 && badRefs.length === 0, [...badRelated, ...badRefs].join(", "));

  // 20–21: sitemap + hreflang
  const sitemap = buildSitemapXml();
  check("20) sitemap contains /compare hub + all compare/security child routes", sitemap.includes(`<loc>${SITE}/compare</loc>`) && [...COMPARE_SLUGS.map((s) => `/compare/${s}`), ...SECURITY_SLUGS.map((s) => `/security/${s}`)].every((p) => sitemap.includes(`<loc>${SITE}${p}</loc>`)));
  const urls = sitemapUrls();
  const englishOnly = [...entriesIn("compare"), ...entriesIn("security")].map((e) => pathForEntry(e));
  check("21) English-only compare/security pages have NO hreflang alternates", englishOnly.every((p) => { const u = urls.find((x) => x.loc === `${SITE}${p}`); return u && !u.alternates; }));

  // 22: search covers new content (same predicate as /search)
  const searchHit = (needle: string) => KNOWLEDGE.filter((e) => {
    const ps = providerStatusFor(e.platformKey);
    const hay = [e.title, e.summary, e.keywords.join(" "), e.slug, e.collection, ps ? `${ps.status} ${ps.publicStatement}` : ""].join(" ").toLowerCase();
    return needle.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
  });
  check("22) search finds compare + security content", searchHit("checklist").some((e) => e.collection === "compare") && searchHit("disclosure").some((e) => e.collection === "security") && searchHit("verification pending").some((e) => e.collection === "integrations"));

  // 23: disclosure uses no invented contact
  const disclosure = getEntry("security", "disclosure")!;
  const disclosureText = [disclosure.summary, ...disclosure.sections.flatMap((s) => s.body), ...disclosure.faqs.flatMap((f) => f.a)].join(" ");
  const secPageSrc = src("security/page.tsx");
  check("23) security disclosure uses a real channel, no invented email", !/@/.test(disclosureText) && !/mailto:[^"]*guardora\.ai/.test(secPageSrc) && /\/contact/.test(secPageSrc) && buildTrustMap().disclosure === `${SITE}/security/disclosure`);

  // 24: existing artifacts still build (regression smoke; full seo:test runs separately)
  check("24) existing SEO artifacts still generate", buildRobotsTxt().includes("Sitemap:") && buildKnowledgeMap().collections.length === 6 && buildLlmsFullTxt().includes("## Security disclosure"));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Compare & Security completion (V1.38.2B)`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
