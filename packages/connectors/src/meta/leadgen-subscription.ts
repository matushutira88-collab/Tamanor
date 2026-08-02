/**
 * BUSINESS-LEADGEN-SUBSCRIPTION-V1 — Facebook **Page-level app subscription** for the `leadgen` webhook field.
 *
 * A Meta app that is subscribed to the `leadgen` webhook topic still receives NOTHING for a given Page until that
 * Page is itself subscribed to the app via `/{page-id}/subscribed_apps`. Without it Meta's Lead Ads Testing Tool
 * reports "Selected page has no app associated with it" and no `leadgen` webhook is ever delivered.
 *
 * This module is the single place that reads and repairs that Page↔app subscription. It reuses the existing Meta
 * primitives (central {@link metaFetch} transport, Graph base/version, `appsecret_proof`) and is fully injectable
 * behind {@link LeadgenSubscriptionTransport} so it is testable with NO network.
 *
 * SECURITY: the Page access token, the app secret and the derived `appsecret_proof` are only ever placed in the
 * request (body/query). They are NEVER logged, returned, embedded in an error, or included in any result. Raw Meta
 * response bodies are never returned either — only a classified, id-free error code.
 */
import { META_GRAPH_BASE } from "./oauth";
import { appsecretProof } from "./graph-client";
import { metaFetch } from "./http";

/** The webhook field that carries Lead Ads leads. */
export const LEADGEN_FIELD = "leadgen";

/** One app currently subscribed to a Page, with the fields it is subscribed to. */
export interface PageAppSubscription {
  /** The Meta app id the Page is subscribed to. */
  appId: string;
  /** The webhook fields that subscription currently covers. */
  subscribedFields: string[];
}

/** A classified, secret-free failure code. Never carries a token/proof/id/raw body. */
export type LeadgenSubscriptionErrorCode =
  | "token_expired" | "permission" | "rate_limit" | "not_found" | "network" | "invalid_response" | "generic";

/** Result of reading `/{pageId}/subscribed_apps`. */
export type PageSubscriptionsRead =
  | { ok: true; apps: PageAppSubscription[] }
  | { ok: false; errorCode: LeadgenSubscriptionErrorCode };

/** Result of writing `/{pageId}/subscribed_apps`. */
export type PageSubscriptionWrite =
  | { ok: true }
  | { ok: false; errorCode: LeadgenSubscriptionErrorCode };

/**
 * The isolated network seam. Implementations MUST NOT log the token/proof and MUST NOT surface raw Meta bodies.
 */
export interface LeadgenSubscriptionTransport {
  readonly name: string;
  /** GET /{pageId}/subscribed_apps */
  getSubscribedApps(pageId: string, pageAccessToken: string): Promise<PageSubscriptionsRead>;
  /** POST /{pageId}/subscribed_apps with the FULL merged `subscribed_fields` set. */
  subscribeApp(pageId: string, pageAccessToken: string, subscribedFields: string[]): Promise<PageSubscriptionWrite>;
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — the decision logic, unit-testable on its own)
// ---------------------------------------------------------------------------

/** The subscription entry for `appId`, or null when this app is not subscribed to the Page at all. */
export function findAppSubscription(apps: readonly PageAppSubscription[], appId: string): PageAppSubscription | null {
  return apps.find((a) => a.appId === appId) ?? null;
}

/** True only when THIS app is subscribed to the Page AND that subscription includes `leadgen`. */
export function hasLeadgenSubscription(apps: readonly PageAppSubscription[], appId: string): boolean {
  return (findAppSubscription(apps, appId)?.subscribedFields ?? []).includes(LEADGEN_FIELD);
}

/**
 * Merge `leadgen` into the app's CURRENT subscribed fields. Existing fields are always preserved (a POST to
 * `subscribed_apps` REPLACES the set, so dropping a field here would silently unsubscribe a working capability),
 * and `leadgen` is added at most once. Order of the existing fields is kept; duplicates are collapsed.
 */
export function mergeSubscribedFields(existing: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of existing) {
    const field = typeof f === "string" ? f.trim() : "";
    if (field && !out.includes(field)) out.push(field);
  }
  if (!out.includes(LEADGEN_FIELD)) out.push(LEADGEN_FIELD);
  return out;
}

// ---------------------------------------------------------------------------
// Real Graph transport
// ---------------------------------------------------------------------------

/** Classify a Graph failure into a stable, secret-free code. Never inspects/returns the body verbatim. */
function classify(status: number, code?: number): LeadgenSubscriptionErrorCode {
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) return "rate_limit";
  if (code === 190 || code === 463 || code === 467) return "token_expired";
  if (code === 10 || code === 200 || code === 803 || status === 403) return "permission";
  if (code === 100 || status === 404) return "not_found";
  if (status >= 500) return "generic";
  return "generic";
}

/** Read only the Graph error CODE from a response. Any parse problem is swallowed (never surfaced). */
async function errorCodeOf(res: Response): Promise<number | undefined> {
  try {
    const body = (await res.json()) as { error?: { code?: number; error_subcode?: number } };
    return body.error?.code ?? body.error?.error_subcode;
  } catch {
    return undefined;
  }
}

/** `appsecret_proof` for a Page token, when an app secret is configured. The proof itself is a SECRET. */
function proofOf(accessToken: string): string | undefined {
  const secret = process.env.META_APP_SECRET?.trim();
  return secret ? appsecretProof(accessToken, secret) : undefined;
}

/**
 * Live Graph implementation. Reads and writes `/{pageId}/subscribed_apps` with the Page token +
 * `appsecret_proof`. The POST is NOT retried blindly at the transport level for correctness of the
 * caller's verify-after-write step — {@link metaFetch} still applies its bounded 429/5xx retry, which is
 * safe here because subscribing is idempotent.
 */
export class GraphLeadgenSubscriptionTransport implements LeadgenSubscriptionTransport {
  readonly name = "graph";

  async getSubscribedApps(pageId: string, pageAccessToken: string): Promise<PageSubscriptionsRead> {
    const params = new URLSearchParams({ fields: "subscribed_fields", access_token: pageAccessToken });
    const proof = proofOf(pageAccessToken);
    if (proof) params.set("appsecret_proof", proof);
    const url = `${META_GRAPH_BASE}/${encodeURIComponent(pageId)}/subscribed_apps?${params.toString()}`;
    try {
      const res = await metaFetch(url, { category: "graph_read", retryable: true });
      if (!res.ok) return { ok: false, errorCode: classify(res.status, await errorCodeOf(res)) };
      let body: { data?: Array<{ id?: unknown; subscribed_fields?: unknown }> };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        return { ok: false, errorCode: "invalid_response" };
      }
      if (!Array.isArray(body?.data)) return { ok: false, errorCode: "invalid_response" };
      const apps: PageAppSubscription[] = [];
      for (const node of body.data) {
        const appId = typeof node?.id === "string" ? node.id : null;
        if (!appId) continue;
        const fields = Array.isArray(node.subscribed_fields)
          ? node.subscribed_fields.filter((f): f is string => typeof f === "string")
          : [];
        apps.push({ appId, subscribedFields: fields });
      }
      return { ok: true, apps };
    } catch {
      return { ok: false, errorCode: "network" };
    }
  }

  async subscribeApp(pageId: string, pageAccessToken: string, subscribedFields: string[]): Promise<PageSubscriptionWrite> {
    const url = `${META_GRAPH_BASE}/${encodeURIComponent(pageId)}/subscribed_apps`;
    const body = new URLSearchParams({ subscribed_fields: subscribedFields.join(","), access_token: pageAccessToken });
    const proof = proofOf(pageAccessToken);
    if (proof) body.set("appsecret_proof", proof);
    try {
      // Subscribing is idempotent (the same merged field set can be POSTed repeatedly), so the bounded
      // transport-level retry for 429/5xx is safe here.
      const res = await metaFetch(url, { method: "POST", body, category: "side_effect", retryable: true });
      if (res.ok) return { ok: true };
      return { ok: false, errorCode: classify(res.status, await errorCodeOf(res)) };
    } catch {
      return { ok: false, errorCode: "network" };
    }
  }
}

/** Options for the deterministic test transport. */
export interface MockLeadgenSubscriptionOptions {
  /** The app id a POST is attributed to (in the real API this is the app the token belongs to). */
  appId: string;
  /** Initial Page↔app subscriptions. */
  apps?: PageAppSubscription[];
  failRead?: LeadgenSubscriptionErrorCode;
  failWrite?: LeadgenSubscriptionErrorCode;
  /** When true a 200 POST does NOT take effect — models a write that silently didn't apply. */
  writeIsNoop?: boolean;
}

/** Deterministic in-memory transport for tests. Makes NO network call and records every read/write. */
export class MockLeadgenSubscriptionTransport implements LeadgenSubscriptionTransport {
  readonly name = "mock";
  /** Every POST performed, in order (field sets exactly as they were sent). */
  readonly writes: Array<{ pageId: string; subscribedFields: string[] }> = [];
  /** Every GET performed, in order (the page id it targeted). */
  readonly reads: string[] = [];
  /** Current Page↔app subscription state, mutated exactly the way Graph mutates it. */
  private readonly apps: PageAppSubscription[];

  constructor(private readonly opts: MockLeadgenSubscriptionOptions) {
    this.apps = (opts.apps ?? []).map((a) => ({ appId: a.appId, subscribedFields: [...a.subscribedFields] }));
  }

  async getSubscribedApps(pageId: string): Promise<PageSubscriptionsRead> {
    this.reads.push(pageId);
    if (this.opts.failRead) return { ok: false, errorCode: this.opts.failRead };
    return { ok: true, apps: this.apps.map((a) => ({ appId: a.appId, subscribedFields: [...a.subscribedFields] })) };
  }

  async subscribeApp(pageId: string, _token: string, subscribedFields: string[]): Promise<PageSubscriptionWrite> {
    this.writes.push({ pageId, subscribedFields: [...subscribedFields] });
    if (this.opts.failWrite) return { ok: false, errorCode: this.opts.failWrite };
    if (!this.opts.writeIsNoop) {
      // Model Graph: the POST REPLACES this app's subscribed field set (that is why the caller merges).
      const existing = this.apps.find((a) => a.appId === this.opts.appId);
      if (existing) existing.subscribedFields = [...subscribedFields];
      else this.apps.push({ appId: this.opts.appId, subscribedFields: [...subscribedFields] });
    }
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Read + ensure (the two exported operations)
// ---------------------------------------------------------------------------

export interface PageLeadgenSubscriptionInput {
  /** The Facebook PAGE id (never an Instagram business id). */
  pageId: string;
  /** Page access token — used only for the request; never logged or returned. */
  pageAccessToken: string;
  /** The current `META_APP_ID` this deployment runs as. */
  appId: string;
}

/** Truthful view of the Page↔app subscription for THIS app. */
export interface PageAppSubscriptionsResult {
  ok: true;
  /** Whether THIS app appears in the Page's subscribed apps at all. */
  appSubscribed: boolean;
  /** The fields THIS app is subscribed to (empty when the app is absent). */
  subscribedFields: string[];
  /** Whether THIS app's subscription includes `leadgen`. */
  leadgenSubscribed: boolean;
}
export type GetPageAppSubscriptionsResult =
  | PageAppSubscriptionsResult
  | { ok: false; errorCode: LeadgenSubscriptionErrorCode };

/**
 * Read `/{pageId}/subscribed_apps` and report — for the CURRENT app only — whether it is subscribed and
 * whether that subscription includes `leadgen`. Read-only: never writes, never mutates anything.
 */
export async function getPageAppSubscriptions(
  input: PageLeadgenSubscriptionInput,
  opts?: { transport?: LeadgenSubscriptionTransport },
): Promise<GetPageAppSubscriptionsResult> {
  const transport = opts?.transport ?? new GraphLeadgenSubscriptionTransport();
  const read = await transport.getSubscribedApps(input.pageId, input.pageAccessToken);
  if (!read.ok) return { ok: false, errorCode: read.errorCode };
  const mine = findAppSubscription(read.apps, input.appId);
  return {
    ok: true,
    appSubscribed: mine !== null,
    subscribedFields: mine ? [...mine.subscribedFields] : [],
    leadgenSubscribed: hasLeadgenSubscription(read.apps, input.appId),
  };
}

export interface EnsurePageLeadgenSubscriptionResult {
  /** TRUE only when a POST-verification READ proved this app is subscribed AND includes `leadgen`. */
  verified: boolean;
  /** True when `leadgen` was already present before this call (no write was needed). */
  alreadySubscribed: boolean;
  /** True when a subscribe POST was actually performed. */
  wrote: boolean;
  /** Classified, secret-free failure code when `verified` is false. */
  errorCode?: LeadgenSubscriptionErrorCode;
}

/**
 * Ensure the Page is subscribed to THIS app for the `leadgen` field, and VERIFY it afterwards.
 *
 * 1. read `/{pageId}/subscribed_apps`
 * 2. locate the current `META_APP_ID`
 * 3. preserve every field that app is already subscribed to
 * 4. add `leadgen` only when missing (already-correct → no write at all, fully idempotent)
 * 5. POST the MERGED set
 * 6. read `/{pageId}/subscribed_apps` again
 * 7. report `verified: true` ONLY when the re-read shows this app present AND carrying `leadgen`
 *
 * Success is never assumed from a 200 on the POST — only the verification read can set `verified`.
 */
export async function ensurePageLeadgenSubscription(
  input: PageLeadgenSubscriptionInput,
  opts?: { transport?: LeadgenSubscriptionTransport },
): Promise<EnsurePageLeadgenSubscriptionResult> {
  const transport = opts?.transport ?? new GraphLeadgenSubscriptionTransport();
  if (!input.pageId || !input.appId || !input.pageAccessToken) {
    return { verified: false, alreadySubscribed: false, wrote: false, errorCode: "generic" };
  }

  // 1–2) current state for THIS app.
  const before = await transport.getSubscribedApps(input.pageId, input.pageAccessToken);
  if (!before.ok) return { verified: false, alreadySubscribed: false, wrote: false, errorCode: before.errorCode };
  const mine = findAppSubscription(before.apps, input.appId);
  if (mine && mine.subscribedFields.includes(LEADGEN_FIELD)) {
    // Idempotent: already correct — no write, and the read itself is the verification.
    return { verified: true, alreadySubscribed: true, wrote: false };
  }

  // 3–5) preserve everything already subscribed, add `leadgen` once, POST the merged set.
  const merged = mergeSubscribedFields(mine?.subscribedFields ?? []);
  const write = await transport.subscribeApp(input.pageId, input.pageAccessToken, merged);
  if (!write.ok) return { verified: false, alreadySubscribed: false, wrote: true, errorCode: write.errorCode };

  // 6–7) VERIFY — a 200 on the POST is not proof.
  const after = await transport.getSubscribedApps(input.pageId, input.pageAccessToken);
  if (!after.ok) return { verified: false, alreadySubscribed: false, wrote: true, errorCode: after.errorCode };
  const verified = hasLeadgenSubscription(after.apps, input.appId);
  return { verified, alreadySubscribed: false, wrote: true, ...(verified ? {} : { errorCode: "generic" as const }) };
}
