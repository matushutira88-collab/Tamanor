/**
 * V1.38.3 — IndexNow submission core (protocol-compliant, truthful).
 *
 * Pure helpers so the payload can be validated by tests WITHOUT sending anything.
 * The key is NEVER hardcoded — it is read from the INDEXNOW_KEY environment variable
 * at submit time and served at a fixed `keyLocation`. Only canonical PUBLIC URLs are
 * ever submitted; dashboard, API, login and non-indexable tool routes are excluded.
 */
import { SITE_URL, abs } from "./site";
import { allPublicPaths } from "./discoverability";

/** Public location that serves the IndexNow key file (referenced as `keyLocation`). */
export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** Paths that must NEVER be submitted (non-indexable / private). */
const EXCLUDED = ["/search", "/login"];

/** The canonical, indexable public URLs to submit (absolute, tamanor.com). */
export function indexNowUrls(): string[] {
  const paths = allPublicPaths().filter(
    (p) => !EXCLUDED.includes(p) && !p.startsWith("/dashboard") && !p.startsWith("/api"),
  );
  // Deduplicate + absolutize.
  return [...new Set(paths)].map((p) => abs(p));
}

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/** Build the IndexNow POST body. `key` comes from the environment, never a constant. */
export function buildIndexNowPayload(key: string, urls: string[] = indexNowUrls()): IndexNowPayload {
  const host = new URL(SITE_URL).host;
  // Guardrail: every URL must be on the canonical host and public.
  for (const u of urls) {
    if (!u.startsWith(SITE_URL)) throw new Error(`IndexNow refuses non-canonical URL: ${u}`);
    const path = u.slice(SITE_URL.length) || "/";
    if (path.startsWith("/dashboard") || path.startsWith("/api") || EXCLUDED.includes(path)) {
      throw new Error(`IndexNow refuses non-indexable URL: ${u}`);
    }
  }
  return { host, key, keyLocation: abs(INDEXNOW_KEY_PATH), urlList: urls };
}
