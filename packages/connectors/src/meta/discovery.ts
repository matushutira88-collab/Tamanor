import { MetaGraphClient } from "./graph-client";

/**
 * Meta account discovery. After OAuth, we enumerate the Facebook Pages the user
 * granted access to and, for each, the linked Instagram Business account. The
 * caller persists the chosen Page/IG account as a ConnectedAccount.
 *
 * These are real Graph API reads and require a valid token. Guard on
 * configuration + a valid OAuth result before calling.
 */

export interface MetaDiscoveredPage {
  pageId: string;
  name: string;
  /** Per-page access token (Meta returns one per page). */
  pageAccessToken: string;
  category?: string;
  /** Page tasks the connected user holds (e.g. MANAGE, MODERATE) — used to gate live actions. */
  tasks?: string[];
  igBusinessId?: string;
  igUsername?: string;
}

interface RawPage {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  tasks?: string[];
  instagram_business_account?: { id: string; username?: string };
}

/** List Pages (and their linked IG Business accounts) for a user token. */
export async function discoverMetaAccounts(
  userAccessToken: string,
  appSecret?: string,
): Promise<MetaDiscoveredPage[]> {
  const client = new MetaGraphClient(userAccessToken, appSecret);
  const data = await client.get<{ data: RawPage[] }>("me/accounts", {
    fields:
      "id,name,access_token,category,tasks,instagram_business_account{id,username}",
    limit: "50",
  });
  return (data.data ?? []).map((p) => ({
    pageId: p.id,
    name: p.name,
    pageAccessToken: p.access_token,
    category: p.category,
    tasks: p.tasks,
    igBusinessId: p.instagram_business_account?.id,
    igUsername: p.instagram_business_account?.username,
  }));
}

/** Granted vs declined permission names for a user token. */
export interface MetaPermissionsResult {
  granted: string[];
  declined: string[];
}

/**
 * Read `/me/permissions` — the authoritative record of which scopes the user
 * actually granted (Facebook Login for Business lets users decline individual
 * permissions). Purely diagnostic: it reveals whether e.g. `pages_show_list`
 * was granted, distinguishing a permission gap from a generic API error. Never
 * throws for a caller that only wants best-effort diagnostics — callers may
 * catch. No token is ever logged.
 */
export async function fetchMetaPermissions(
  userAccessToken: string,
  appSecret?: string,
): Promise<MetaPermissionsResult> {
  const client = new MetaGraphClient(userAccessToken, appSecret);
  const data = await client.get<{ data: { permission: string; status: string }[] }>(
    "me/permissions",
  );
  const granted: string[] = [];
  const declined: string[] = [];
  for (const row of data.data ?? []) {
    (row.status === "granted" ? granted : declined).push(row.permission);
  }
  return { granted, declined };
}

/**
 * META-EXTERNAL-ACCESS-V2 — read the APP-SCOPED user id of the identity that completed this OAuth flow
 * (`GET /me?fields=id`). This is the only value Meta's deauthorize / data-deletion callbacks send, so it is
 * what credential authorization provenance must be keyed on.
 *
 * Resolved SERVER-SIDE from the provider with the just-exchanged user token — never accepted from the browser.
 * The id is an opaque per-app subject identifier: it is not a token, is never rendered, logged or placed in a
 * URL, and reveals nothing about the person outside this app. Returns null when Graph does not supply it; the
 * caller then stores no provenance and the credential is simply not attributable to any identity.
 */
export async function fetchMetaAuthorizingUserId(
  userAccessToken: string,
  appSecret?: string,
): Promise<string | null> {
  const client = new MetaGraphClient(userAccessToken, appSecret);
  const me = await client.get<{ id?: string }>("me", { fields: "id" });
  const id = typeof me?.id === "string" ? me.id.trim() : "";
  return id.length > 0 && id.length <= 64 ? id : null;
}
