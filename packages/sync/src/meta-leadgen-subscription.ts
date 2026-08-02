/**
 * BUSINESS-LEADGEN-SUBSCRIPTION-V1 — tenant-scoped orchestration of the Facebook Page ↔ app `leadgen`
 * subscription.
 *
 * ROOT CAUSE this addresses: Guardora already processes incoming `leadgen` webhooks, but a Page delivers
 * them ONLY once that Page is subscribed to the current Meta app via `/{page-id}/subscribed_apps`. Nothing
 * in connect/reconnect ever performed that subscription, so Meta's Lead Ads Testing Tool reports "Selected
 * page has no app associated with it" and `/dashboard/contacts` stays empty.
 *
 * Shape: read (tenant tx) → provider HTTP (NO open transaction) → write (tenant tx). Idempotent: an
 * already-correct Page performs no write at all. Instagram is NEVER subscribed — the guard is explicit.
 *
 * SECURITY: the Page token is resolved from the vault, handed straight to the transport, and never logged,
 * returned, or embedded in an error. Results and ops events carry classified codes only — no token, no app
 * secret, no proof, no ciphertext, no raw Meta body, no tenant/account/Page identifier.
 */
import { withTenantDb, resolveMetaAccessTokenSafe, ActorKind } from "@guardora/db";
import { emitOpsEvent } from "@guardora/core";
import {
  ensurePageLeadgenSubscription, GraphLeadgenSubscriptionTransport,
  type LeadgenSubscriptionTransport,
} from "@guardora/connectors";

/** Persisted, truthful subscription status. `unavailable` = the provider check failed; state is UNKNOWN. */
export const LEADGEN_SUBSCRIPTION_VERIFIED = "verified";
export const LEADGEN_SUBSCRIPTION_NOT_SUBSCRIBED = "not_subscribed";
export const LEADGEN_SUBSCRIPTION_UNAVAILABLE = "unavailable";
export type LeadgenSubscriptionStatus =
  | typeof LEADGEN_SUBSCRIPTION_VERIFIED
  | typeof LEADGEN_SUBSCRIPTION_NOT_SUBSCRIBED
  | typeof LEADGEN_SUBSCRIPTION_UNAVAILABLE;

/** Why an ensure attempt did not end in a verified subscription. All values are safe to surface. */
export type LeadgenEnsureReason =
  | "account_not_found"       // no such account in THIS tenant
  | "not_a_facebook_page"     // e.g. an Instagram account id — never subscribed
  | "account_inactive"        // not an active connection
  | "no_page_id"              // the account carries no Facebook Page id
  | "app_not_configured"      // META_APP_ID is not set in this deployment
  | "no_credential"           // no usable vault credential (reconnect required)
  | "provider_error";         // the Graph read/write failed or verification did not confirm

export interface EnsureAccountLeadgenSubscriptionResult {
  /** True ONLY when a post-write read proved this app is subscribed to the Page and carries `leadgen`. */
  verified: boolean;
  /** The status persisted on the account. */
  status: LeadgenSubscriptionStatus;
  /** True when `leadgen` was already in place (no write performed — the idempotent path). */
  alreadySubscribed: boolean;
  /** True when a subscribe POST was actually performed. */
  wrote: boolean;
  /** Safe reason when `verified` is false. Never contains ids or secrets. */
  reason?: LeadgenEnsureReason;
}

/** The minimal account shape the orchestration needs. Contains NO secret. */
export interface LeadgenSubscriptionAccount {
  id: string;
  tenantId: string;
  brandId: string;
  platform: string;
  status: string;
  externalId: string;
  pageId: string | null;
  longLivedToken: string | null;
  accessToken: string | null;
  /** Last persisted Page-level subscription status. Absent/null = never checked (treated as NOT verified). */
  leadgenSubscriptionStatus?: string | null;
}

/**
 * Injectable side-effect ports. The defaults are the real tenant-scoped (RLS) DB reads/writes and the real
 * vault resolver; tests substitute deterministic in-memory implementations so no database is required.
 */
export interface LeadgenSubscriptionPorts {
  loadAccount(tenantId: string, accountId: string): Promise<LeadgenSubscriptionAccount | null>;
  resolveToken(account: LeadgenSubscriptionAccount): Promise<string | null>;
  persist(account: LeadgenSubscriptionAccount, status: LeadgenSubscriptionStatus, checkedAt: Date, verified: boolean): Promise<void>;
}

/** Only a Facebook Page is ever eligible — an Instagram account id must NEVER be sent to subscribed_apps. */
const FACEBOOK_PAGE = "facebook_page";
const ACTIVE = "active";

export const defaultLeadgenSubscriptionPorts: LeadgenSubscriptionPorts = {
  loadAccount: (tenantId, accountId) =>
    // Tenant-scoped (RLS): an account belonging to another tenant simply does not resolve.
    withTenantDb(tenantId, (db) => db.connectedAccount.findFirst({
      where: { id: accountId, tenantId },
      select: { id: true, tenantId: true, brandId: true, platform: true, status: true, externalId: true, pageId: true, longLivedToken: true, accessToken: true, leadgenSubscriptionStatus: true },
    })),
  resolveToken: (account) => resolveMetaAccessTokenSafe(account),
  persist: async (account, status, checkedAt, verified) => {
    await withTenantDb(account.tenantId, async (db) => {
      // Never resurrect a row the user already disconnected.
      const res = await db.connectedAccount.updateMany({
        where: { id: account.id, status: { not: "disconnected" as never } },
        data: { leadgenSubscriptionStatus: status, leadgenSubscriptionCheckedAt: checkedAt },
      });
      if (res.count === 0) return;
      await db.auditLog.create({
        data: {
          tenantId: account.tenantId, brandId: account.brandId,
          event: verified ? "meta.leadgen.subscription_verified" : "meta.leadgen.subscription_failed",
          actorKind: ActorKind.system, targetType: "connected_account", targetId: account.id,
          // Classified fields only — no token, no proof, no raw provider body.
          metadata: { platform: FACEBOOK_PAGE, status },
        },
      });
    });
  },
};

function failure(reason: LeadgenEnsureReason, status: LeadgenSubscriptionStatus): EnsureAccountLeadgenSubscriptionResult {
  return { verified: false, status, alreadySubscribed: false, wrote: false, reason };
}

/**
 * Ensure + verify the `leadgen` Page subscription for ONE tenant-scoped connected account, then persist the
 * truthful status. Safe to call repeatedly: an already-subscribed Page performs no provider write.
 *
 * Guards (in order): the account must exist IN THIS TENANT, be a Facebook Page (never Instagram), be active,
 * carry a Page id, and the deployment must have a configured `META_APP_ID` and a usable vault credential.
 * A guard failure persists nothing and never throws — the caller decides how to surface it.
 */
export async function ensureAccountLeadgenSubscription(
  tenantId: string,
  accountId: string,
  opts?: {
    transport?: LeadgenSubscriptionTransport; ports?: LeadgenSubscriptionPorts; appId?: string; now?: Date;
    /**
     * Connect/reconnect only: when the account ALREADY carries a verified subscription, skip the provider
     * round-trip entirely (a Page↔app subscription is not token-bound, so a reconnect cannot invalidate it).
     * The explicit repair action never sets this — it must always re-read and re-verify.
     */
    skipWhenVerified?: boolean;
  },
): Promise<EnsureAccountLeadgenSubscriptionResult> {
  const ports = opts?.ports ?? defaultLeadgenSubscriptionPorts;
  const now = opts?.now ?? new Date();

  // Phase 1 — tenant read (short).
  const account = await ports.loadAccount(tenantId, accountId);
  if (!account) return failure("account_not_found", LEADGEN_SUBSCRIPTION_UNAVAILABLE);
  // HARD GUARD: only a Facebook Page is ever subscribed. An Instagram business account id must never reach
  // /{id}/subscribed_apps — nothing below this line can be reached with a non-Page account.
  if (account.platform !== FACEBOOK_PAGE) return failure("not_a_facebook_page", LEADGEN_SUBSCRIPTION_UNAVAILABLE);
  if (account.status !== ACTIVE) return failure("account_inactive", LEADGEN_SUBSCRIPTION_UNAVAILABLE);

  // Reconnect fast-path: an already-verified Page needs no provider call and no write.
  if (opts?.skipWhenVerified && account.leadgenSubscriptionStatus === LEADGEN_SUBSCRIPTION_VERIFIED) {
    return { verified: true, status: LEADGEN_SUBSCRIPTION_VERIFIED, alreadySubscribed: true, wrote: false };
  }

  const pageId = account.pageId ?? account.externalId;
  if (!pageId) return failure("no_page_id", LEADGEN_SUBSCRIPTION_UNAVAILABLE);

  const appId = (opts?.appId ?? process.env.META_APP_ID ?? "").trim();
  if (!appId) return failure("app_not_configured", LEADGEN_SUBSCRIPTION_UNAVAILABLE);

  const token = await ports.resolveToken(account);
  if (!token) return failure("no_credential", LEADGEN_SUBSCRIPTION_UNAVAILABLE);

  // Phase 2 — provider HTTP, strictly OUTSIDE any transaction.
  const transport = opts?.transport ?? new GraphLeadgenSubscriptionTransport();
  const res = await ensurePageLeadgenSubscription({ pageId, pageAccessToken: token, appId }, { transport });

  // Phase 3 — tenant write of the truthful status.
  const status: LeadgenSubscriptionStatus = res.verified
    ? LEADGEN_SUBSCRIPTION_VERIFIED
    : res.errorCode === "network" || res.errorCode === "rate_limit"
      ? LEADGEN_SUBSCRIPTION_UNAVAILABLE
      : LEADGEN_SUBSCRIPTION_NOT_SUBSCRIBED;
  await ports.persist(account, status, now, res.verified);

  if (res.verified) {
    emitOpsEvent("business.meta_leadgen_subscription_verified", { operation: "meta_leadgen_subscribe", result: res.alreadySubscribed ? "duplicate" : "accepted" });
  } else {
    emitOpsEvent("business.meta_leadgen_subscription_failed", { operation: "meta_leadgen_subscribe", reason: res.errorCode ?? "provider_error" });
  }

  return {
    verified: res.verified,
    status,
    alreadySubscribed: res.alreadySubscribed,
    wrote: res.wrote,
    ...(res.verified ? {} : { reason: "provider_error" as const }),
  };
}

/** The granted Graph permission that makes a `leadgen` subscription meaningful. */
export const LEADS_RETRIEVAL_PERMISSION = "leads_retrieval";

/**
 * Connect/reconnect hook. Runs the ensure ONLY when `leads_retrieval` was actually granted, and NEVER lets a
 * subscription failure affect the connection itself: the Facebook account, its vault credential, comment sync
 * and monitoring are all already committed and are left untouched. Returns whether Lead Ads setup succeeded so
 * the caller can surface a Lead-Ads-only notice; it never throws.
 */
export async function ensureLeadgenSubscriptionOnConnect(
  tenantId: string,
  pageAccountId: string,
  grantedPermissions: readonly string[],
  opts?: { transport?: LeadgenSubscriptionTransport; ports?: LeadgenSubscriptionPorts; appId?: string; now?: Date },
): Promise<{ attempted: boolean; verified: boolean; status: LeadgenSubscriptionStatus | null }> {
  if (!grantedPermissions.includes(LEADS_RETRIEVAL_PERMISSION)) return { attempted: false, verified: false, status: null };
  try {
    // Reconnect retries ONLY Pages that are not already verified — an already-verified Page costs no Graph call.
    const res = await ensureAccountLeadgenSubscription(tenantId, pageAccountId, { ...opts, skipWhenVerified: true });
    return { attempted: true, verified: res.verified, status: res.status };
  } catch {
    // Lead Ads setup is strictly best-effort: it must never break an otherwise-successful connect. The Page
    // stays connected, its vault credential stays, comment sync and monitoring are untouched.
    emitOpsEvent("business.meta_leadgen_subscription_failed", { operation: "meta_leadgen_subscribe", reason: "error" });
    return { attempted: true, verified: false, status: LEADGEN_SUBSCRIPTION_UNAVAILABLE };
  }
}
