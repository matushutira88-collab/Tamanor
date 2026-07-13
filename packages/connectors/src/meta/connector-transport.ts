import { MetaGraphClient } from "./graph-client";
import type { MetaDiscoveredPage } from "./discovery";
import { discoverMetaAccounts } from "./discovery";

/**
 * V1.38 — the isolated network seam for the UNIFIED Meta connector (Facebook Page +
 * linked Instagram Professional account). Production uses {@link GraphMetaConnectorTransport}
 * (real Graph GET reads, gated by config); tests inject {@link MockMetaConnectorTransport}
 * so the production sync/link CODE runs against a real DB with NO real network call and
 * NO fake persisted data. Implementations MUST NOT log the access token.
 */

/** Page-token + asset state read via GET /{pageId}. `ok:false` = the token/page failed. */
export type MetaPageState =
  | {
      ok: true;
      pageId: string;
      pageName?: string;
      /** True when the token can moderate/manage the Page (task MODERATE/MANAGE). */
      canManage: boolean;
      /** Linked Instagram Business account, or null when the Page has none now. */
      igBusinessId: string | null;
      igUsername?: string;
    }
  | { ok: false; errorCode: string };

/** Instagram Business account state read via GET /{igId}. */
export type MetaInstagramState =
  | { ok: true; igBusinessId: string; username?: string }
  | { ok: false; errorCode: string };

export interface MetaConnectorTransport {
  readonly name: string;
  /** Enumerate the user's Pages + linked IG accounts (post-OAuth discovery). */
  discoverAssets(userAccessToken: string): Promise<MetaDiscoveredPage[]>;
  /** Validate a Page token and read its current name / manage-capability / IG link. */
  getPageState(pageId: string, accessToken: string): Promise<MetaPageState>;
  /** Validate an Instagram Business account is still reachable with this token. */
  getInstagramState(igBusinessId: string, accessToken: string): Promise<MetaInstagramState>;
}

/** Which Graph error codes indicate a moderation-capable page role. */
const MANAGE_TASKS = new Set(["MANAGE", "MODERATE", "CREATE_CONTENT"]);

function classifyErr(status: number, code?: number): string {
  if (code === 190 || code === 463 || code === 467) return "token_expired";
  if (code === 803 || code === 33 || status === 404) return "not_found";
  if (code === 10 || code === 200 || code === 3 || status === 403) return "permission";
  if (code === 4 || code === 17 || code === 32 || status === 429) return "rate_limit";
  return "generic";
}

/** Real Graph transport — read-only GETs only. Only used behind a live config gate. */
export class GraphMetaConnectorTransport implements MetaConnectorTransport {
  readonly name = "graph";

  discoverAssets(userAccessToken: string): Promise<MetaDiscoveredPage[]> {
    return discoverMetaAccounts(userAccessToken);
  }

  async getPageState(pageId: string, accessToken: string): Promise<MetaPageState> {
    const client = new MetaGraphClient(accessToken);
    try {
      const p = await client.get<{
        id?: string; name?: string;
        tasks?: string[];
        instagram_business_account?: { id: string; username?: string };
      }>(pageId, { fields: "id,name,tasks,instagram_business_account{id,username}" });
      return {
        ok: true,
        pageId: p.id ?? pageId,
        pageName: p.name,
        canManage: (p.tasks ?? []).some((t) => MANAGE_TASKS.has(t)),
        igBusinessId: p.instagram_business_account?.id ?? null,
        igUsername: p.instagram_business_account?.username,
      };
    } catch (e) {
      const detail = (e as { detail?: { status: number; code?: number } }).detail;
      return { ok: false, errorCode: detail ? classifyErr(detail.status, detail.code) : "network" };
    }
  }

  async getInstagramState(igBusinessId: string, accessToken: string): Promise<MetaInstagramState> {
    const client = new MetaGraphClient(accessToken);
    try {
      const ig = await client.get<{ id?: string; username?: string }>(igBusinessId, { fields: "id,username" });
      return { ok: true, igBusinessId: ig.id ?? igBusinessId, username: ig.username };
    } catch (e) {
      const detail = (e as { detail?: { status: number; code?: number } }).detail;
      return { ok: false, errorCode: detail ? classifyErr(detail.status, detail.code) : "network" };
    }
  }
}

/** Mock transport — NO network. Configurable state; records calls for assertions. */
export class MockMetaConnectorTransport implements MetaConnectorTransport {
  readonly name = "mock";
  readonly calls: string[] = [];
  constructor(
    private readonly state: {
      assets?: MetaDiscoveredPage[];
      page?: MetaPageState;
      instagram?: MetaInstagramState;
    } = {},
  ) {}

  async discoverAssets(): Promise<MetaDiscoveredPage[]> {
    this.calls.push("discoverAssets");
    return this.state.assets ?? [];
  }
  async getPageState(pageId: string): Promise<MetaPageState> {
    this.calls.push(`getPageState:${pageId}`);
    return this.state.page ?? { ok: true, pageId, pageName: "Mock Page", canManage: true, igBusinessId: null };
  }
  async getInstagramState(igBusinessId: string): Promise<MetaInstagramState> {
    this.calls.push(`getInstagramState:${igBusinessId}`);
    return this.state.instagram ?? { ok: true, igBusinessId, username: "mock_ig" };
  }
}
