import "server-only";
import { getMetaConfig } from "@guardora/config";
import {
  exchangeMetaCode, exchangeForLongLivedToken, discoverMetaAccounts,
  fetchMetaPermissions, fetchMetaAuthorizingUserId, MetaGraphError,
  type MetaPermissionsResult,
} from "@guardora/connectors";
import { emitOpsEvent } from "@guardora/core";
import { encryptToken, withTenant } from "@guardora/db";
import { classifyMetaDiscoveryError, classifyMetaEmptyPages } from "./meta-callback-classify";

/**
 * M7 — the Meta OAuth exchange + discovery, extracted so BOTH callback branches
 * run the identical code.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT MOVED. This is the body of the Meta callback with the Next transport peeled
 * off: no cookies, no redirects, no `getSession`. Every step is preserved in order
 * — short-lived exchange, long-lived upgrade, `/me/permissions`, the app-scoped
 * authorizing user id, `/me/accounts` discovery, the empty/error classification,
 * and the encrypted `MetaOnboardingSession` write.
 *
 * The web callback keeps its cookie + redirect vocabulary and calls this; the
 * mobile branch stores a flow status and deep-links, and calls this. Neither owns a
 * private copy of the provider pipeline.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * SECRETS: the app secret is read from the server runtime and used for the exchange
 * and for `appsecret_proof`. Neither it, the authorization code, nor any token ever
 * reaches a return value, a log line, an audit record or a redirect.
 */

const ONBOARDING_TTL_MS = 10 * 60 * 1000;

/**
 * Structured, token-free diagnostics. NEVER contains an access token, an
 * authorization code, an app secret, or a full request URL — only failure
 * classification plus Meta's own token-free error metadata.
 */
function logDiag(fields: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.warn("[meta-oauth]", JSON.stringify({ scope: "connectors/meta/exchange", ...fields }));
}

/** Safe (token-free) fields from a Meta Graph error, for logging + classification. */
function metaErrFields(err: unknown): {
  httpStatus?: number; metaCode?: number; metaSubcode?: number; metaType?: string;
  kind: string; fbtraceId?: string; metaMessage?: string;
} {
  if (err instanceof MetaGraphError) {
    const d = err.detail;
    return {
      httpStatus: d.status, metaCode: d.code, metaSubcode: d.subcode, metaType: d.type,
      kind: d.kind, fbtraceId: d.fbtraceId, metaMessage: d.metaMessage,
    };
  }
  return { kind: "generic" };
}

const safeErr = (err: unknown): string => (err instanceof Error ? err.message : "unknown_error");

/**
 * The outcome of a Meta authorization.
 *
 * `ok` means the provider grant succeeded AND discovery found Pages — it does NOT
 * mean anything is connected. A connection only exists after a selection, which is
 * why the success shape carries an onboarding id rather than an account id.
 */
export type MetaExchangeResult =
  | { ok: true; onboardingId: string; pageCount: number; withInstagram: number }
  | { ok: false; reason: string };

/**
 * Run the Meta OAuth exchange and discovery for an already-authorized actor.
 *
 * The caller has already established WHO this is — a web cookie session, or a
 * mobile `ConnectorOAuthFlow` resolved from the OAuth state. This function never
 * authenticates anyone.
 */
export async function runMetaOAuthExchange(input: {
  code: string;
  tenantId: string;
  userId: string;
  brandId: string;
}): Promise<MetaExchangeResult> {
  const meta = getMetaConfig();
  if (!meta.configured) return { ok: false, reason: "config_missing" };

  const cfg = {
    appId: meta.appId!,
    appSecret: meta.appSecret!,
    redirectUri: meta.redirectUri!,
  };

  // 1) Short-lived token exchange, then upgrade to a long-lived token (~60d).
  let token;
  try {
    const shortLived = await exchangeMetaCode(cfg, input.code);
    token = await exchangeForLongLivedToken(cfg, shortLived.accessToken);
    logDiag({ step: "token_exchange", ok: true });
  } catch (err) {
    // Safe-fail the whole onboarding — no account is created.
    logDiag({ step: "token_exchange", ok: false, message: safeErr(err) });
    return { ok: false, reason: "token_exchange_failed" };
  }

  // 1b) Permissions diagnostic (best-effort, non-fatal). `/me/permissions` is the
  //     authoritative record of what the user actually granted — a declined/absent
  //     `pages_show_list` makes `/me/accounts` return an error or an empty list,
  //     which lets us distinguish a permission gap from a generic API error.
  let perms: MetaPermissionsResult = { granted: [], declined: [] };
  let permsOk = false;
  try {
    perms = await fetchMetaPermissions(token.accessToken, cfg.appSecret);
    permsOk = true;
    logDiag({ step: "me/permissions", ok: true, granted: perms.granted, declined: perms.declined });
  } catch (err) {
    logDiag({ step: "me/permissions", ok: false, ...metaErrFields(err) });
  }
  const hasPagesShowList = perms.granted.includes("pages_show_list");

  // 1c) The APP-SCOPED user id of the identity completing this flow, read from Graph
  //     (never from the browser) and carried into credential provenance at confirm
  //     time. Best-effort: absence means the credential records no provenance.
  let authorizingProviderUserId: string | null = null;
  try {
    authorizingProviderUserId = await fetchMetaAuthorizingUserId(token.accessToken, cfg.appSecret);
    logDiag({ step: "me/id", ok: true, resolved: authorizingProviderUserId !== null });
  } catch (err) {
    logDiag({ step: "me/id", ok: false, ...metaErrFields(err) });
  }

  // 2) Account discovery.
  let pages;
  try {
    pages = await discoverMetaAccounts(token.accessToken, cfg.appSecret);
    logDiag({ step: "me/accounts", ok: true, accountsCount: pages.length });
  } catch (err) {
    // Distinguish a Meta API error (especially a permission error) from a generic
    // failure — NEVER report "no pages" for what is actually an API error.
    const f = metaErrFields(err);
    logDiag({ step: "me/accounts", ok: false, ...f });
    emitOpsEvent("oauth.discovery_failed", {
      platform: "meta", httpStatus: f.httpStatus, kind: f.kind, metaCode: f.metaCode, metaSubcode: f.metaSubcode,
    });
    return { ok: false, reason: classifyMetaDiscoveryError(f.kind, permsOk, hasPagesShowList) };
  }
  if (pages.length === 0) {
    // An empty (HTTP 200) list is a genuine "no Pages" unless /me/permissions
    // CONFIRMS pages_show_list was declined.
    const reason = classifyMetaEmptyPages(permsOk, hasPagesShowList);
    logDiag({ step: "me/accounts", ok: true, accountsCount: 0, reason, hasPagesShowList, permsOk });
    return { ok: false, reason };
  }

  // 3) Persist discovery to a short-lived onboarding session (server-only tokens).
  //    The tenant write runs AFTER all provider HTTP (read → fetch → write).
  const expiresAt = token.expiresInSeconds
    ? new Date(Date.now() + token.expiresInSeconds * 1000)
    : null;

  try {
    const onboardingId = (await withTenant(input.tenantId, async (db) => {
      const onboarding = await db.metaOnboardingSession.create({
        data: {
          tenantId: input.tenantId,
          brandId: input.brandId,
          userId: input.userId,
          // Encrypted at the storage seam (dev: tagged plaintext; prod: KMS).
          userAccessToken: encryptToken(token.accessToken),
          tokenType: token.tokenType,
          tokenExpiresAt: expiresAt,
          grantedScopes: meta.scopes,
          // Opaque provider subject id only — never a token, never rendered.
          authorizingProviderUserId,
          pages: pages as never,
          expiresAt: new Date(Date.now() + ONBOARDING_TTL_MS),
        },
        select: { id: true },
      });
      return onboarding.id;
    })) as string;
    logDiag({ step: "save", ok: true, accountsCount: pages.length });
    return {
      ok: true,
      onboardingId,
      pageCount: pages.length,
      withInstagram: pages.filter((p) => p.igBusinessId).length,
    };
  } catch (err) {
    logDiag({ step: "save", ok: false, message: safeErr(err) });
    return { ok: false, reason: "save_failed" };
  }
}
