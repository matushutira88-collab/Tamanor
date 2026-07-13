/**
 * V1.38.3 — production deployment-readiness guardrails.
 *
 * Validates the config + generated artifacts against production expectations WITHOUT a
 * live domain (no deploy access): canonical host is tamanor.com everywhere, no
 * localhost/preview/stale-domain leaks, robots/sitemap/AI-artifact shape is correct,
 * hreflang is truthful, the IndexNow payload is canonical-only, canonical-host redirects
 * are configured and loop-free, security headers are present, the build pins production,
 * and the internal link/sitemap graph has no broken/orphaned routes.
 *
 * Run: pnpm deploy-readiness:test
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import nextConfig from "../next.config.mjs";
import { SITE_URL } from "../src/lib/site";
import {
  buildRobotsTxt, buildSitemapXml, sitemapUrls, buildLlmsTxt, buildLlmsFullTxt, buildAtomFeed,
  buildAiIndex, buildCapabilities, buildEntityMap, buildTopics, buildIntegrationMap,
  buildFeatureMap, buildProductMap, buildKnowledgeMap, buildTrustMap,
  MARKETING_ROUTES, SECTION_INDEX_ROUTES, allPublicPaths,
} from "../src/lib/discoverability";
import { indexNowUrls, buildIndexNowPayload, INDEXNOW_KEY_PATH } from "../src/lib/indexnow";
import { KNOWLEDGE, pathForEntry, pathForSlug } from "../src/content/knowledge";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const HOST = "https://tamanor.com";
const web = (p: string) => readFileSync(resolve(process.cwd(), "../web", p), "utf8");

// Every generated artifact as a string, for host-leak scanning.
const ARTIFACTS: Record<string, string> = {
  robots: buildRobotsTxt(),
  sitemap: buildSitemapXml(),
  llms: buildLlmsTxt(),
  llmsFull: buildLlmsFullTxt(),
  feed: buildAtomFeed(),
  aiIndex: JSON.stringify(buildAiIndex()),
  capabilities: JSON.stringify(buildCapabilities()),
  entityMap: JSON.stringify(buildEntityMap()),
  topics: JSON.stringify(buildTopics()),
  integrationMap: JSON.stringify(buildIntegrationMap()),
  featureMap: JSON.stringify(buildFeatureMap()),
  productMap: JSON.stringify(buildProductMap()),
  knowledgeMap: JSON.stringify(buildKnowledgeMap()),
  trustMap: JSON.stringify(buildTrustMap()),
};

const FORBIDDEN = [/localhost/i, /127\.0\.0\.1/, /\.vercel\.app/i, /guardora\.ai/i, /http:\/\/tamanor/i, /https?:\/\/www\.tamanor/i];

function run() {
  // 1: canonical host single source of truth
  check("1) canonical host = https://tamanor.com (SITE_URL + layout metadataBase)",
    SITE_URL === HOST && /metadataBase:\s*new URL\("https:\/\/tamanor\.com"\)/.test(web("src/app/layout.tsx")));

  // 2: no localhost / preview / stale-domain / non-canonical host in ANY artifact
  const leaks = Object.entries(ARTIFACTS).flatMap(([name, s]) => FORBIDDEN.filter((re) => re.test(s)).map((re) => `${name}:${re}`));
  check("2) no localhost / preview / guardora.ai / www / http host in any artifact", leaks.length === 0, leaks.join(", "));

  // 3: robots shape
  const robots = buildRobotsTxt();
  check("3) robots: Sitemap→tamanor.com, dashboard+api disallow, AI crawlers, no preview",
    robots.includes(`Sitemap: ${HOST}/sitemap.xml`) && robots.includes("Disallow: /dashboard/") && robots.includes("Disallow: /api/")
    && ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "Bingbot"].every((b) => robots.includes(`User-agent: ${b}`)));

  // 4: sitemap shape — all locs canonical, no private routes, no duplicates
  const sitemap = buildSitemapXml();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  check("4) sitemap: valid, all <loc> on tamanor.com, no dashboard/api", sitemap.startsWith("<?xml") && locs.length > 0 && locs.every((l) => l.startsWith(HOST)) && !locs.some((l) => /\/dashboard|\/api/.test(l)));
  check("5) sitemap: no duplicate <loc>", new Set(locs).size === locs.length);
  check("6) sitemap: compare + security child routes included", KNOWLEDGE.filter((e) => e.collection === "compare" || e.collection === "security").every((e) => locs.includes(`${HOST}${pathForEntry(e)}`)));
  check("7) sitemap: /search (noindex tool) excluded", !locs.includes(`${HOST}/search`));

  // 8: truthful hreflang — English-only knowledge pages carry NO alternates
  const urls = sitemapUrls();
  const enOnly = KNOWLEDGE.map((e) => `${HOST}${pathForEntry(e)}`);
  check("8) English-only knowledge pages have NO hreflang alternates", enOnly.every((u) => { const s = urls.find((x) => x.loc === u); return s && !s.alternates; }));
  const home = urls.find((u) => u.loc === HOST)!;
  check("9) localized routes DO carry hreflang (home en/sk/de + x-default)", !!home.alternates && ["en", "sk", "de", "x-default"].every((h) => home.alternates!.some((a) => a.hreflang === h)));

  // 10–12: AI artifacts valid + canonical + provider truth already covered by seo tests; assert shape here
  const ai = buildAiIndex();
  check("10) ai-index: JSON valid, canonical URL, honest flags", ai.url === HOST && ai.humanInTheLoop === true && ai.autoExecution === false && ai.providerStatus.length === 6);
  check("11) ai-index provider truth: Instagram/GBP not live, YT/LI/TT research", ai.providerStatus.find((p) => p.platform === "instagram")!.live === false && ai.providerStatus.find((p) => p.platform === "google_business")!.live === false && ["youtube", "linkedin", "tiktok"].every((k) => ai.providerStatus.find((p) => p.platform === k)!.status === "research"));
  check("12) every AI map stringifies to valid JSON", Object.entries(ARTIFACTS).filter(([n]) => n.endsWith("Map") || n === "aiIndex" || n === "capabilities" || n === "topics").every(([, s]) => { try { JSON.parse(s); return true; } catch { return false; } }));

  // 13: IndexNow payload — canonical public only; rejects private URLs
  const inUrls = indexNowUrls();
  check("13) IndexNow submits only canonical public URLs (no dashboard/api/search/login)", inUrls.length > 0 && inUrls.every((u) => u.startsWith(HOST)) && !inUrls.some((u) => /\/dashboard|\/api|\/search|\/login/.test(u)));
  const payload = buildIndexNowPayload("TESTKEY", inUrls);
  check("14) IndexNow payload: host + keyLocation correct", payload.host === "tamanor.com" && payload.keyLocation === `${HOST}${INDEXNOW_KEY_PATH}`);
  let rejected = false;
  try { buildIndexNowPayload("K", [`${HOST}/dashboard/secret`]); } catch { rejected = true; }
  check("15) IndexNow refuses a non-indexable URL", rejected);

  // 16: redirect mapping — www→apex + legacy guardora.ai→apex, permanent, path-preserving, loop-free
  const redirects = (nextConfig as { redirects?: () => Promise<Array<{ source: string; has?: { value: string }[]; destination: string; permanent: boolean }>> }).redirects;
  return Promise.resolve(redirects ? redirects() : []).then((rules) => {
    const hosts = rules.map((r) => r.has?.[0]?.value);
    check("16) redirects: www.tamanor.com + guardora.ai → apex, permanent, path-preserving, no loop",
      rules.length >= 2
      && hosts.includes("www.tamanor.com") && hosts.includes("guardora.ai")
      && rules.every((r) => r.permanent === true && /\/:path\*$/.test(r.destination) && r.destination.startsWith(HOST) && r.has?.[0]?.value !== "tamanor.com"));

    // 17: security headers configured
    const headers = (nextConfig as { headers?: () => Promise<Array<{ headers: { key: string }[] }>> }).headers;
    return Promise.resolve(headers ? headers() : []).then((hs) => {
      const keys = new Set(hs.flatMap((h) => h.headers.map((x) => x.key)));
      check("17) security headers present (HSTS, nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy)",
        ["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"].every((k) => keys.has(k)));

      // 18: build pins production env (deterministic build fix)
      const webPkg = JSON.parse(web("package.json"));
      check("18) web build pins NODE_ENV=production", /NODE_ENV=production/.test(webPkg.scripts.build));

      // 19: broken-link / canonical audit over the internal graph
      const badRelated = KNOWLEDGE.flatMap((e) => e.related.filter((s) => !pathForSlug(s)).map((s) => `${e.slug}->${s}`));
      check("19) no broken internal links (every related slug resolves)", badRelated.length === 0, badRelated.join(", "));

      // 20: every sitemap URL maps to a real route; every knowledge page is in the sitemap
      const knownStatic = new Set<string>([
        ...MARKETING_ROUTES.flatMap((r) => (r.i18n ? [r.path, `/sk${r.path === "/" ? "" : r.path}` || "/sk", `/de${r.path === "/" ? "" : r.path}` || "/de"] : [r.path])),
        ...SECTION_INDEX_ROUTES.filter((s) => s !== "/search"),
      ]);
      const knowledgePaths = new Set(KNOWLEDGE.map((e) => pathForEntry(e)));
      const orphanLocs = locs.map((l) => l.slice(HOST.length) || "/").filter((p) => !knownStatic.has(p) && !knowledgePaths.has(p));
      check("20) every sitemap URL corresponds to a real route", orphanLocs.length === 0, orphanLocs.join(", "));
      check("21) every knowledge page is in the sitemap (no indexable orphan)", [...knowledgePaths].every((p) => locs.includes(`${HOST}${p}`)));

      // 22: public path set excludes private routes
      const pub = allPublicPaths();
      check("22) public path set excludes dashboard/api/login", !pub.some((p) => /\/dashboard|\/api|\/login/.test(p)));

      console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — production deployment readiness (V1.38.3)`);
      process.exit(failures === 0 ? 0 : 1);
    });
  });
}

run();
