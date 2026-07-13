/**
 * V1.38.2 — JSON-LD (schema.org) generators. Pure functions returning plain
 * objects; a page serializes one with the {@link JsonLd} component. Every field is
 * truthful and derived from the entity graph / knowledge base. Pricing is NOT
 * asserted as a firm Offer (Tamanor is in beta with no billing), so no false
 * price claim can leak into structured data.
 */
import { SITE_URL, SITE_NAME, SITE_LEGAL_NAME, SITE_DESCRIPTION, abs } from "./site";
import { supportedSignals } from "./entities";
import type { KnowledgeEntry } from "../content/knowledge";
import { pathForEntry } from "../content/knowledge";

const SCHEMA = "https://schema.org";

export function organizationLd() {
  return {
    "@context": SCHEMA,
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    legalName: SITE_LEGAL_NAME,
    url: SITE_URL,
    description:
      "Tamanor is a Social Account Firewall: it monitors social comments and reviews, detects risk with AI, and prepares human-approved moderation actions.",
    sameAs: [] as string[],
  };
}

/** WebSite + a REAL SearchAction (backed by the /search knowledge search page). */
export function websiteLd() {
  return {
    "@context": SCHEMA,
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    publisher: { "@id": `${SITE_URL}/#organization` },
    inLanguage: ["en", "sk", "de"],
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

export function softwareApplicationLd() {
  return {
    "@context": SCHEMA,
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Social media moderation & reputation protection",
    operatingSystem: "Web",
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    publisher: { "@id": `${SITE_URL}/#organization` },
    // Free start is available; Tamanor is in beta with no billing, so no priced Offer is asserted.
    isAccessibleForFree: true,
    featureList: supportedSignals().map((s) => s.label),
    inLanguage: ["en", "sk", "de"],
  };
}

export interface Crumb {
  name: string;
  path: string;
}
export function breadcrumbLd(crumbs: Crumb[]) {
  return {
    "@context": SCHEMA,
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: abs(c.path),
    })),
  };
}

export function faqLd(faqs: { q: string; a: string }[]) {
  return {
    "@context": SCHEMA,
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** TechArticle for a knowledge/GEO page. */
export function techArticleLd(entry: KnowledgeEntry) {
  const url = abs(pathForEntry(entry));
  return {
    "@context": SCHEMA,
    "@type": "TechArticle",
    "@id": `${url}#article`,
    headline: entry.title,
    description: entry.summary,
    url,
    mainEntityOfPage: url,
    inLanguage: "en",
    about: entry.keywords,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    keywords: entry.keywords.join(", "),
  };
}

/** CollectionPage + ItemList for a section index (features, integrations, ...). */
export function collectionLd(name: string, path: string, items: { name: string; path: string }[]) {
  const url = abs(path);
  return {
    "@context": SCHEMA,
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    name,
    url,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: it.name,
        url: abs(it.path),
      })),
    },
  };
}
