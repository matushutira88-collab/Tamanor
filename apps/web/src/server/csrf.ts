import "server-only";
import { headers } from "next/headers";

/**
 * V1.50A — explicit same-origin check for credential mutations (register/login),
 * layered ON TOP of Next.js Server Actions' built-in Origin↔Host verification.
 *
 * Returns false when an `Origin` header is present but its host does not match the
 * request `Host` (a cross-site POST). A missing Origin is treated as same-origin
 * here because Next's framework-level guard already rejects genuine cross-site
 * Server Action invocations; this helper is defense-in-depth, not the sole barrier.
 */
export async function isSameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("host");
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
