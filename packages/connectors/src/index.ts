/**
 * @guardora/connectors — unified platform adapters.
 *
 * Every adapter implements {@link PlatformConnector}. Adapters are placeholder
 * implementations that make NO real API calls yet; each documents the official
 * endpoints its real version will use. No scraping, official OAuth only.
 */
export * from "./types";
export * from "./base-connector";
export * from "./runtime";
export * from "./registry";
export { MetaConnector } from "./adapters/meta-connector";
export { MetaReadOnlyConnector } from "./adapters/meta-read-only-connector";
export { YouTubeConnector } from "./adapters/youtube-connector";
export { LinkedInConnector } from "./adapters/linkedin-connector";
export { TikTokConnector } from "./adapters/tiktok-connector";
export { GoogleBusinessConnector } from "./adapters/google-business-connector";
// Meta OAuth + discovery (official API only)
export * from "./meta/oauth";
export * from "./meta/graph-client";
export * from "./meta/discovery";
// Controlled Facebook comment hide (the only live action; default off)
export * from "./meta/facebook-hide";
