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
  igBusinessId?: string;
  igUsername?: string;
}

interface RawPage {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  instagram_business_account?: { id: string; username?: string };
}

/** List Pages (and their linked IG Business accounts) for a user token. */
export async function discoverMetaAccounts(
  userAccessToken: string,
): Promise<MetaDiscoveredPage[]> {
  const client = new MetaGraphClient(userAccessToken);
  const data = await client.get<{ data: RawPage[] }>("me/accounts", {
    fields:
      "id,name,access_token,category,instagram_business_account{id,username}",
    limit: "50",
  });
  return (data.data ?? []).map((p) => ({
    pageId: p.id,
    name: p.name,
    pageAccessToken: p.access_token,
    category: p.category,
    igBusinessId: p.instagram_business_account?.id,
    igUsername: p.instagram_business_account?.username,
  }));
}
