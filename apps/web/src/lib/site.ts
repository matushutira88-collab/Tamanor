/**
 * V1.38.2 — canonical site constants. Single source of truth for the public
 * origin, brand identity and content revision used by every discoverability
 * artifact (robots, sitemap, llms.txt, JSON-LD, entity graph, *-map.json).
 *
 * These are FACTS about the real product — never marketing embellishment.
 */
import { locales, type Locale } from "../i18n";

/** Public production origin (matches `metadataBase` in the root layout). */
export const SITE_URL = "https://tamanor.com";
export const SITE_NAME = "Tamanor";
export const SITE_TAGLINE = "Social Account Firewall";
export const SITE_LEGAL_NAME = "Tamanor";

/**
 * Truthful one-line product description (mirrors the localized meta description).
 * Tamanor MONITORS and PROTECTS — it never claims automatic execution or platforms
 * it does not support.
 */
export const SITE_DESCRIPTION =
  "Tamanor is a Social Account Firewall: it monitors comments and reviews across connected social accounts, detects spam, scams and harmful behavior with AI risk detection, and prepares safe moderation actions that a human approves. Read-only by default, multi-tenant with row-level security and a full audit log.";

/**
 * Content revision date for generated artifacts (`lastUpdated`). A fixed, truthful
 * revision stamp (this phase) — NOT a wall-clock value, so generated files and their
 * tests are deterministic. Bump when the discoverability content changes.
 */
export const CONTENT_REVISION = "2026-07-13";

export const SUPPORTED_LOCALES: readonly Locale[] = locales;

/** Absolute URL for a site-relative path. */
export function abs(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${SITE_URL}${path === "/" ? "" : path}`;
}

/**
 * AI / LLM crawler user-agents Tamanor explicitly welcomes. Kept truthful and
 * public — these are documented crawlers for AI search and answer engines.
 */
export const AI_CRAWLERS: readonly string[] = [
  "GPTBot", // OpenAI / ChatGPT
  "OAI-SearchBot", // OpenAI SearchGPT
  "ChatGPT-User", // ChatGPT browsing
  "ClaudeBot", // Anthropic / Claude
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot", // Perplexity
  "Perplexity-User",
  "Google-Extended", // Gemini / Google AI
  "GoogleOther",
  "Applebot-Extended",
  "Bingbot", // Bing / Copilot
  "CCBot", // Common Crawl (feeds many LLMs)
  "Amazonbot",
  "cohere-ai",
  "Meta-ExternalAgent",
  "DuckAssistBot",
  "YouBot",
  "Bytespider", // Grok/others via Common Crawl-adjacent
];
