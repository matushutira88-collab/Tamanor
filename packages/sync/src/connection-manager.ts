import { prisma, decryptToken } from "@guardora/db";
import { GraphFacebookHideTransport, type FacebookHideTransport, type PageTokenState } from "@guardora/connectors";
import { FACEBOOK_HIDE_PERMISSION } from "@guardora/ai";

/**
 * V1.27C Persistent Connection Manager — keeps Facebook Page connections durable.
 * The account stays "connected" until physically disconnected; a watchdog verifies
 * the Page token against the Graph API (GET /{pageId}?fields=id,name — NOT
 * /me/accounts) and flags needs_reconnect BEFORE any hide runs. Never logs a token.
 */

export type TokenHealth = "unknown" | "ok" | "expiring_soon" | "expired" | "invalid" | "revoked";
export type ConnectionStatus = "connected" | "needs_reconnect" | "invalid_token" | "missing_permission" | "disabled_by_user" | "disconnected";

/** How long a token check stays fresh before a hide triggers a re-check. */
export const TOKEN_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
/** Watchdog cadence hint (worker). */
export const WATCHDOG_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface TokenCheckResult {
  accountId: string;
  connectionStatus: ConnectionStatus;
  tokenHealth: TokenHealth;
  result: string;
  transient?: boolean;
}

function classifyError(errorCode: string): { tokenHealth: TokenHealth; transient: boolean } {
  switch (errorCode) {
    case "token_expired": return { tokenHealth: "expired", transient: false };
    case "revoked": return { tokenHealth: "revoked", transient: false };
    case "token_invalid": return { tokenHealth: "invalid", transient: false };
    case "permission": return { tokenHealth: "ok", transient: false }; // token works, perms missing
    case "rate_limit":
    case "network": return { tokenHealth: "unknown", transient: true };
    default: return { tokenHealth: "invalid", transient: false };
  }
}

/**
 * Validate one account's Page token and persist connection/token health. Read-only
 * against Graph (GET /{pageId}); never performs a hide, never logs the token.
 */
export async function checkAccountToken(
  accountId: string,
  opts?: { transport?: FacebookHideTransport; now?: Date },
): Promise<TokenCheckResult> {
  const now = opts?.now ?? new Date();
  const acct = await prisma.connectedAccount.findUnique({ where: { id: accountId } });
  if (!acct || acct.platform !== "facebook_page") {
    return { accountId, connectionStatus: "disconnected", tokenHealth: "unknown", result: "not_applicable" };
  }

  const token = decryptToken(acct.longLivedToken ?? acct.accessToken);
  if (!token) {
    await prisma.connectedAccount.update({ where: { id: accountId }, data: { connectionStatus: "needs_reconnect", tokenHealth: "invalid", health: "error", lastError: "no_token", lastErrorAt: now, lastTokenCheckAt: now, lastTokenCheckResult: "no_token", requiresReconnectReason: "no_token" } });
    return { accountId, connectionStatus: "needs_reconnect", tokenHealth: "invalid", result: "no_token" };
  }

  const transport = opts?.transport ?? new GraphFacebookHideTransport();
  const state: PageTokenState = transport.getPageTokenState
    ? await transport.getPageTokenState(acct.pageId ?? acct.externalId, token)
    : { ok: false, errorCode: "network" };

  const permsOk = acct.grantedPermissions.includes(FACEBOOK_HIDE_PERMISSION);

  if (state.ok) {
    const connectionStatus: ConnectionStatus = permsOk ? "connected" : "missing_permission";
    const tokenHealth: TokenHealth = "ok";
    await prisma.connectedAccount.update({
      where: { id: accountId },
      data: {
        connectionStatus, tokenHealth, health: "healthy", lastError: null, lastErrorAt: null,
        lastTokenCheckAt: now, lastTokenCheckResult: permsOk ? "ok" : "missing_permission",
        lastSuccessfulGraphCheckAt: now, lastPermissionCheckAt: now,
        requiresReconnectReason: permsOk ? null : "missing_permission",
      },
    });
    return { accountId, connectionStatus, tokenHealth, result: permsOk ? "ok" : "missing_permission" };
  }

  const cls = classifyError(state.errorCode);
  if (cls.transient) {
    // Do NOT downgrade a healthy connection on a transient error — only record the check.
    await prisma.connectedAccount.update({ where: { id: accountId }, data: { lastTokenCheckAt: now, lastTokenCheckResult: state.errorCode } });
    return { accountId, connectionStatus: acct.connectionStatus as ConnectionStatus, tokenHealth: acct.tokenHealth as TokenHealth, result: state.errorCode, transient: true };
  }

  const connectionStatus: ConnectionStatus = state.errorCode === "permission" ? "missing_permission" : "needs_reconnect";
  await prisma.connectedAccount.update({
    where: { id: accountId },
    data: {
      connectionStatus, tokenHealth: cls.tokenHealth, health: "error",
      lastError: state.errorCode, lastErrorAt: now, lastTokenCheckAt: now, lastTokenCheckResult: state.errorCode,
      requiresReconnectReason: state.errorCode,
    },
  });
  return { accountId, connectionStatus, tokenHealth: cls.tokenHealth, result: state.errorCode };
}

/** Watchdog: check every active Facebook Page account. Returns per-account results. */
export async function runFacebookTokenWatchdog(opts?: { transport?: FacebookHideTransport; now?: Date }): Promise<TokenCheckResult[]> {
  const accounts = await prisma.connectedAccount.findMany({
    where: { platform: "facebook_page", status: "active" },
    select: { id: true },
  });
  const results: TokenCheckResult[] = [];
  for (const a of accounts) {
    results.push(await checkAccountToken(a.id, opts));
  }
  return results;
}
